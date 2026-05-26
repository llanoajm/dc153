#!/usr/bin/env python3
"""Cross-path GPU parity probe (GPU_UNBLOCK_ROADMAP §5).

After items 1-3 of the GPU unblock landed, two independent callers POST to the
same Modal endpoint (``infra/modal/solver_app.py``):

* CLI path — ``scripts/smoke_dispatch.py --gpu`` → ``run_dispatch(..., gpu=True)``
  → ``scripts/_gpu_adapter.solve_via_modal`` (uses
  :data:`scripts._gpu_adapter.HIGH_PRECISION_ADMM_ARGS` for ADMM args).
* Agent path — ``scripts/user-mcp-server.py::_solve_via_modal`` (the GPU
  branch of the MCP ``solve_opf`` tool).

Both callers should produce identical LMPs when given the same network and
the same solver args, because the Modal endpoint is deterministic on
float64 input. This probe drives the two paths on the seeded ``ieee-30``
network at ``hours=4`` with matching ADMM args, prints a side-by-side LMP
table, and confirms that ``max(|cli - agent|) / max(|cli|)`` is ≤ 1%.

The 1% threshold is much tighter than the 5% CPU↔GPU acceptance bar of
``scripts/_gpu_parity_report.py`` — because here both callers hit the same
endpoint with identical bodies, any drift above noise is a real divergence
worth surfacing.

Run from ``/home/agent/grid-app``::

    python scripts/_compare_gpu_paths.py

Exits 0 when ``max_rel ≤ 1%``; non-zero with a per-bus / per-snapshot diff
summary otherwise. Requires ``ZAP_SOLVER_MODAL_URL`` + ``ZAP_SOLVER_API_KEY``
in ``.env.local``; missing env vars exit non-zero (no silent skip).

The probe appends a fenced ``<!-- cross-path-probe ... -->`` section to
``infra/modal/PARITY_REPORT.md`` documenting the run. Re-runs replace the
section in place so the report stays single-source.
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
import time
import traceback
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import _pypsa_compat  # noqa: F401  must precede pypsa/zap imports

import pandas as pd  # noqa: E402
import pypsa  # noqa: E402

from _gpu_adapter import (  # noqa: E402
    HIGH_PRECISION_ADMM_ARGS,
    adapt_modal_to_dispatch_outcome,
    load_grid_app_env,
)


REPORT_PATH = ROOT / "infra" / "modal" / "PARITY_REPORT.md"
SECTION_START = "<!-- cross-path-probe:start -->"
SECTION_END = "<!-- cross-path-probe:end -->"
DEFAULT_NET_DIR = ROOT / "data" / "networks" / "ieee-30"
DEFAULT_HOURS = 4
PARITY_THRESHOLD = 0.01  # 1 % max relative diff


def _load_user_mcp_server():
    """Import ``scripts/user-mcp-server.py`` (hyphenated filename)."""
    path = SCRIPTS_DIR / "user-mcp-server.py"
    if not path.exists():
        raise FileNotFoundError(f"missing {path}")
    spec = importlib.util.spec_from_file_location("user_mcp_server", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot build spec for {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _check_env() -> None:
    """Fail fast with a clear message when Modal env vars are missing."""
    env = load_grid_app_env()
    missing = [
        name
        for name in ("ZAP_SOLVER_MODAL_URL", "ZAP_SOLVER_API_KEY")
        if not env.get(name)
    ]
    if missing:
        raise RuntimeError(
            "Modal solver not configured — missing "
            + ", ".join(missing)
            + " in grid-app/.env.local (no silent CPU fallback)"
        )


def _fresh_pnet(net_dir: Path, hours: int) -> tuple[pypsa.Network, pd.Index]:
    """Re-import the PyPSA CSV folder so each path solves on its own copy
    (the call sites mutate ``pnet.snapshots`` in place)."""
    pnet = pypsa.Network()
    pnet.import_from_csv_folder(str(net_dir))
    if len(pnet.snapshots) == 0:
        pnet.set_snapshots(pd.date_range("2024-01-01", periods=1, freq="h"))
    snapshots = pnet.snapshots[:hours]
    return pnet, snapshots


def _solve_cli(net_dir: Path, hours: int):
    """CLI path: ``smoke_dispatch.run_dispatch(..., gpu=True)``. Returns
    ``(prices [n_buses, n_snapshots], pnet_bus_ids, wall_elapsed)``."""
    from smoke_dispatch import run_dispatch

    print(
        f"[cli] {net_dir.name} hours={hours} via smoke_dispatch (CLI path)",
        flush=True,
    )
    t0 = time.time()
    outcome, pnet, snapshots, used_solver, modal_elapsed = run_dispatch(
        net_dir, hours=hours, gpu=True
    )
    wall = time.time() - t0
    if used_solver != "MODAL_GPU":
        raise RuntimeError(
            f"CLI path returned used_solver={used_solver!r}, expected 'MODAL_GPU'"
        )
    prices = np.asarray(outcome.prices, dtype=float)
    if prices.ndim == 1:
        prices = prices.reshape(-1, 1)
    bus_ids = [str(b) for b in pnet.buses.index]
    print(
        f"     [cli] prices={prices.shape}, modal_elapsed={modal_elapsed:.2f}s, "
        f"wall={wall:.2f}s",
        flush=True,
    )
    return prices, bus_ids, wall


def _solve_agent(net_dir: Path, hours: int, mcp_module):
    """Agent path: ``user-mcp-server._solve_via_modal`` driven with the same
    ADMM args as the CLI path. Returns
    ``(prices [n_buses, n_snapshots], pnet_bus_ids, wall_elapsed)``."""
    pnet, snapshots = _fresh_pnet(net_dir, hours)
    print(
        f"[agent] {net_dir.name} hours={hours} via _solve_via_modal "
        "(MCP solve_opf gpu=True branch)",
        flush=True,
    )
    t0 = time.time()
    outcome_shim, pnet_, snapshots_, used_solver, modal_elapsed, extra = (
        mcp_module._solve_via_modal(
            net_dir,
            pnet,
            snapshots,
            hours,
            admm_args=HIGH_PRECISION_ADMM_ARGS,
        )
    )
    wall = time.time() - t0
    if used_solver != "MODAL_GPU":
        raise RuntimeError(
            f"agent path returned used_solver={used_solver!r}, expected "
            "'MODAL_GPU'"
        )
    # Reuse the CLI-path adapter to align the agent-path response to the
    # same [n_buses, n_snapshots] shape ordered by pnet.buses.index. We
    # reconstruct the minimal modal_result dict the adapter expects.
    raw_modal_result = {
        "bus_ids": extra.get("bus_ids") or [str(b) for b in pnet_.buses.index],
        "outcome": {
            "prices": outcome_shim.prices,
            "power": outcome_shim.power,
            "angle": outcome_shim.angle,
        },
    }
    adapted = adapt_modal_to_dispatch_outcome(raw_modal_result, pnet_, snapshots_)
    bus_ids = [str(b) for b in pnet_.buses.index]
    print(
        f"     [agent] prices={adapted.prices.shape}, "
        f"machine={extra.get('machine')!r}, "
        f"modal_elapsed={modal_elapsed:.2f}s, wall={wall:.2f}s",
        flush=True,
    )
    return adapted.prices, bus_ids, wall


def _diff_summary(
    cli_prices: np.ndarray,
    agent_prices: np.ndarray,
) -> dict[str, float]:
    """Aligned-shape parity stats. ``max_rel`` denominator is the CLI
    side's max absolute price (CLI is the reference here because it shares
    the same code path as the CPU↔GPU report)."""
    if cli_prices.shape != agent_prices.shape:
        n_b = min(cli_prices.shape[0], agent_prices.shape[0])
        n_t = min(cli_prices.shape[1], agent_prices.shape[1])
        cli_prices = cli_prices[:n_b, :n_t]
        agent_prices = agent_prices[:n_b, :n_t]
    diff = cli_prices - agent_prices
    finite = np.isfinite(diff)
    n_total = int(diff.size)
    n_finite = int(finite.sum())
    if n_finite == 0:
        return {
            "max_abs": float("nan"),
            "max_rel": float("nan"),
            "mean_abs": float("nan"),
            "rmse": float("nan"),
            "cli_scale": float("nan"),
            "n_total": n_total,
            "n_finite": 0,
        }
    abs_diff = np.abs(diff[finite])
    max_abs = float(abs_diff.max())
    cli_scale = float(np.nanmax(np.abs(cli_prices)))
    max_rel = max_abs / cli_scale if cli_scale > 0 else float("inf")
    mean_abs = float(abs_diff.mean())
    rmse = float(np.sqrt(np.mean(diff[finite] ** 2)))
    return {
        "max_abs": max_abs,
        "max_rel": max_rel,
        "mean_abs": mean_abs,
        "rmse": rmse,
        "cli_scale": cli_scale,
        "n_total": n_total,
        "n_finite": n_finite,
    }


def _side_by_side_lines(
    cli_prices: np.ndarray,
    agent_prices: np.ndarray,
    bus_ids: list[str],
) -> list[str]:
    """One row per bus: CLI mean / agent mean / max|diff| / max_rel."""
    lines = ["{:<10s} {:>12s} {:>12s} {:>12s} {:>12s}".format(
        "bus", "cli_mean", "agent_mean", "max|diff|", "max_rel"
    )]
    lines.append("-" * 60)
    n_b = min(cli_prices.shape[0], agent_prices.shape[0], len(bus_ids))
    cli_scale = float(np.nanmax(np.abs(cli_prices))) if cli_prices.size else 0.0
    for i in range(n_b):
        cli_row = cli_prices[i, :]
        agent_row = agent_prices[i, :]
        cli_mean = float(np.nanmean(cli_row)) if np.isfinite(cli_row).any() else float("nan")
        agent_mean = (
            float(np.nanmean(agent_row)) if np.isfinite(agent_row).any() else float("nan")
        )
        diff = cli_row - agent_row
        finite = np.isfinite(diff)
        if finite.any():
            max_abs = float(np.max(np.abs(diff[finite])))
            max_rel = max_abs / cli_scale if cli_scale > 0 else float("inf")
            max_rel_str = f"{max_rel * 100:.4f}%"
        else:
            max_abs = float("nan")
            max_rel_str = "nan"
        lines.append(
            "{:<10s} {:>12.4f} {:>12.4f} {:>12.4g} {:>12s}".format(
                bus_ids[i], cli_mean, agent_mean, max_abs, max_rel_str
            )
        )
    return lines


def _worst_offenders(
    cli_prices: np.ndarray,
    agent_prices: np.ndarray,
    bus_ids: list[str],
    k: int = 5,
) -> list[str]:
    """Return the top-k bus/snapshot cells with the largest |diff|, formatted
    for the failure summary."""
    diff = np.abs(cli_prices - agent_prices)
    finite = np.isfinite(diff)
    diff = np.where(finite, diff, -np.inf)
    flat = diff.ravel()
    order = np.argsort(-flat)[:k]
    n_t = cli_prices.shape[1]
    out: list[str] = []
    for idx in order:
        if flat[idx] == -np.inf:
            break
        b = int(idx // n_t)
        t = int(idx % n_t)
        cli_v = float(cli_prices[b, t])
        agent_v = float(agent_prices[b, t])
        out.append(
            f"  bus={bus_ids[b] if b < len(bus_ids) else b} t={t}: "
            f"cli={cli_v:.4f} agent={agent_v:.4f} |diff|={flat[idx]:.4g}"
        )
    return out


def _render_report_section(
    *,
    network: str,
    hours: int,
    stats: dict[str, float],
    cli_wall: float,
    agent_wall: float,
    admm_args: dict,
    threshold: float,
    passed: bool,
) -> str:
    """Markdown block that goes between SECTION_START / SECTION_END."""
    generated_at = pd.Timestamp.utcnow().isoformat()
    lines = [
        SECTION_START,
        "",
        "## Cross-path parity probe",
        "",
        (
            "Comparison between the CLI GPU path "
            "(`scripts/smoke_dispatch.py --gpu` → `_gpu_adapter.solve_via_modal`) "
            "and the agent GPU path "
            "(`scripts/user-mcp-server.py::_solve_via_modal`, the GPU branch of "
            "the MCP `solve_opf` tool). Both callers are driven with identical "
            "ADMM args (`scripts/_gpu_adapter.HIGH_PRECISION_ADMM_ARGS`) so any "
            "diff is endpoint non-determinism, not config drift."
        ),
        "",
        f"_Last probed: {generated_at} — `scripts/_compare_gpu_paths.py`_.",
        "",
        f"- Network: `{network}`, hours: {hours}",
        f"- ADMM args: `{admm_args}`",
        f"- Acceptance threshold: ≤ {threshold * 100:.2f}% max relative diff",
        f"- CLI wall: {cli_wall:.2f} s; agent wall: {agent_wall:.2f} s",
        "",
        "| Metric | Value |",
        "|---|---:|",
    ]
    if stats.get("n_finite", 0) == 0 or stats["max_abs"] != stats["max_abs"]:
        lines.extend(
            [
                "| Max \\|cli - agent\\| | — |",
                "| Max relative | — |",
                "| Mean \\|cli - agent\\| | — |",
                "| RMSE | — |",
                "| CLI max\\|p\\| | — |",
                "| Finite cells | 0 |",
                "",
                "**Result:** no finite diffs to compare (probe could not "
                "evaluate parity).",
                "",
            ]
        )
    else:
        lines.extend(
            [
                f"| Max \\|cli - agent\\| | {stats['max_abs']:.4g} |",
                f"| Max relative | {stats['max_rel'] * 100:.4f}% |",
                f"| Mean \\|cli - agent\\| | {stats['mean_abs']:.4g} |",
                f"| RMSE | {stats['rmse']:.4g} |",
                f"| CLI max\\|p\\| | {stats['cli_scale']:.4g} |",
                f"| Finite cells | {stats['n_finite']} / {stats['n_total']} |",
                "",
                (
                    f"**Result:** {'PASS' if passed else 'FAIL'} — max "
                    f"relative diff "
                    f"{stats['max_rel'] * 100:.4f}% "
                    f"vs the {threshold * 100:.2f}% bar."
                ),
                "",
            ]
        )
    lines.append(SECTION_END)
    return "\n".join(lines)


def _upsert_section(section_body: str) -> None:
    """Write ``section_body`` into ``PARITY_REPORT.md``, replacing any prior
    fenced ``<!-- cross-path-probe ... -->`` block so re-runs stay idempotent."""
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not REPORT_PATH.exists():
        # Probe runs before the parity report exists — stub it so the section
        # has something to attach to. Real numbers populate on the next
        # `scripts/_gpu_parity_report.py` run.
        REPORT_PATH.write_text(
            "# CPU vs GPU parity report\n\n"
            "Generated by `scripts/_gpu_parity_report.py`.\n\n"
        )
    text = REPORT_PATH.read_text()
    start = text.find(SECTION_START)
    if start == -1:
        # Append a single blank line + the section.
        if not text.endswith("\n"):
            text += "\n"
        text += "\n" + section_body + "\n"
    else:
        end = text.find(SECTION_END, start)
        if end == -1:
            # Truncated marker — overwrite from start to EOF.
            text = text[:start] + section_body + "\n"
        else:
            end_full = end + len(SECTION_END)
            text = text[:start] + section_body + text[end_full:]
    REPORT_PATH.write_text(text)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--net-dir",
        default=str(DEFAULT_NET_DIR),
        help="PyPSA CSV folder (default: data/networks/ieee-30)",
    )
    parser.add_argument(
        "--hours",
        type=int,
        default=DEFAULT_HOURS,
        help=f"snapshots to solve (default: {DEFAULT_HOURS})",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=PARITY_THRESHOLD,
        help=(
            "max relative diff threshold (default: 0.01 = 1 %). Exits non-zero "
            "if max_rel exceeds this."
        ),
    )
    args = parser.parse_args()

    net_dir = Path(args.net_dir).resolve()
    if not (net_dir / "buses.csv").exists():
        print(f"FAIL: {net_dir} doesn't look like a PyPSA CSV folder", file=sys.stderr)
        return 1

    try:
        _check_env()
    except RuntimeError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    mcp = _load_user_mcp_server()

    try:
        cli_prices, cli_bus_ids, cli_wall = _solve_cli(net_dir, args.hours)
    except Exception:
        traceback.print_exc()
        return 1
    try:
        agent_prices, agent_bus_ids, agent_wall = _solve_agent(
            net_dir, args.hours, mcp
        )
    except Exception:
        traceback.print_exc()
        return 1

    if cli_bus_ids != agent_bus_ids:
        print(
            "WARN: CLI and agent bus orderings differ; truncating to common prefix",
            flush=True,
        )
    common_bus_ids = cli_bus_ids[
        : min(len(cli_bus_ids), len(agent_bus_ids))
    ]

    stats = _diff_summary(cli_prices, agent_prices)
    print()
    print("LMP comparison (CLI vs agent, by bus):")
    for line in _side_by_side_lines(cli_prices, agent_prices, common_bus_ids):
        print(line)
    print()
    if stats["n_finite"] == 0 or stats["max_abs"] != stats["max_abs"]:
        print("Aggregate: no finite diffs to compare")
        passed = False
    else:
        passed = stats["max_rel"] <= args.threshold
        print(
            f"Aggregate: max|diff|={stats['max_abs']:.4g} "
            f"max_rel={stats['max_rel'] * 100:.4f}% "
            f"(threshold {args.threshold * 100:.2f}%) "
            f"-> {'PASS' if passed else 'FAIL'}"
        )
        if not passed:
            print()
            print("Top divergent cells:")
            for line in _worst_offenders(cli_prices, agent_prices, common_bus_ids):
                print(line)

    section = _render_report_section(
        network=net_dir.name,
        hours=args.hours,
        stats=stats,
        cli_wall=cli_wall,
        agent_wall=agent_wall,
        admm_args=HIGH_PRECISION_ADMM_ARGS,
        threshold=args.threshold,
        passed=passed,
    )
    try:
        _upsert_section(section)
        print(f"[report] updated {REPORT_PATH.relative_to(ROOT)}", flush=True)
    except Exception:
        traceback.print_exc()
        # Don't fail the probe just because the report write fails — the diff
        # is the load-bearing signal.

    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())

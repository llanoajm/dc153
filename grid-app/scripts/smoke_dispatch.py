#!/usr/bin/env python3
"""Run a 1-hour smoke dispatch on a reference network folder.

Usage: ``python scripts/smoke_dispatch.py data/networks/<name>``

Loads the PyPSA CSV folder, hands it to ``zap.importers.load_pypsa_network``,
solves a single-snapshot dispatch problem with CLARABEL, and exits 0 on
success. Any failure (unimportable network, infeasible problem, solver error)
exits 1 with the traceback to stderr.

This is the per-network acceptance test for ROADMAP §0 — the canonical rows
the seed script writes must already pass this check.
"""
from __future__ import annotations

import argparse
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import _pypsa_compat  # noqa: F401  must precede pypsa/zap imports

import cvxpy as cp  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pypsa  # noqa: E402
import zap  # noqa: E402


SOLVER_FALLBACK = ("HIGHS", "CLARABEL", "SCS")
GPU_SOLVER_LABEL = "MODAL_GPU"


def _load_network(net_dir: Path, hours: int) -> tuple[pypsa.Network, pd.Index]:
    """Common pnet+snapshots prologue for both CPU and GPU paths."""
    if not net_dir.exists():
        raise FileNotFoundError(f"network folder not found: {net_dir}")
    if not (net_dir / "buses.csv").exists():
        raise FileNotFoundError(
            f"{net_dir} doesn't look like a PyPSA CSV folder "
            "(missing buses.csv)"
        )
    pnet = pypsa.Network()
    pnet.import_from_csv_folder(str(net_dir))
    if len(pnet.snapshots) == 0:
        pnet.set_snapshots(pd.date_range("2024-01-01", periods=1, freq="h"))
    snapshots = pnet.snapshots[:hours]
    return pnet, snapshots


def _run_dispatch_cpu(
    pnet: pypsa.Network,
    snapshots: pd.Index,
    solver: str | None,
):
    """Solve the dispatch problem on the local CPU stack and return the
    cvxpy ``DispatchOutcome`` plus the elapsed seconds."""
    t0 = time.time()
    network, devices = zap.importers.load_pypsa_network(pnet, snapshots)
    solvers_to_try = [solver] if solver else list(SOLVER_FALLBACK)
    last_err: Exception | None = None
    outcome = None
    used_solver: str | None = None
    for name in solvers_to_try:
        try:
            outcome = network.dispatch(devices, solver=getattr(cp, name))
            used_solver = name
            break
        except Exception as err:
            last_err = err
            network, devices = zap.importers.load_pypsa_network(pnet, snapshots)
    if outcome is None:
        raise RuntimeError(
            f"all solvers failed: tried {solvers_to_try}; last error: {last_err}"
        )
    return outcome, used_solver, time.time() - t0


def _run_dispatch_gpu(
    pnet: pypsa.Network,
    snapshots: pd.Index,
):
    """Post the network to the Modal GPU solver and adapt the response into
    a CPU-shaped dispatch outcome. Raises ``RuntimeError`` (named env var)
    when ``ZAP_SOLVER_MODAL_URL`` / ``ZAP_SOLVER_API_KEY`` are missing — no
    silent fallback to CPU.
    """
    # Local import so the CPU path doesn't pay the import cost when the user
    # never asks for GPU.
    from _gpu_adapter import (  # noqa: E402
        adapt_modal_to_dispatch_outcome,
        solve_via_modal,
    )

    modal_result, elapsed = solve_via_modal(pnet, snapshots)
    outcome = adapt_modal_to_dispatch_outcome(modal_result, pnet, snapshots)
    return outcome, modal_result, elapsed


def run_dispatch(
    net_dir: Path,
    hours: int = 1,
    solver: str | None = None,
    gpu: bool = False,
):
    """Solve dispatch and return ``(outcome, pnet, snapshots, used_solver, elapsed)``.

    Same solver-fallback logic as :func:`smoke_dispatch`, but exposes the pypsa
    network and snapshot index so callers can extract per-bus/per-snapshot time
    series for run artifacts (LMPs, dispatch by carrier, line flows).

    When ``gpu=True``, the dispatch is sent to the Modal-hosted ADMM solver
    (``infra/modal/solver_app.py``); the response is fed through
    ``scripts/_gpu_adapter.adapt_modal_to_dispatch_outcome`` so the return
    shape stays identical to the CPU path (``used_solver`` is the literal
    ``"MODAL_GPU"``). GPU adapts to CPU, never the other way around.
    """
    pnet, snapshots = _load_network(net_dir, hours)
    if gpu:
        outcome, _modal_result, elapsed = _run_dispatch_gpu(pnet, snapshots)
        return outcome, pnet, snapshots, GPU_SOLVER_LABEL, elapsed
    outcome, used_solver, elapsed = _run_dispatch_cpu(pnet, snapshots, solver)
    return outcome, pnet, snapshots, used_solver, elapsed


def smoke_dispatch(
    net_dir: Path,
    hours: int = 1,
    solver: str | None = None,
    gpu: bool = False,
):
    outcome, pnet, snapshots, used_solver, elapsed = run_dispatch(
        net_dir, hours=hours, solver=solver, gpu=gpu
    )
    print(
        f"OK  {net_dir.name}: {len(pnet.buses)} buses, "
        f"{len(snapshots)} snapshot(s), "
        f"solver={used_solver}, solved in {elapsed:.2f}s"
    )
    if outcome.prices is not None:
        print(f"     prices shape: {np.asarray(outcome.prices).shape}")
    return outcome, pnet, snapshots


def _print_gpu_cpu_parity(
    net_dir: Path,
    hours: int,
    solver: str | None,
    gpu_outcome,
    pnet,
    snapshots,
    max_rel_threshold: float,
) -> bool:
    """Re-solve on CPU and print ``max(|gpu - cpu|) / max(|cpu|)`` so a
    ``--gpu`` smoke can be graded against the parity bar without a companion
    script. Returns ``True`` when the diff is within ``max_rel_threshold``,
    ``False`` when it exceeds. CPU re-solve failure / no-finite-diff is
    treated as inconclusive (returns ``True`` so the smoke doesn't fail on
    infrastructure issues — the message names the cause)."""
    from _gpu_adapter import cpu_gpu_lmp_parity

    try:
        cpu_outcome, _used_solver, cpu_elapsed = _run_dispatch_cpu(
            pnet, snapshots, solver
        )
    except Exception as err:
        print(f"     parity: CPU re-solve failed ({err}); skipping diff")
        return True
    cpu_prices = np.asarray(cpu_outcome.prices, dtype=float)
    if cpu_prices.ndim == 1:
        cpu_prices = cpu_prices.reshape(-1, 1)
    gpu_prices = np.asarray(gpu_outcome.prices, dtype=float)
    max_abs, max_rel = cpu_gpu_lmp_parity(cpu_prices, gpu_prices)
    if max_rel != max_rel:  # NaN
        print(f"     parity: no finite diff (cpu={cpu_elapsed:.2f}s)")
        return True
    passed = max_rel <= max_rel_threshold
    verdict = "OK" if passed else "FAIL"
    print(
        f"     parity: max|gpu - cpu| = {max_abs:.4g}, "
        f"max_rel = {max_rel * 100:.2f}% "
        f"(threshold {max_rel_threshold * 100:.2f}%, {verdict}; "
        f"cpu {cpu_elapsed:.2f}s)"
    )
    return passed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "network_dir", help="path to a PyPSA CSV folder under data/networks/"
    )
    parser.add_argument(
        "--hours", type=int, default=1, help="snapshots to solve (default: 1)"
    )
    parser.add_argument(
        "--solver",
        default=None,
        help="cvxpy solver name. If omitted, tries HIGHS → CLARABEL → SCS.",
    )
    parser.add_argument(
        "--gpu",
        action="store_true",
        help=(
            "dispatch via the Modal-hosted ADMM solver instead of the local "
            "CPU stack. Requires ZAP_SOLVER_MODAL_URL and ZAP_SOLVER_API_KEY "
            "in grid-app/.env.local; on every --gpu run, the script also "
            "re-solves on CPU and grades the GPU↔CPU LMP parity ratio "
            "against --max-rel."
        ),
    )
    parser.add_argument(
        "--max-rel",
        type=float,
        default=0.05,
        help=(
            "max-relative-LMP-diff threshold for the --gpu parity check "
            "(default: 0.05 = 5%%). Exits non-zero when the GPU↔CPU diff "
            "exceeds this. Ignored without --gpu."
        ),
    )
    args = parser.parse_args()
    try:
        outcome, pnet, snapshots = smoke_dispatch(
            Path(args.network_dir), args.hours, args.solver, gpu=args.gpu
        )
        if args.gpu:
            passed = _print_gpu_cpu_parity(
                Path(args.network_dir),
                args.hours,
                args.solver,
                outcome,
                pnet,
                snapshots,
                max_rel_threshold=args.max_rel,
            )
            if not passed:
                sys.exit(1)
    except Exception:
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

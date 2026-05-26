#!/usr/bin/env python3
"""Smoke-validate the MCP ``solve_opf`` tool's solve path (GPU_UNBLOCK_ROADMAP §4).

Item 7 (`solve_opf` MCP tool) and item 9 (`scripts/_gpu_parity_report.py`)
have used the Modal GPU endpoint via private code paths since before items
1-3 introduced the canonical adapter layer. This helper confirms that after
items 1-3 land, both the CPU and GPU branches of the MCP `solve_opf` tool
still produce a valid dispatch tuple with non-empty prices on the seeded
`ieee-30` network.

The MCP tool's full entrypoint (``_builtin_solve_opf``) writes a row into
Supabase and would need a real workspace + service-role auth + a network
artifact row that we can't depend on in a CI-style smoke. Per the loop
protocol's documented workaround, we exercise the two solve branches the
tool dispatches between (``_solve_via_modal`` for GPU, ``smoke_dispatch.run_dispatch``
for CPU) directly against the on-disk ``data/networks/ieee-30/`` folder. Both
branches return the tuples the tool consumes downstream, so this smoke
confirms the contract the MCP layer relies on without dragging Supabase
into the loop.

Run from ``/home/agent/grid-app``::

    python scripts/_smoke_solve_opf.py

Exits 0 when both branches return a non-empty price grid; non-zero with a
diagnostic line otherwise. Honours ``--skip-gpu`` for local dev when Modal
isn't reachable.
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
import traceback
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import _pypsa_compat  # noqa: F401  must precede pypsa/zap imports

import pandas as pd  # noqa: E402
import pypsa  # noqa: E402


def _load_user_mcp_server():
    """Import ``scripts/user-mcp-server.py`` despite its hyphenated filename."""
    path = SCRIPTS_DIR / "user-mcp-server.py"
    if not path.exists():
        raise FileNotFoundError(f"missing {path}")
    spec = importlib.util.spec_from_file_location("user_mcp_server", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot build spec for {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _prepare_pnet(net_dir: Path, hours: int):
    pnet = pypsa.Network()
    pnet.import_from_csv_folder(str(net_dir))
    if len(pnet.snapshots) == 0:
        pnet.set_snapshots(pd.date_range("2024-01-01", periods=1, freq="h"))
    snapshots = pnet.snapshots[:hours]
    return pnet, snapshots


def _check_prices(outcome, label: str) -> int:
    prices = getattr(outcome, "prices", None)
    if prices is None:
        print(f"FAIL [{label}]: outcome.prices is None")
        return 1
    arr = np.asarray(prices, dtype=float)
    if arr.size == 0:
        print(f"FAIL [{label}]: outcome.prices is empty (shape={arr.shape})")
        return 1
    if not np.isfinite(arr).any():
        print(f"FAIL [{label}]: outcome.prices has no finite entries")
        return 1
    print(
        f"OK   [{label}]: outcome.prices shape={arr.shape}, "
        f"finite_frac={float(np.isfinite(arr).mean()):.2f}"
    )
    return 0


def smoke_cpu(net_dir: Path, hours: int) -> int:
    """Mirror the CPU branch of ``_builtin_solve_opf``."""
    from smoke_dispatch import run_dispatch

    pnet, snapshots = _prepare_pnet(net_dir, hours)
    print(
        f"[cpu] solving {net_dir.name} hours={len(snapshots)} via run_dispatch",
        flush=True,
    )
    outcome, pnet, snapshots, used_solver, elapsed = run_dispatch(
        net_dir, hours=hours
    )
    # Loose tuple-shape check — used_solver is a string, elapsed is a number.
    if not isinstance(used_solver, str) or not used_solver:
        print(f"FAIL [cpu]: used_solver={used_solver!r}")
        return 1
    try:
        float(elapsed)
    except (TypeError, ValueError):
        print(f"FAIL [cpu]: elapsed={elapsed!r} not numeric")
        return 1
    print(f"     [cpu] solver={used_solver}, elapsed={float(elapsed):.2f}s")
    return _check_prices(outcome, "cpu")


def smoke_gpu(net_dir: Path, hours: int) -> int:
    """Mirror the GPU branch of ``_builtin_solve_opf``: load pnet+snapshots,
    then call ``_solve_via_modal`` directly. Same tuple shape the MCP tool
    consumes downstream."""
    mcp = _load_user_mcp_server()
    pnet, snapshots = _prepare_pnet(net_dir, hours)
    print(
        f"[gpu] solving {net_dir.name} hours={len(snapshots)} via "
        f"_solve_via_modal (MCP solve_opf gpu=True branch)",
        flush=True,
    )
    result = mcp._solve_via_modal(net_dir, pnet, snapshots, hours)
    if not isinstance(result, tuple) or len(result) != 6:
        print(
            f"FAIL [gpu]: expected 6-tuple from _solve_via_modal, got "
            f"{type(result).__name__} len={len(result) if hasattr(result, '__len__') else '?'}"
        )
        return 1
    outcome, pnet_out, snapshots_out, used_solver, elapsed, extra = result
    if used_solver != "MODAL_GPU":
        print(f"FAIL [gpu]: used_solver={used_solver!r}, expected 'MODAL_GPU'")
        return 1
    try:
        float(elapsed)
    except (TypeError, ValueError):
        print(f"FAIL [gpu]: elapsed={elapsed!r} not numeric")
        return 1
    if not isinstance(extra, dict):
        print(f"FAIL [gpu]: extra={type(extra).__name__}, expected dict")
        return 1
    machine = extra.get("machine") or "unknown"
    print(
        f"     [gpu] solver={used_solver}, machine={machine}, "
        f"elapsed={float(elapsed):.2f}s"
    )
    return _check_prices(outcome, "gpu")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--net-dir",
        default=str(ROOT / "data/networks/ieee-30"),
        help="PyPSA CSV folder (default: data/networks/ieee-30)",
    )
    parser.add_argument(
        "--hours",
        type=int,
        default=1,
        help="Snapshots to solve (default: 1)",
    )
    parser.add_argument(
        "--skip-gpu",
        action="store_true",
        help="Skip the GPU branch (useful when Modal env vars aren't set).",
    )
    args = parser.parse_args()

    net_dir = Path(args.net_dir).resolve()
    if not (net_dir / "buses.csv").exists():
        print(f"FAIL: {net_dir} doesn't look like a PyPSA CSV folder")
        return 1

    try:
        rc_cpu = smoke_cpu(net_dir, args.hours)
    except Exception:
        traceback.print_exc()
        return 1
    if rc_cpu != 0:
        return rc_cpu

    if args.skip_gpu:
        print("[gpu] skipped via --skip-gpu")
        return 0

    try:
        rc_gpu = smoke_gpu(net_dir, args.hours)
    except Exception:
        traceback.print_exc()
        return 1
    return rc_gpu


if __name__ == "__main__":
    sys.exit(main())

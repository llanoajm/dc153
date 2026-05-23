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
import pandas as pd  # noqa: E402
import pypsa  # noqa: E402
import zap  # noqa: E402


SOLVER_FALLBACK = ("HIGHS", "CLARABEL", "SCS")


def smoke_dispatch(net_dir: Path, hours: int = 1, solver: str | None = None):
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
        # network has no snapshot index — fall back to a synthetic 1-hour one
        pnet.set_snapshots(pd.date_range("2024-01-01", periods=1, freq="h"))

    snapshots = pnet.snapshots[:hours]

    t0 = time.time()
    network, devices = zap.importers.load_pypsa_network(pnet, snapshots)

    solvers_to_try = [solver] if solver else list(SOLVER_FALLBACK)
    last_err: Exception | None = None
    outcome = None
    used_solver = None
    for name in solvers_to_try:
        try:
            outcome = network.dispatch(devices, solver=getattr(cp, name))
            used_solver = name
            break
        except Exception as err:
            last_err = err
            # rebuild devices because zap mutates dispatch state on failure
            network, devices = zap.importers.load_pypsa_network(pnet, snapshots)
    if outcome is None:
        raise RuntimeError(
            f"all solvers failed for {net_dir.name}: tried {solvers_to_try}; "
            f"last error: {last_err}"
        )
    elapsed = time.time() - t0

    print(
        f"OK  {net_dir.name}: {network.num_nodes} buses, "
        f"{len(devices)} device-classes, {len(snapshots)} snapshot(s), "
        f"solver={used_solver}, solved in {elapsed:.2f}s"
    )
    if outcome.prices is not None:
        print(f"     prices shape: {outcome.prices.shape}")
    return outcome


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
    args = parser.parse_args()
    try:
        smoke_dispatch(Path(args.network_dir), args.hours, args.solver)
    except Exception:
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

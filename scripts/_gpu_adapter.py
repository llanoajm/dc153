#!/usr/bin/env python3
"""CPU-shape adapter for Modal GPU solver responses (GPU_UNBLOCK_ROADMAP §1).

The Modal-hosted GPU endpoint (``infra/modal/solver_app.py``) returns a JSON
payload whose ``outcome`` block holds raw ``power`` / ``angle`` / ``prices``
arrays. CPU callers in this repo (e.g. ``scripts/run_artifact.build_run_view_spec``)
read those off a ``zap.network.DispatchOutcome`` dataclass with specific
attribute names and a specific ``prices`` shape (``[n_buses, n_snapshots]``
indexed by ``pnet.buses.index``).

This module bridges the two — handing a Modal response dict to
``adapt_modal_to_dispatch_outcome`` returns a lightweight object that mimics
the attributes ``build_run_view_spec`` reads, so downstream code stays
agnostic of which solver produced the numbers.

Design:
- GPU adapts to CPU, never the other way around (GPU_PARITY_ROADMAP §Design).
- The CPU return shape is the source of truth; if Modal ever changes its
  payload, fix this adapter, not the CPU path.
- ``None`` entries in the GPU price grid (from ``_tensor_to_list``'s
  NaN/inf sanitisation in ``solver_app.py``) round-trip as ``NaN`` so
  ``_safe_float`` in ``run_artifact.py`` drops them as expected.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass
class GpuDispatchOutcome:
    """Subset of ``zap.network.DispatchOutcome`` that callers in this repo
    actually read.

    Only the fields consumed by ``scripts/run_artifact.build_run_view_spec``
    (and its helpers) are populated. Attributes the dispatch outcome would
    normally carry (``phase_duals``, ``local_equality_duals``, ...) are
    intentionally absent — adding them would require synthesising data the
    Modal payload does not return.
    """

    prices: np.ndarray  # shape [n_buses, n_snapshots], aligned to pnet.buses.index
    power: list  # per-device list; raw passthrough from Modal payload
    angle: list  # per-device list; raw passthrough from Modal payload


def _coerce_prices(raw: Any) -> np.ndarray:
    """Modal returns ``prices`` as nested Python lists (possibly with ``None``
    placeholders where ``_tensor_to_list`` cleaned NaN/inf). Coerce to a 2-D
    float ndarray with ``None`` → ``NaN`` so downstream finite checks work.
    """
    arr = np.asarray(raw, dtype=float)
    if arr.ndim == 1:
        arr = arr.reshape(-1, 1)
    return arr


def _orient_to_buses(prices: np.ndarray, n_buses: int) -> np.ndarray:
    """Modal's ``prices`` may come back either way round depending on which
    layer in zap built the outcome. If the second axis matches the bus count
    but the first doesn't, transpose. Mirrors the orientation guard in
    ``scripts/_gpu_parity_report.py::gpu_solve``.
    """
    if prices.ndim != 2:
        return prices
    if prices.shape[0] == n_buses:
        return prices
    if prices.shape[1] == n_buses:
        return prices.T
    return prices


def _reindex_to_pnet_buses(
    prices: np.ndarray,
    response_bus_ids: list[str],
    pnet_bus_ids: list[str],
) -> np.ndarray:
    """Permute the bus axis of ``prices`` so row ``i`` corresponds to
    ``pnet_bus_ids[i]``. Buses present in ``pnet`` but missing from the
    response get a NaN row (renderers treat NaN LMPs as missing data).
    """
    if prices.size == 0:
        return prices
    if prices.ndim != 2:
        return prices
    response_idx = {b: i for i, b in enumerate(response_bus_ids)}
    n_t = prices.shape[1]
    out = np.full((len(pnet_bus_ids), n_t), np.nan, dtype=float)
    for dest, bus_id in enumerate(pnet_bus_ids):
        src = response_idx.get(bus_id)
        if src is None:
            continue
        out[dest, :] = prices[src, :]
    return out


def adapt_modal_to_dispatch_outcome(
    modal_result: dict,
    pnet,
    snapshots,
) -> GpuDispatchOutcome:
    """Wrap a Modal solver response into a CPU-shaped dispatch outcome.

    Parameters
    ----------
    modal_result : dict
        The JSON-decoded response from ``infra/modal/solver_app.py``'s
        ``solve`` endpoint (or ``solve_direct``). Expected to carry an
        ``outcome`` sub-dict with ``prices`` / ``power`` / ``angle`` and a
        top-level ``bus_ids`` list for alignment.
    pnet : pypsa.Network
        The local PyPSA network whose bus index defines the target bus
        ordering. We never trust the GPU response to be pre-aligned.
    snapshots : pandas.Index
        Snapshot index for the CPU side — used only to truncate the price
        grid to the common time horizon (a defensive measure; the Modal
        endpoint already respects the truncation we set before exporting
        netCDF).

    Returns
    -------
    GpuDispatchOutcome
        Lightweight wrapper that quacks like ``zap.network.DispatchOutcome``
        for the attributes ``build_run_view_spec`` reads.
    """
    outcome = modal_result.get("outcome") or {}
    raw_prices = outcome.get("prices")
    pnet_bus_ids = [str(b) for b in pnet.buses.index]
    response_bus_ids = [
        str(b) for b in (modal_result.get("bus_ids") or pnet_bus_ids)
    ]

    if raw_prices is None:
        prices = np.empty((len(pnet_bus_ids), 0), dtype=float)
    else:
        prices = _coerce_prices(raw_prices)
        prices = _orient_to_buses(prices, len(response_bus_ids))
        prices = _reindex_to_pnet_buses(prices, response_bus_ids, pnet_bus_ids)
        n_t_target = len(snapshots)
        if prices.ndim == 2 and prices.shape[1] > n_t_target > 0:
            prices = prices[:, :n_t_target]

    power = outcome.get("power") or []
    angle = outcome.get("angle") or []

    return GpuDispatchOutcome(prices=prices, power=power, angle=angle)


def _smoke_main() -> int:
    """Hand-build a fake Modal response for ``ieee-30`` and round-trip it
    through ``build_run_view_spec``. Exits 0 on success, 1 on failure.

    Acceptance criteria (LOOP_QUEUE item 1):
    - non-empty ``lmps`` and ``hours`` in the resulting view spec.
    """
    import sys
    import traceback
    from pathlib import Path

    ROOT = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(ROOT / "scripts"))

    import _pypsa_compat  # noqa: F401  must precede pypsa imports

    import pandas as pd  # noqa: E402
    import pypsa  # noqa: E402

    from run_artifact import build_run_view_spec  # noqa: E402

    net_dir = ROOT / "data" / "networks" / "ieee-30"
    pnet = pypsa.Network()
    pnet.import_from_csv_folder(str(net_dir))
    if len(pnet.snapshots) == 0:
        pnet.set_snapshots(pd.date_range("2024-01-01", periods=1, freq="h"))
    hours = 1
    snapshots = pnet.snapshots[:hours]
    bus_ids = [str(b) for b in pnet.buses.index]
    n_buses = len(bus_ids)

    rng = np.random.default_rng(42)
    fake_prices = rng.uniform(20.0, 60.0, size=(n_buses, hours)).tolist()
    fake_prices[0][0] = None
    shuffled_bus_ids = list(reversed(bus_ids))
    shuffled_prices = list(reversed(fake_prices))

    fake_modal_result = {
        "machine": "cuda",
        "gpu": "H100",
        "elapsed_s": 1.23,
        "bus_ids": shuffled_bus_ids,
        "snapshot_iso": [
            t.isoformat() if hasattr(t, "isoformat") else str(t)
            for t in snapshots
        ],
        "outcome": {
            "prices": shuffled_prices,
            "power": [],
            "angle": [],
        },
    }

    try:
        adapted = adapt_modal_to_dispatch_outcome(
            fake_modal_result, pnet, snapshots
        )
    except Exception:
        traceback.print_exc()
        return 1

    if not isinstance(adapted.prices, np.ndarray):
        print(f"FAIL: .prices is {type(adapted.prices).__name__}, not ndarray")
        return 1
    if adapted.prices.shape != (n_buses, hours):
        print(
            f"FAIL: .prices shape {adapted.prices.shape}, expected ({n_buses}, {hours})"
        )
        return 1

    first_bus_id = bus_ids[0]
    expected_after_reindex = fake_modal_result["outcome"]["prices"][
        shuffled_bus_ids.index(first_bus_id)
    ][0]
    actual_first = adapted.prices[0, 0]
    if expected_after_reindex is None:
        if not np.isnan(actual_first):
            print(
                f"FAIL: bus[0] price should be NaN after reindex, got {actual_first}"
            )
            return 1
    else:
        if not np.isclose(actual_first, expected_after_reindex):
            print(
                f"FAIL: bus[0] price after reindex: got {actual_first}, "
                f"expected {expected_after_reindex}"
            )
            return 1

    try:
        view_spec = build_run_view_spec(adapted, pnet, snapshots)
    except Exception:
        traceback.print_exc()
        return 1

    if not view_spec.get("hours"):
        print(f"FAIL: view_spec.hours empty: {view_spec.get('hours')!r}")
        return 1
    if not view_spec.get("lmps"):
        print(f"FAIL: view_spec.lmps empty (len 0)")
        return 1

    print(
        f"OK  _gpu_adapter smoke: prices={adapted.prices.shape}, "
        f"hours={len(view_spec['hours'])}, lmps={len(view_spec['lmps'])}"
    )
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(_smoke_main())

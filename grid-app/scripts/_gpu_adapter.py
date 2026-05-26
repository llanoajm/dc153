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

import base64
import json
import os
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

ENV_FILE = Path(__file__).resolve().parent.parent / ".env.local"

# Tighter ADMM tuning than the Modal endpoint's defaults (1000 iters / 1e-5 /
# float32) so callers that need GPU↔CPU LMP parity get it out of the box.
# Matches the knobs ``scripts/_gpu_parity_report.py`` uses to drive ieee-30
# under the 5 % parity bar (historical 4.22 %).
HIGH_PRECISION_ADMM_ARGS: dict[str, Any] = {
    "num_iterations": 8000,
    "rho_power": 1.0,
    "rho_angle": 1.0,
    "atol": 1e-7,
    "rtol": 1e-7,
    "dtype": "float64",
}


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


def load_grid_app_env() -> dict[str, str]:
    """Lightweight ``.env.local`` parser (no python-dotenv dep). Process env
    wins over file values so a one-off ``ZAP_SOLVER_TIMEOUT_S=…`` override on
    the CLI behaves intuitively."""
    env: dict[str, str] = {}
    if ENV_FILE.exists():
        for raw in ENV_FILE.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    env.update(os.environ)
    return env


def _export_truncated_netcdf(pnet, snapshots) -> bytes:
    """Re-export ``pnet`` (with snapshots truncated to ``snapshots``) as
    netCDF bytes for the Modal POST body. Mirrors
    ``scripts/_gpu_parity_report.py::_export_truncated_netcdf`` but takes the
    already-loaded ``pnet`` so callers don't re-parse the CSV folder."""
    pnet.set_snapshots(snapshots)
    with tempfile.NamedTemporaryFile(suffix=".nc", delete=False) as tf:
        nc_path = tf.name
    try:
        pnet.export_to_netcdf(nc_path)
        return Path(nc_path).read_bytes()
    finally:
        Path(nc_path).unlink(missing_ok=True)


def solve_via_modal(
    pnet,
    snapshots,
    admm_args: dict[str, Any] | None = None,
    env: dict[str, str] | None = None,
) -> tuple[dict[str, Any], float]:
    """POST the truncated PyPSA network to the Modal GPU solver and return
    ``(modal_result_dict, wall_elapsed_s)``.

    Parameters
    ----------
    pnet : pypsa.Network
        Local PyPSA network. Will be re-exported as netCDF with
        ``snapshots`` set as its snapshot index.
    snapshots : pandas.Index
        Snapshot horizon to send to Modal (also used downstream when adapting
        the response).
    admm_args : dict | None
        ADMM solver args forwarded to ``infra/modal/solver_app.py`` under
        ``"args"``. Defaults to :data:`HIGH_PRECISION_ADMM_ARGS` (the
        ``_gpu_parity_report.py`` ieee-30 tuning) so smoke callers hit the
        ≤5 % parity bar without per-call tuning.
    env : dict | None
        Pre-loaded env mapping. If ``None``, parsed from ``.env.local``.

    Raises
    ------
    RuntimeError
        When ``ZAP_SOLVER_MODAL_URL`` / ``ZAP_SOLVER_API_KEY`` are missing
        (names the missing var; no silent CPU fallback) or when Modal returns
        a non-2xx status / unreachable network.
    """
    env = env if env is not None else load_grid_app_env()
    endpoint = env.get("ZAP_SOLVER_MODAL_URL")
    api_key = env.get("ZAP_SOLVER_API_KEY")
    missing = [
        name
        for name, val in (
            ("ZAP_SOLVER_MODAL_URL", endpoint),
            ("ZAP_SOLVER_API_KEY", api_key),
        )
        if not val
    ]
    if missing:
        raise RuntimeError(
            "Modal solver not configured — missing "
            + ", ".join(missing)
            + " in grid-app/.env.local (no silent CPU fallback)"
        )

    nc_bytes = _export_truncated_netcdf(pnet, snapshots)
    body = json.dumps(
        {
            "network_nc_b64": base64.b64encode(nc_bytes).decode("ascii"),
            "args": dict(admm_args or HIGH_PRECISION_ADMM_ARGS),
            "import_args": {},
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        method="POST",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    timeout_s = int(env.get("ZAP_SOLVER_TIMEOUT_S") or 900)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode()[:500]
        except Exception:
            pass
        raise RuntimeError(
            f"Modal solver returned HTTP {exc.code}: {detail}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Modal solver unreachable ({exc.reason})"
        ) from exc
    return payload, time.time() - t0


def cpu_gpu_lmp_parity(
    cpu_prices: np.ndarray,
    gpu_prices: np.ndarray,
) -> tuple[float, float]:
    """Return ``(max_abs_diff, max_rel_diff)`` where ``max_rel_diff`` is
    ``max(|gpu - cpu|) / max(|cpu|)`` over the finite intersection of both
    grids. ``(nan, nan)`` if either side has no finite values.

    Caller is responsible for aligning shapes (bus axis, snapshot count)
    before passing the arrays in — :func:`adapt_modal_to_dispatch_outcome`
    already reindexes to ``pnet.buses.index``, and CPU/GPU share the same
    snapshot count via the same ``snapshots`` slice.
    """
    if cpu_prices.size == 0 or gpu_prices.size == 0:
        return float("nan"), float("nan")
    if cpu_prices.shape != gpu_prices.shape:
        # Truncate to the common shape so a mismatched snapshot count doesn't
        # raise — callers can read the printed parity number as "not
        # comparable" via the NaN return.
        n_b = min(cpu_prices.shape[0], gpu_prices.shape[0])
        n_t = min(cpu_prices.shape[1], gpu_prices.shape[1])
        if n_b == 0 or n_t == 0:
            return float("nan"), float("nan")
        cpu_prices = cpu_prices[:n_b, :n_t]
        gpu_prices = gpu_prices[:n_b, :n_t]
    diff = cpu_prices - gpu_prices
    finite = np.isfinite(diff)
    if not finite.any():
        return float("nan"), float("nan")
    max_abs = float(np.max(np.abs(diff[finite])))
    cpu_scale = float(np.nanmax(np.abs(cpu_prices)))
    max_rel = max_abs / cpu_scale if cpu_scale > 0 else float("inf")
    return max_abs, max_rel


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

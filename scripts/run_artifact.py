#!/usr/bin/env python3
"""Build a `kind='run'` artifact row from a dispatch outcome.

Used by the canonical-seed and upload-ingestion pipelines to attach a run to
the network they just solved. Stays best-effort: the renderer treats every
series as optional, so partial extraction (e.g. LMPs only) still produces a
useful page.

The view_spec shape matches `components/runs/RunView`:

  view_spec.hours    : ISO timestamps for each snapshot
  view_spec.lmps     : [{t, bus, value}]
  view_spec.carriers : [{t, carrier, value}] (best-effort)
  view_spec.flows    : [{t, line, value}]    (best-effort)
"""
from __future__ import annotations

from pathlib import Path
from typing import Any
import math

import numpy as np
import pandas as pd

MAX_BUS_SERIES = 200
MAX_LINE_SERIES = 200


def _safe_float(x: Any) -> float | None:
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _format_snapshots(snapshots: pd.Index) -> list[str]:
    if isinstance(snapshots, pd.DatetimeIndex):
        return [t.isoformat() for t in snapshots]
    return [str(t) for t in snapshots]


def _lmps_long(outcome, pnet, snapshots) -> list[dict[str, Any]]:
    prices = getattr(outcome, "prices", None)
    if prices is None:
        return []
    arr = np.asarray(prices)
    if arr.ndim == 1:
        arr = arr.reshape(-1, 1)
    n_buses, n_t = arr.shape
    bus_ids = [str(b) for b in pnet.buses.index[:n_buses]]
    times = _format_snapshots(snapshots[:n_t])
    if len(bus_ids) > MAX_BUS_SERIES:
        # Keep the buses with the highest LMP variance — likely most interesting.
        variances = np.nanvar(arr, axis=1)
        keep = np.argsort(variances)[-MAX_BUS_SERIES:]
        keep_set = set(keep.tolist())
    else:
        keep_set = set(range(len(bus_ids)))
    rows: list[dict[str, Any]] = []
    for i, bid in enumerate(bus_ids):
        if i not in keep_set:
            continue
        for j, t in enumerate(times):
            v = _safe_float(arr[i, j])
            if v is None:
                continue
            rows.append({"t": t, "bus": bid, "value": v})
    return rows


def _carrier_dispatch_long(pnet, snapshots) -> list[dict[str, Any]]:
    """Carrier dispatch is approximated from p_nom × per-snapshot availability.

    We don't have direct access to the device-class powers in a portable shape,
    so we fall back to PyPSA's reported `generators_t.p` when present (some
    PyPSA networks ship pre-solved snapshots). If not, return [].
    """
    p = getattr(pnet, "generators_t", None)
    if p is None:
        return []
    df = getattr(p, "p", None)
    if df is None or df.empty:
        return []
    # Map generator -> carrier
    carrier_by_gen = pnet.generators["carrier"].to_dict() if "carrier" in pnet.generators.columns else {}
    rows: list[dict[str, Any]] = []
    # Slice to the same snapshots
    df = df.loc[df.index.intersection(snapshots)]
    if df.empty:
        return []
    # Group columns by carrier
    by_carrier: dict[str, list[str]] = {}
    for gen in df.columns:
        c = str(carrier_by_gen.get(gen, "unknown"))
        by_carrier.setdefault(c, []).append(gen)
    times = _format_snapshots(df.index)
    for carrier, gens in by_carrier.items():
        totals = df[gens].sum(axis=1)
        for j, t in enumerate(times):
            v = _safe_float(totals.iloc[j])
            if v is None:
                continue
            rows.append({"t": t, "carrier": carrier, "value": v})
    return rows


def _line_flows_long(pnet, snapshots) -> list[dict[str, Any]]:
    p = getattr(pnet, "lines_t", None)
    if p is None:
        return []
    df = getattr(p, "p0", None)
    if df is None or df.empty:
        return []
    df = df.loc[df.index.intersection(snapshots)]
    if df.empty:
        return []
    times = _format_snapshots(df.index)
    cols = list(df.columns)
    if len(cols) > MAX_LINE_SERIES:
        # pick the highest-variance lines
        variances = df.var(axis=0).fillna(0.0)
        cols = list(variances.sort_values(ascending=False).index[:MAX_LINE_SERIES])
    rows: list[dict[str, Any]] = []
    for line in cols:
        col = df[line]
        for j, t in enumerate(times):
            v = _safe_float(col.iloc[j])
            if v is None:
                continue
            rows.append({"t": t, "line": str(line), "value": v})
    return rows


def build_run_view_spec(outcome, pnet, snapshots) -> dict[str, Any]:
    hours = _format_snapshots(snapshots)
    return {
        "renderer": "run",
        "hours": hours,
        "lmps": _lmps_long(outcome, pnet, snapshots),
        "carriers": _carrier_dispatch_long(pnet, snapshots),
        "flows": _line_flows_long(pnet, snapshots),
    }


def build_run_row(
    *,
    network_artifact: dict[str, Any] | None,
    network_name: str,
    network_slug: str | None,
    net_dir: Path,
    outcome,
    pnet,
    snapshots,
    used_solver: str,
    elapsed_s: float,
    canonical: bool,
) -> dict[str, Any]:
    """Build the JSON row to upsert into ``public.artifacts``.

    Caller is responsible for the actual HTTP request (so the row format stays
    portable between the seed script and the ingest pipeline).
    """
    view_spec = build_run_view_spec(outcome, pnet, snapshots)
    hours = len(snapshots)
    timestamp_slug = pd.Timestamp.utcnow().strftime("%Y%m%dT%H%M%SZ")
    metadata = {
        "network_name": network_name,
        "network_slug": network_slug,
        "network_artifact_id": (network_artifact or {}).get("id"),
        "hours": hours,
        "solver": used_solver,
        "elapsed_s": round(elapsed_s, 3),
        "buses": int(len(pnet.buses)),
        "lines": int(len(pnet.lines)),
        "generators": int(len(pnet.generators)),
        "fs_path": str(net_dir),
        "bundled": bool(canonical),
    }
    row: dict[str, Any] = {
        "kind": "run",
        "name": f"{network_name} · dispatch ({hours}h, {used_solver})",
        "slug": (
            f"run-{network_slug}-{timestamp_slug}" if network_slug else f"run-{timestamp_slug}"
        ),
        "metadata": metadata,
        "view_spec": view_spec,
        "status": "canonical" if canonical else "draft",
        "parent_id": (network_artifact or {}).get("id"),
    }
    if canonical:
        row["user_id"] = None
        row["org_id"] = None
    elif network_artifact and network_artifact.get("user_id"):
        row["user_id"] = network_artifact["user_id"]
    return row

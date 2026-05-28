#!/usr/bin/env python3
"""Run a capacity-expansion plan with zap and build a ``kind='plan'`` artifact.

This is the CPU planning counterpart to ``scripts/run_artifact.py`` (which
covers dispatch / ``kind='run'``). It wraps the zap hero loop documented in
``WORKSPACE_REDESIGN.md`` §7:

  1. ``net, devices = load_pypsa_network(pnet, snapshots)``
  2. pick the device capacities that are *free* → ``parameter_names``
  3. ``layer = DispatchLayer(net, devices, parameter_names, time_horizon=T)``
  4. ``op = DispatchCostObjective(net, devices) [+ λ·EmissionsObjective(devices)]``
  5. ``inv = InvestmentObjective(devices, layer)``
  6. ``prob = PlanningProblem(op, inv, layer, lower_bounds, upper_bounds)``
  7. ``state, history = prob.solve(num_iterations=N, ...)``

``solve()`` returns ``(state, history)`` where ``state`` maps each free
parameter to its optimized capacity array and ``history`` is a dict of
per-iteration tracker lists. zap ships ``loss`` / ``grad_norm`` trackers but no
``op_cost`` / ``inv_cost`` ones, so we register them at import time (additively,
into the *imported* ``TRACKER_MAPS`` dict — we never edit the read-only zap
source). Each reads ``problem.op_cost`` / ``problem.inv_cost``, which the CVX
problem stashes on every forward pass (``problem_cvx.py:62-64``).

The default zap solver is MOSEK, which isn't installed here; we pass
``solver=cp.HIGHS`` to the dispatch layer instead (the same CPU solver
``smoke_dispatch`` prefers).

Kept best-effort: a network whose generators carry no ``capital_cost`` simply
reports ``inv_cost == 0`` (the loss curve and capacity trajectory still tell the
planning story).

The ``view_spec`` (consumed by ``components/renderers/plan.tsx``) carries the
five panels ``WORKSPACE_REDESIGN.md`` §7 calls for, each independently optional:

  * ``loss`` / ``op_cost`` / ``inv_cost`` — the per-iteration objective curves,
  * ``trajectory`` — per-generator capacity over iterations (``PARAM`` tracker),
  * ``capacity_table`` — the final build (before → after → Δ → capex),
  * ``dispatch`` — a Run view_spec solved at the final capacities (reuses the
    ``run`` renderer's LMP / carrier / flow charts),
  * ``cost_emissions`` — achieved (op_cost, emissions) point(s) for the
    cost-vs-emissions panel.

A panel whose data couldn't be produced (e.g. emissions unavailable, dispatch
re-solve failed) is simply omitted; the renderer degrades gracefully.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import _pypsa_compat  # noqa: F401,E402  must precede pypsa/zap imports

import cvxpy as cp  # noqa: E402
import pypsa  # noqa: E402
import zap  # noqa: E402
from zap.importers.pypsa import load_pypsa_network  # noqa: E402
from zap.planning import (  # noqa: E402
    DispatchCostObjective,
    EmissionsObjective,
    GradientDescent,
    InvestmentObjective,
    PlanningProblem,
)
import zap.planning.trackers as trackers  # noqa: E402

from run_artifact import build_run_view_spec  # noqa: E402


OP_COST = "op_cost"
INV_COST = "inv_cost"
DEFAULT_SOLVER = "HIGHS"
# Capacity headroom: free generators can expand up to this multiple of their
# current nominal capacity (and shrink to zero), giving the optimizer room to
# actually move so the trajectory isn't flat.
DEFAULT_CAP_MULTIPLIER = 3.0


def _to_float(x: Any) -> float | None:
    try:
        if hasattr(x, "detach"):
            x = x.detach().cpu().numpy()
        f = float(np.asarray(x))
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _register_cost_trackers() -> None:
    """Add ``op_cost`` / ``inv_cost`` trackers to zap's tracker map in-process.

    Additive: we mutate the imported module dict, never the zap source file.
    Both readers pull the unweighted cost the CVX problem stores on each
    forward pass."""
    trackers.TRACKER_MAPS.setdefault(
        OP_COST, lambda J, g, s, ls, p: _to_float(getattr(p, "op_cost", None))
    )
    trackers.TRACKER_MAPS.setdefault(
        INV_COST, lambda J, g, s, ls, p: _to_float(getattr(p, "inv_cost", None))
    )


_register_cost_trackers()


def load_network(net_dir: Path, hours: int):
    """Load a PyPSA CSV folder and return ``(pnet, snapshots, net, devices)``."""
    if not (net_dir / "buses.csv").exists():
        raise FileNotFoundError(
            f"{net_dir} doesn't look like a PyPSA CSV folder (missing buses.csv)"
        )
    pnet = pypsa.Network()
    pnet.import_from_csv_folder(str(net_dir))
    if len(pnet.snapshots) == 0:
        pnet.set_snapshots(pd.date_range("2024-01-01", periods=1, freq="h"))
    snapshots = pnet.snapshots[:hours]
    net, devices = load_pypsa_network(pnet, snapshots)
    return pnet, snapshots, net, devices


def _free_generator_params(devices) -> tuple[dict, int]:
    """Mark generator nominal capacities as the free parameter.

    Returns ``(parameter_names, generator_device_index)``. Raises if the
    network has no generator device (nothing to expand)."""
    for i, d in enumerate(devices):
        if type(d).__name__ == "Generator":
            return {"generator": (i, "nominal_capacity")}, i
    raise RuntimeError("network has no Generator device to plan capacity for")


def _history_to_json(history: dict) -> dict[str, list]:
    """Coerce tracked series into JSON-friendly lists of floats."""
    out: dict[str, list] = {}
    for key in (trackers.LOSS, OP_COST, INV_COST, trackers.GRAD_NORM):
        series = history.get(key)
        if not series:
            continue
        out[key] = [_to_float(v) for v in series]
    return out


# How many of the most-moved generators to keep in the per-iteration capacity
# trajectory, so a many-generator network doesn't bloat the artifact / chart.
MAX_TRAJECTORY_SERIES = 12


def _capacity_trajectory(
    history: dict, gen_names: list[str]
) -> list[dict[str, Any]]:
    """Long-format per-generator capacity over iterations from the ``PARAM``
    tracker (``history['param'][k]['generator']`` is the state at iteration k).

    Returns ``[{iteration, device, capacity}]`` for the generators that move
    the most (top :data:`MAX_TRAJECTORY_SERIES` by absolute first→last delta),
    so the chart stays legible. Returns ``[]`` if the tracker is absent."""
    param_series = history.get(trackers.PARAM)
    if not param_series:
        return []
    # Materialize the per-iteration capacity matrix (iterations × generators).
    caps_per_iter: list[np.ndarray] = []
    for snap in param_series:
        gen = snap.get("generator") if isinstance(snap, dict) else None
        if gen is None:
            continue
        caps_per_iter.append(np.asarray(_as_numpy(gen), dtype=float).ravel())
    if not caps_per_iter:
        return []
    n_gen = min(len(gen_names), min(c.size for c in caps_per_iter))
    if n_gen == 0:
        return []
    # Pick the generators that actually moved (first → last absolute change).
    deltas = np.abs(caps_per_iter[-1][:n_gen] - caps_per_iter[0][:n_gen])
    keep = (
        set(np.argsort(deltas)[-MAX_TRAJECTORY_SERIES:].tolist())
        if n_gen > MAX_TRAJECTORY_SERIES
        else set(range(n_gen))
    )
    rows: list[dict[str, Any]] = []
    for it, caps in enumerate(caps_per_iter):
        for g in range(n_gen):
            if g not in keep:
                continue
            v = _to_float(caps[g])
            if v is None:
                continue
            rows.append({"iteration": it, "device": gen_names[g], "capacity": v})
    return rows


def _as_numpy(x: Any):
    """Detach a torch tensor (or pass through an array) to a numpy array."""
    if hasattr(x, "detach"):
        return x.detach().cpu().numpy()
    return np.asarray(x)


def _capex_for(capacity_table: list[dict[str, Any]], capital_cost) -> None:
    """Annotate the final-build rows with a per-generator ``delta`` and
    ``capex`` (``capital_cost * max(delta, 0)``) in place.

    ``capital_cost`` may be ``None`` (no cost data on the device), in which case
    only ``delta`` is filled and ``capex`` is left ``None``."""
    cc = None
    if capital_cost is not None:
        cc = np.asarray(_as_numpy(capital_cost), dtype=float).ravel()
    for i, row in enumerate(capacity_table):
        before = row.get("before")
        after = row.get("after")
        delta = (after - before) if (before is not None and after is not None) else None
        row["delta"] = _to_float(delta) if delta is not None else None
        if cc is not None and i < cc.size and delta is not None:
            row["capex"] = _to_float(float(cc[i]) * max(delta, 0.0))
        else:
            row["capex"] = None


def _final_dispatch_spec(layer, state, pnet, snapshots) -> dict[str, Any] | None:
    """Re-solve dispatch at the optimized capacities and build a ``run``
    view_spec from the outcome (LMP / carrier / flow charts via the shared
    ``run_artifact`` builder). Best-effort: returns ``None`` if the re-solve or
    extraction fails so the rest of the plan still renders."""
    try:
        outcome = layer.forward(**state)
        return build_run_view_spec(outcome, pnet, snapshots)
    except Exception:
        return None


def _emissions_point(
    devices, layer, state, op_cost: float | None, emissions_weight: float
) -> dict[str, Any] | None:
    """Compute the achieved (op_cost, emissions) pair at the final capacities
    for the cost-vs-emissions panel. Best-effort — returns ``None`` if emissions
    can't be evaluated (e.g. devices carry no emission rates)."""
    try:
        outcome = layer.forward(**state)
        emissions = EmissionsObjective(devices)(outcome, la=np)
        em = _to_float(emissions)
        if em is None:
            return None
        return {
            "op_cost": op_cost,
            "emissions": em,
            "emissions_weight": float(emissions_weight),
        }
    except Exception:
        return None


def run_plan(
    net_dir: Path,
    *,
    hours: int = 1,
    num_iterations: int = 5,
    emissions_weight: float = 0.0,
    step_size: float = 1e-1,
    cap_multiplier: float = DEFAULT_CAP_MULTIPLIER,
    solver: str = DEFAULT_SOLVER,
) -> dict[str, Any]:
    """Solve a small capacity-expansion plan on a reference network folder.

    Returns a dict with ``history`` (loss / op_cost / inv_cost per iteration),
    ``final_caps`` (per-generator capacity before → after), the scalar final
    op/inv costs, plus solver / shape provenance. CPU-only; ``num_iterations``
    is intended to be small (a handful) so it finishes in seconds. Modal / GPU
    is never involved."""
    if hours < 1:
        raise ValueError("hours must be >= 1")
    if num_iterations < 1:
        raise ValueError("num_iterations must be >= 1")

    pnet, snapshots, net, devices = load_network(net_dir, hours)
    parameter_names, gen_idx = _free_generator_params(devices)

    cp_solver = getattr(cp, solver, None)
    if cp_solver is None:
        raise ValueError(f"cvxpy solver {solver!r} not available")

    layer = zap.DispatchLayer(
        net,
        devices,
        parameter_names=parameter_names,
        time_horizon=len(snapshots),
        solver=cp_solver,
    )

    initial_caps = np.asarray(devices[gen_idx].nominal_capacity, dtype=float)
    lower_bounds = {"generator": np.zeros_like(initial_caps)}
    upper_bounds = {"generator": initial_caps * float(cap_multiplier)}

    op_objective = DispatchCostObjective(net, devices)
    if emissions_weight and emissions_weight > 0:
        op_objective = op_objective + float(emissions_weight) * EmissionsObjective(
            devices
        )
    inv_objective = InvestmentObjective(devices, layer)

    problem = PlanningProblem(
        op_objective,
        inv_objective,
        layer,
        lower_bounds=lower_bounds,
        upper_bounds=upper_bounds,
    )

    state, history = problem.solve(
        num_iterations=int(num_iterations),
        algorithm=GradientDescent(step_size=float(step_size), clip=1e4),
        trackers=[
            trackers.LOSS,
            OP_COST,
            INV_COST,
            trackers.GRAD_NORM,
            trackers.PARAM,
        ],
        verbosity=0,
    )

    final_caps = np.asarray(state["generator"], dtype=float).ravel()
    gen_names = [str(g) for g in pnet.generators.index[: final_caps.size]]
    carriers = (
        pnet.generators["carrier"].astype(str).tolist()[: final_caps.size]
        if "carrier" in pnet.generators.columns
        else ["" for _ in gen_names]
    )
    initial_flat = initial_caps.ravel()[: final_caps.size]

    capacity_table = [
        {
            "device": gen_names[i] if i < len(gen_names) else f"gen_{i}",
            "carrier": carriers[i] if i < len(carriers) else "",
            "before": _to_float(initial_flat[i]) if i < initial_flat.size else None,
            "after": _to_float(final_caps[i]),
        }
        for i in range(final_caps.size)
    ]
    _capex_for(capacity_table, getattr(devices[gen_idx], "capital_cost", None))

    final_op_cost = _to_float(problem.get_op_cost())

    return {
        "history": _history_to_json(history),
        "trajectory": _capacity_trajectory(history, gen_names),
        "iterations": int(num_iterations),
        "emissions_weight": float(emissions_weight),
        "solver": solver,
        "hours": int(len(snapshots)),
        "capacity_table": capacity_table,
        "dispatch": _final_dispatch_spec(layer, state, pnet, snapshots),
        "cost_emissions": _emissions_point(
            devices, layer, state, final_op_cost, emissions_weight
        ),
        "final_op_cost": final_op_cost,
        "final_inv_cost": _to_float(problem.get_inv_cost()),
        "final_loss": (
            _to_float(history[trackers.LOSS][-1])
            if history.get(trackers.LOSS)
            else None
        ),
        "buses": int(len(pnet.buses)),
        "lines": int(len(pnet.lines)),
        "generators": int(len(pnet.generators)),
    }


def build_plan_view_spec(plan: dict[str, Any]) -> dict[str, Any]:
    """``plan`` view_spec consumed by ``components/renderers/plan.tsx``.

    Encodes the five panels from ``WORKSPACE_REDESIGN.md`` §7 — the loss /
    objective curves, the per-generator capacity trajectory, the final-build
    table, the resulting dispatch (a ``run`` sub-spec the plan renderer hands to
    the shared ``RunView``), and the cost-vs-emissions panel. Every field is
    optional; the renderer omits any panel whose data is empty/absent."""
    history = plan.get("history") or {}
    spec: dict[str, Any] = {
        "renderer": "plan",
        "loss": history.get("loss", []),
        "op_cost": history.get(OP_COST, []),
        "inv_cost": history.get(INV_COST, []),
        "trajectory": plan.get("trajectory", []),
        "capacity_table": plan.get("capacity_table", []),
        "emissions_weight": plan.get("emissions_weight", 0.0),
    }
    # A nested `run` view_spec; the plan renderer delegates it to RunView so the
    # LMP / carrier / flow charts are not re-implemented (§7 "resulting dispatch").
    dispatch = plan.get("dispatch")
    if dispatch:
        spec["dispatch"] = dispatch
    # The cost-vs-emissions panel needs at least the achieved point.
    cost_emissions = plan.get("cost_emissions")
    if cost_emissions:
        spec["cost_emissions"] = cost_emissions
    return spec


def build_plan_row(
    *,
    network_artifact: dict[str, Any] | None,
    network_name: str,
    network_slug: str | None,
    net_dir: Path,
    plan: dict[str, Any],
    canonical: bool = False,
) -> dict[str, Any]:
    """Build the JSON row to insert into ``public.artifacts`` for a plan.

    Mirrors ``run_artifact.build_run_row`` so the caller owns the HTTP request.
    ``plan`` is the dict returned by :func:`run_plan`."""
    timestamp_slug = pd.Timestamp.now("UTC").strftime("%Y%m%dT%H%M%SZ")
    metadata: dict[str, Any] = {
        "network_name": network_name,
        "network_slug": network_slug,
        "network_artifact_id": (network_artifact or {}).get("id"),
        "hours": plan.get("hours"),
        "iterations": plan.get("iterations"),
        "emissions_weight": plan.get("emissions_weight"),
        "solver": plan.get("solver"),
        "history": plan.get("history"),
        "final_caps": plan.get("capacity_table"),
        "final_op_cost": plan.get("final_op_cost"),
        "final_inv_cost": plan.get("final_inv_cost"),
        "final_loss": plan.get("final_loss"),
        "buses": plan.get("buses"),
        "lines": plan.get("lines"),
        "generators": plan.get("generators"),
        "fs_path": str(net_dir),
        "bundled": bool(canonical),
    }
    row: dict[str, Any] = {
        "kind": "plan",
        "name": (
            f"{network_name} · plan ({plan.get('iterations')} iters, "
            f"{plan.get('solver')})"
        ),
        "slug": (
            f"plan-{network_slug}-{timestamp_slug}"
            if network_slug
            else f"plan-{timestamp_slug}"
        ),
        "metadata": metadata,
        "view_spec": build_plan_view_spec(plan),
        "status": "canonical" if canonical else "draft",
        "parent_id": (network_artifact or {}).get("id"),
    }
    if canonical:
        row["user_id"] = None
        row["org_id"] = None
    elif network_artifact and network_artifact.get("user_id"):
        row["user_id"] = network_artifact["user_id"]
    return row

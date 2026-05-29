#!/usr/bin/env python3
"""Smoke-validate the focus → planning-problem helper (REDESIGN_ROADMAP §14).

Two layers, deliberately split so the cheap one runs without cvxpy/torch:

1. **Shape contract (no zap)** — exercise ``focus_problem.assemble_focus_plan``
   against a tiny stand-in device list (mirroring the ieee-30 device classes:
   Generator / Load / ACLine) and assert the §6 mapping:
     * ``[Generation, Decarbonization]`` → free generator ``nominal_capacity``
       + a positive emissions weight + the Investment term on.
     * ``[Operations]`` → no free params (Run, not Plan).
     * ``[Transmission]`` → free line ``nominal_capacity`` + Investment.
     * ``[General]`` → every expandable capacity free + emissions on.
   Synonyms ("Generation expansion", "Decarbonisation") normalize correctly.

2. **Live zap shapes (optional)** — when the zap venv is importable, load the
   real ``data/networks/ieee-30`` folder, run ``assemble_focus_plan`` over the
   genuine device objects, and confirm the generator parameter resolves to the
   real Generator device index + ``nominal_capacity``. Skipped (not failed) if
   zap/cvxpy/torch can't import in the running interpreter.

Run from ``/home/agent/grid-app``::

    python scripts/_smoke_focus_problem.py            # shape contract only by default unless zap imports
    /home/agent/zap/.venv/bin/python scripts/_smoke_focus_problem.py   # also runs layer 2

Exits 0 when the shape contract passes; non-zero with a diagnostic otherwise.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from focus_problem import (  # noqa: E402
    DEFAULT_EMISSIONS_WEIGHT,
    assemble_focus_plan,
    normalize_focus,
)


class _FakeDevice:
    """Stand-in carrying only the class name + the free attribute zap reads."""

    def __init__(self, class_name: str, attr_value: float = 100.0):
        self._class_name = class_name
        # Give it both possible free attrs so build_bounds would work too.
        self.nominal_capacity = attr_value
        self.power_capacity = attr_value
        self.capital_cost = 1.0


def _make(class_name: str) -> _FakeDevice:
    d = _FakeDevice(class_name)
    # Rename the type so type(d).__name__ matches the zap class.
    d.__class__ = type(class_name, (_FakeDevice,), {})
    return d


# Device order mirrors what load_pypsa_network emits for ieee-30:
# Generator (idx 0), Load (idx 1), ACLine (idx 2). No Battery in ieee-30.
IEEE30_SHAPES = [_make("Generator"), _make("Load"), _make("ACLine")]


def _fail(msg: str) -> int:
    print(f"FAIL [shape]: {msg}")
    return 1


def smoke_shape_contract() -> int:
    print("[shape] focus → parameter_names + objective composition", flush=True)

    # --- normalize_focus: synonyms + dedupe + empty fallback -------------
    if normalize_focus(["Generation expansion", "Decarbonisation"]) != [
        "generation",
        "decarbonization",
    ]:
        return _fail("synonym normalization wrong")
    if normalize_focus([]) != ["operations"]:
        return _fail("empty focus should normalize to [operations]")
    if normalize_focus(["nonsense-tag"]) != ["operations"]:
        return _fail("all-unknown focus should normalize to [operations]")

    # --- the headline acceptance case: [Generation, Decarbonization] -----
    plan = assemble_focus_plan(IEEE30_SHAPES, ["Generation", "Decarbonization"])
    if "generator" not in plan.parameter_names:
        return _fail(f"generator not free for Generation: {plan.parameter_names}")
    if plan.parameter_names["generator"] != (0, "nominal_capacity"):
        return _fail(
            f"generator param should be (0, nominal_capacity), got "
            f"{plan.parameter_names['generator']}"
        )
    if not (plan.emissions_weight and plan.emissions_weight > 0):
        return _fail(f"Decarbonization should set λ>0, got {plan.emissions_weight}")
    if plan.emissions_weight != DEFAULT_EMISSIONS_WEIGHT:
        return _fail(
            f"default λ should be {DEFAULT_EMISSIONS_WEIGHT}, got {plan.emissions_weight}"
        )
    if not plan.include_investment:
        return _fail("Generation expansion should turn the Investment term on")
    if not plan.is_planning:
        return _fail("a free capacity should make this a planning (Plan) problem")
    print(
        f"OK   [shape]: [Generation, Decarbonization] → free {plan.parameter_names}, "
        f"λ={plan.emissions_weight}, investment={plan.include_investment}"
    )

    # --- emissions_weight override (explicit λ wins / can force pure cost) -
    forced = assemble_focus_plan(
        IEEE30_SHAPES, ["Generation", "Decarbonization"], emissions_weight=2.0
    )
    if forced.emissions_weight != 2.0:
        return _fail(f"explicit λ override ignored: {forced.emissions_weight}")
    pure = assemble_focus_plan(
        IEEE30_SHAPES, ["Generation", "Decarbonization"], emissions_weight=0.0
    )
    if pure.emissions_weight != 0.0:
        return _fail(f"λ=0 override should force pure cost, got {pure.emissions_weight}")

    # --- Operations-only → no free params (Run, not Plan) ----------------
    ops = assemble_focus_plan(IEEE30_SHAPES, ["Operations"])
    if ops.parameter_names:
        return _fail(f"Operations should free nothing, got {ops.parameter_names}")
    if ops.is_planning:
        return _fail("Operations-only must not be a planning problem")
    if ops.include_investment:
        return _fail("Operations-only must not include Investment")

    # --- Transmission → free line capacity + Investment ------------------
    trans = assemble_focus_plan(IEEE30_SHAPES, ["Transmission"])
    if trans.parameter_names.get("acline") != (2, "nominal_capacity"):
        return _fail(f"Transmission should free the ACLine: {trans.parameter_names}")
    if not trans.include_investment:
        return _fail("Transmission should include Investment")
    if trans.emissions_weight != 0.0:
        return _fail("Transmission alone should not add emissions")

    # --- Storage focus with no storage device → no storage param ---------
    # (ieee-30 has no Battery, so Storage frees nothing here.)
    storage = assemble_focus_plan(IEEE30_SHAPES, ["Storage"])
    if any(lbl in storage.parameter_names for lbl in ("battery", "storageunit", "store")):
        return _fail(f"Storage should be inert without a storage device: {storage.parameter_names}")

    # --- Decarbonization ALONE → implies generation expansion ------------
    decarb = assemble_focus_plan(IEEE30_SHAPES, ["Decarbonization"])
    if "generator" not in decarb.parameter_names:
        return _fail("Decarbonization alone should imply generation expansion")
    if not (decarb.emissions_weight > 0):
        return _fail("Decarbonization alone should set λ>0")

    # --- General → every expandable capacity free + emissions on ---------
    gen = assemble_focus_plan(IEEE30_SHAPES, ["General"])
    if "generator" not in gen.parameter_names or "acline" not in gen.parameter_names:
        return _fail(f"General should free generator + line: {gen.parameter_names}")
    if not (gen.emissions_weight > 0):
        return _fail("General should turn emissions on")

    print("OK   [shape]: Operations / Transmission / Storage / General all map per §6")
    return 0


def smoke_live_zap(net_dir: Path, hours: int = 1) -> int:
    """Layer 2: run assemble_focus_plan over genuine ieee-30 device objects."""
    try:
        import _pypsa_compat  # noqa: F401
        from plan_artifact import load_network  # imports zap/cvxpy
    except Exception as exc:  # noqa: BLE001
        print(f"[live] skipped — zap/cvxpy not importable here ({exc})")
        return 0

    print(f"[live] assemble_focus_plan over real {net_dir.name} devices", flush=True)
    try:
        _pnet, _snapshots, _net, devices = load_network(net_dir, hours)
    except Exception as exc:  # noqa: BLE001
        print(f"[live] skipped — could not load {net_dir} ({exc})")
        return 0

    plan = assemble_focus_plan(devices, ["Generation", "Decarbonization"])
    if "generator" not in plan.parameter_names:
        print(f"FAIL [live]: generator not free over real devices: {plan.parameter_names}")
        return 1
    idx, attr = plan.parameter_names["generator"]
    if type(devices[idx]).__name__ != "Generator" or attr != "nominal_capacity":
        print(
            f"FAIL [live]: generator param resolves to "
            f"{type(devices[idx]).__name__}.{attr}, expected Generator.nominal_capacity"
        )
        return 1
    if not (plan.emissions_weight > 0 and plan.include_investment):
        print(f"FAIL [live]: expected λ>0 + investment, got plan={plan}")
        return 1

    # build_bounds should work over the real device numpy capacity arrays.
    import numpy as np

    from focus_problem import build_bounds

    lower, upper = build_bounds(plan, devices, np=np)
    if "generator" not in lower or "generator" not in upper:
        print(f"FAIL [live]: build_bounds missing generator key: {lower.keys()}")
        return 1
    if not (np.all(np.asarray(upper["generator"]) >= np.asarray(lower["generator"]))):
        print("FAIL [live]: upper bound below lower bound")
        return 1

    print(
        f"OK   [live]: generator idx={idx} ({attr}) free, λ={plan.emissions_weight}, "
        f"bounds shaped {np.asarray(upper['generator']).shape}"
    )
    return 0


def main() -> int:
    rc = smoke_shape_contract()
    if rc != 0:
        return rc
    net_dir = ROOT / "data/networks/ieee-30"
    if (net_dir / "buses.csv").exists():
        rc = smoke_live_zap(net_dir)
        if rc != 0:
            return rc
    print("ALL OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())

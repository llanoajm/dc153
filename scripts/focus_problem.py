#!/usr/bin/env python3
"""Focus tags → planning-problem assembly (REDESIGN_ROADMAP §14, WORKSPACE_REDESIGN §6).

The workspace creation wizard captures an *intent* as a set of focus tags
(``Operations`` / ``Generation`` / ``Transmission`` / ``Storage`` /
``Decarbonization`` / ``General``). Per ``WORKSPACE_REDESIGN.md`` §6 those tags
are NOT cosmetic — they literally assemble the zap planning problem:

  * which device capacities become *free* decision variables
    (``DispatchLayer.parameter_names``), and
  * which objective terms turn on
    (``DispatchCost`` [+ λ·``Emissions``] + ``Investment``).

This module is the single source of that mapping. It has two layers:

1. A **pure** layer (no zap import) that turns ``(devices, focus)`` into a
   :class:`FocusPlan` describing the free ``parameter_names`` and which
   objective terms apply. This is what the unit smoke exercises against the
   ieee-30 device shapes — it never needs cvxpy/torch.

2. A thin **builder** layer (:func:`build_objectives`, :func:`build_bounds`)
   that, given the already-imported zap objective classes + the loaded
   ``net``/``devices``/``layer``, materializes the concrete
   ``op_objective`` / ``inv_objective`` / bounds. ``scripts/plan_artifact.py``
   calls these so the hero loop and the wizard agree on the composition.

§6 table (verbatim mapping):

| Focus tag        | Free parameters (parameter_names)      | Objective terms added       |
|------------------|----------------------------------------|-----------------------------|
| Operations       | none (dispatch only)                   | DispatchCost → Runs not Plans|
| Generation       | generator ``nominal_capacity``         | + Investment(capex)         |
| Transmission     | line ``nominal_capacity``              | + Investment(capex)         |
| Storage          | storage ``power_capacity``             | + Investment(capex)         |
| Decarbonization  | (combines with the above)              | + λ·Emissions               |
| General / all    | all capacities free                    | DispatchCost + Emissions + Investment |
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# --- Focus vocabulary -------------------------------------------------------
# Canonical tags. We normalize the wizard's free-text chips against this set so
# "Generation expansion", "generation", "Gen" all resolve to GENERATION.
OPERATIONS = "operations"
GENERATION = "generation"
TRANSMISSION = "transmission"
STORAGE = "storage"
DECARBONIZATION = "decarbonization"
GENERAL = "general"

#: Synonyms → canonical tag. Keys are lower-cased, whitespace-collapsed.
_FOCUS_SYNONYMS: dict[str, str] = {
    "operations": OPERATIONS,
    "operation": OPERATIONS,
    "dispatch": OPERATIONS,
    "ops": OPERATIONS,
    "generation": GENERATION,
    "generation expansion": GENERATION,
    "gen": GENERATION,
    "generators": GENERATION,
    "transmission": TRANSMISSION,
    "transmission expansion": TRANSMISSION,
    "lines": TRANSMISSION,
    "grid expansion": TRANSMISSION,
    "storage": STORAGE,
    "storage & flexibility": STORAGE,
    "storage and flexibility": STORAGE,
    "flexibility": STORAGE,
    "batteries": STORAGE,
    "decarbonization": DECARBONIZATION,
    "decarbonisation": DECARBONIZATION,
    "emissions": DECARBONIZATION,
    "climate": DECARBONIZATION,
    "general": GENERAL,
    "general / all": GENERAL,
    "all": GENERAL,
}

#: Default λ on the emissions term when Decarbonization (or General) is on but
#: the caller didn't supply a weight. Small positive so the term actually
#: nudges the build without overwhelming the cost objective.
DEFAULT_EMISSIONS_WEIGHT = 0.5

#: Which device class name owns the free capacity for each *expansion* focus,
#: and which attribute on that device is the free parameter. Mirrors
#: ``DispatchLayer.parameter_names`` semantics (label → (device_index, attr)).
#: Storage capacity is ``power_capacity``; gens/lines use ``nominal_capacity``.
_EXPANSION_DEVICE_ATTR: dict[str, tuple[tuple[str, ...], str]] = {
    # focus → (acceptable device class names, free attribute)
    GENERATION: (("Generator",), "nominal_capacity"),
    TRANSMISSION: (("ACLine", "DCLine"), "nominal_capacity"),
    STORAGE: (("Battery", "StorageUnit", "Store"), "power_capacity"),
}


def normalize_focus(focus: list[str] | tuple[str, ...] | None) -> list[str]:
    """Map raw focus chips to the canonical tag set, de-duped and ordered.

    Unknown chips are dropped (the wizard is free-text). An empty / all-unknown
    list normalizes to ``[OPERATIONS]`` — the dispatch-only degenerate case
    (§9 open question 4)."""
    if not focus:
        return [OPERATIONS]
    seen: list[str] = []
    for raw in focus:
        if raw is None:
            continue
        key = " ".join(str(raw).strip().lower().split())
        tag = _FOCUS_SYNONYMS.get(key)
        if tag and tag not in seen:
            seen.append(tag)
    return seen or [OPERATIONS]


@dataclass
class FocusPlan:
    """The planning-problem shape implied by a set of focus tags.

    ``parameter_names`` is ready to hand to ``DispatchLayer(parameter_names=…)``;
    it maps a label (the device class lower-cased, e.g. ``"generator"``) to
    ``(device_index, attribute)``. When it's empty the workspace is
    operations-only (produces Runs, not Plans).
    """

    focus: list[str]
    parameter_names: dict[str, tuple[int, str]] = field(default_factory=dict)
    include_dispatch_cost: bool = True
    include_investment: bool = False
    emissions_weight: float = 0.0

    @property
    def is_planning(self) -> bool:
        """True when at least one capacity is free (so there's something to
        optimize → a Plan). Operations-only ⇒ False ⇒ Run."""
        return bool(self.parameter_names)

    @property
    def free_device_indices(self) -> list[int]:
        return [idx for (idx, _attr) in self.parameter_names.values()]


def _device_class_name(device: Any) -> str:
    return type(device).__name__


def assemble_focus_plan(
    devices: list[Any],
    focus: list[str] | tuple[str, ...] | None,
    *,
    emissions_weight: float | None = None,
) -> FocusPlan:
    """Pure mapping: ``(devices, focus)`` → :class:`FocusPlan`.

    ``devices`` is the list from ``load_pypsa_network`` (only their *class
    names* and presence are read here — no solving, no zap import). ``focus`` is
    the raw wizard chips. ``emissions_weight`` overrides the default λ when
    Decarbonization/General is on (None → :data:`DEFAULT_EMISSIONS_WEIGHT`;
    pass 0 to force a pure-cost plan even under Decarbonization).

    Resolution rules (from §6):
      * Operations alone → no free params (dispatch only).
      * Generation/Transmission/Storage → free the matching device's capacity +
        turn on the Investment (capex) term.
      * Decarbonization → add λ·Emissions; combines with the expansion tags. On
        its own (no expansion tag) it has nothing to expand, so it implies
        Generation expansion (the common "cut emissions by building clean gen"
        intent) so the plan isn't a no-op.
      * General → free every expandable device capacity + DispatchCost +
        Emissions + Investment.
    """
    tags = normalize_focus(focus)
    by_class: dict[str, int] = {}
    for i, d in enumerate(devices):
        by_class.setdefault(_device_class_name(d), i)

    # Which expansion focuses are active?
    if GENERAL in tags:
        active_expansion = [GENERATION, TRANSMISSION, STORAGE]
        decarb = True
    else:
        active_expansion = [t for t in tags if t in _EXPANSION_DEVICE_ATTR]
        decarb = DECARBONIZATION in tags
        # Decarbonization with no expansion target → expand generation (so the
        # "reduce emissions" intent has a lever; otherwise it's dispatch-only
        # and emissions can't change).
        if decarb and not active_expansion:
            active_expansion = [GENERATION]

    parameter_names: dict[str, tuple[int, str]] = {}
    for tag in active_expansion:
        class_names, attr = _EXPANSION_DEVICE_ATTR[tag]
        for cname in class_names:
            idx = by_class.get(cname)
            if idx is None:
                continue
            # Label keyed by the device class lower-cased (e.g. "generator",
            # "acline") — unique per device class, matches zap's convention.
            label = cname.lower()
            parameter_names[label] = (idx, attr)
            break  # first present class for this focus wins

    resolved_weight = (
        DEFAULT_EMISSIONS_WEIGHT if emissions_weight is None else float(emissions_weight)
    )
    return FocusPlan(
        focus=tags,
        parameter_names=parameter_names,
        include_dispatch_cost=True,
        include_investment=bool(parameter_names),
        emissions_weight=(resolved_weight if decarb else 0.0),
    )


def build_objectives(
    plan: FocusPlan,
    net: Any,
    devices: list[Any],
    layer: Any,
    *,
    DispatchCostObjective: Any,
    EmissionsObjective: Any,
    InvestmentObjective: Any,
) -> tuple[Any, Any | None]:
    """Materialize ``(op_objective, inv_objective)`` from a :class:`FocusPlan`.

    The zap objective classes are passed in (not imported here) so this module
    stays import-light for the unit smoke. ``op_objective`` is
    ``DispatchCost [+ λ·Emissions]``; ``inv_objective`` is an
    ``InvestmentObjective`` when any capacity is free, else ``None``
    (operations-only ⇒ pure dispatch, no investment term)."""
    op_objective = DispatchCostObjective(net, devices)
    if plan.emissions_weight and plan.emissions_weight > 0:
        op_objective = op_objective + float(plan.emissions_weight) * EmissionsObjective(
            devices
        )
    inv_objective = (
        InvestmentObjective(devices, layer) if plan.include_investment else None
    )
    return op_objective, inv_objective


def build_bounds(
    plan: FocusPlan,
    devices: list[Any],
    *,
    np: Any,
    cap_multiplier: float = 3.0,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Per-parameter ``(lower_bounds, upper_bounds)`` for a :class:`FocusPlan`.

    Each free capacity can shrink to zero and expand to ``cap_multiplier`` ×
    its current value, giving the optimizer room to move. Keyed by the same
    labels as ``plan.parameter_names`` so they line up with
    ``DispatchLayer.parameter_names``."""
    lower: dict[str, Any] = {}
    upper: dict[str, Any] = {}
    for label, (idx, attr) in plan.parameter_names.items():
        current = np.asarray(getattr(devices[idx], attr), dtype=float)
        lower[label] = np.zeros_like(current)
        upper[label] = current * float(cap_multiplier)
    return lower, upper

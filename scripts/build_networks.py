#!/usr/bin/env python3
"""Build the bundled reference networks under ``data/networks/``.

For each network we produce a PyPSA CSV folder (the format every downstream
ingestion path expects) plus a ``card.md`` describing source, license, scale,
carrier mix, an example zap solve script, and a suggested first prompt.

This is a build-time script. The produced CSV folders are committed to the
repo so the runtime never needs MATPOWER fetches or pypsa.examples downloads.
Re-run when sources change.
"""
from __future__ import annotations

import json
import shutil
import sys
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import _pypsa_compat  # noqa: F401  (must import before pypsa/zap)
import pypsa  # noqa: E402

from _matpower import parse_matpower  # noqa: E402

DATA_ROOT = ROOT / "data" / "networks"

MATPOWER_BASE = "https://raw.githubusercontent.com/MATPOWER/matpower/master/data"


def _fetch_matpower(case: str, dest: Path) -> Path:
    """Download a MATPOWER `.m` file if we don't already have it cached."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    url = f"{MATPOWER_BASE}/{case}.m"
    print(f"fetch {url} -> {dest}")
    with urllib.request.urlopen(url, timeout=30) as resp:
        dest.write_bytes(resp.read())
    return dest


def _matpower_to_pypsa(
    mp: dict,
    name: str,
    *,
    default_carrier: str = "thermal",
    carrier_co2: float = 0.5,
) -> pypsa.Network:
    """Best-effort MATPOWER → PyPSA conversion.

    MATPOWER doesn't carry fuel-type info, so all generators get a single
    ``thermal`` carrier with a coarse CO2 rate. Real carrier mixes come from
    PyPSA-native networks (scigrid-de, PyPSA-Eur, PyPSA-USA).
    """
    n = pypsa.Network()
    n.name = name

    # Buses
    for row in mp["bus"]:
        bus_id = str(int(row[0]))
        base_kv = row[9] if len(row) > 9 else 138.0
        n.add("Bus", bus_id, v_nom=base_kv)

    # Loads (Pd column on bus rows)
    for row in mp["bus"]:
        bus_id = str(int(row[0]))
        pd_load = row[2] if len(row) > 2 else 0.0
        if pd_load and pd_load != 0:
            n.add("Load", f"load_{bus_id}", bus=bus_id, p_set=float(pd_load))

    # Lines (branch rows)
    for i, row in enumerate(mp["branch"]):
        f, t = str(int(row[0])), str(int(row[1]))
        r, x, b, rate_a = row[2], row[3], row[4], row[5]
        n.add(
            "Line",
            f"line_{i}",
            bus0=f,
            bus1=t,
            r=float(r),
            x=float(max(x, 1e-3)),
            b=float(b),
            s_nom=float(rate_a) if rate_a > 0 else 9999.0,
        )

    # Single carrier (MATPOWER doesn't expose fuel type)
    n.add("Carrier", default_carrier, co2_emissions=carrier_co2)

    # Generators (gen rows + gencost rows, if present)
    for i, gr in enumerate(mp["gen"]):
        bus_id = str(int(gr[0]))
        p_max = gr[8] if len(gr) > 8 else 100.0
        marginal_cost = 50.0
        if i < len(mp["gencost"]):
            gc = mp["gencost"][i]
            model = int(gc[0])
            ncoef = int(gc[3])
            if model == 2 and ncoef >= 2:
                coefs = gc[4 : 4 + ncoef]
                # polynomial highest order first; linear coefficient is second-to-last
                marginal_cost = max(coefs[-2], 1.0)
        n.add(
            "Generator",
            f"gen_{i}",
            bus=bus_id,
            p_nom=float(p_max) if p_max > 0 else 100.0,
            marginal_cost=float(marginal_cost),
            carrier=default_carrier,
        )

    n.set_snapshots(pd.date_range("2024-01-01", periods=1, freq="h"))
    return n


def _export(n: pypsa.Network, out_dir: Path):
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    n.export_to_csv_folder(str(out_dir))


def _carrier_mix(n: pypsa.Network) -> dict[str, float]:
    if "carrier" not in n.generators:
        return {}
    grouped = n.generators.groupby("carrier")["p_nom"].sum()
    total = float(grouped.sum())
    if total <= 0:
        return {}
    return {str(k): round(float(v) / total, 4) for k, v in grouped.items()}


def _write_card(net_dir: Path, **fields):
    card = net_dir / "card.md"
    lines = [f"# {fields['title']}", ""]
    lines.append(fields.get("description", "").strip())
    lines.append("")
    lines.append("## Source")
    lines.append(f"- URL: {fields['source_url']}")
    lines.append(f"- License: {fields['license']}")
    if "citation" in fields:
        lines.append(f"- Citation: {fields['citation']}")
    lines.append("")
    lines.append("## Scale")
    lines.append(f"- Buses: {fields['nodes']}")
    lines.append(f"- Lines: {fields['lines']}")
    lines.append(f"- Generators: {fields['generators']}")
    lines.append(f"- Loads: {fields['loads']}")
    lines.append(f"- Snapshots: {fields['snapshots']}")
    lines.append("")
    lines.append("## Carrier mix (by p_nom)")
    if fields["carrier_mix"]:
        for c, frac in sorted(
            fields["carrier_mix"].items(), key=lambda kv: -kv[1]
        ):
            lines.append(f"- {c}: {frac:.1%}")
    else:
        lines.append("- (single generic carrier; see notes)")
    lines.append("")
    lines.append("## Example zap solve")
    lines.append("")
    lines.append("```python")
    lines.append(fields["example_solve"].strip())
    lines.append("```")
    lines.append("")
    lines.append("## Suggested first prompt")
    lines.append("")
    lines.append(f"> {fields['first_prompt'].strip()}")
    lines.append("")
    if "notes" in fields and fields["notes"]:
        lines.append("## Notes")
        lines.append(fields["notes"].strip())
        lines.append("")
    card.write_text("\n".join(lines))


EXAMPLE_SOLVE = """from pathlib import Path
import pandas as pd
import pypsa
import zap

net_dir = Path("data/networks/{slug}")
pnet = pypsa.Network()
pnet.import_from_csv_folder(str(net_dir))

snapshots = pnet.snapshots[:1]  # 1-hour smoke
network, devices = zap.importers.load_pypsa_network(pnet, snapshots)
outcome = network.dispatch(devices, solver="CLARABEL")

print("objective:", outcome.problem.value if hasattr(outcome, "problem") else "n/a")
print("first generator dispatch:", outcome.power[0][:5])
"""


def build_ieee_30():
    src = _fetch_matpower("case30", DATA_ROOT.parent / "_cache" / "case30.m")
    mp = parse_matpower(src)
    n = _matpower_to_pypsa(mp, "ieee-30")
    out = DATA_ROOT / "ieee-30"
    _export(n, out)
    # ship the source MATPOWER file too so users can audit
    shutil.copy2(src, out / "source.case30.m")
    _write_card(
        out,
        title="IEEE 30-bus",
        slug="ieee-30",
        description=(
            "The classic IEEE 30-bus test case (Alsac & Stott, 1974). Tiny, "
            "fast to solve, every paper uses it. Useful as a sanity-check "
            "network before reaching for anything bigger."
        ),
        source_url="https://github.com/MATPOWER/matpower/blob/master/data/case30.m",
        license="MATPOWER license (BSD-style; see matpower/LICENSE)",
        citation="Alsac, O. & Stott, B., \"Optimal Load Flow with Steady "
        "State Security\", IEEE Trans. PAS, 1974.",
        nodes=len(n.buses),
        lines=len(n.lines),
        generators=len(n.generators),
        loads=len(n.loads),
        snapshots=len(n.snapshots),
        carrier_mix=_carrier_mix(n),
        example_solve=EXAMPLE_SOLVE.format(slug="ieee-30"),
        first_prompt=(
            "Run an economic dispatch on the IEEE 30-bus network for one hour "
            "and tell me which generators are at their capacity limits."
        ),
        notes=(
            "MATPOWER stores generators without fuel-type metadata, so every "
            "generator here is in a single `thermal` carrier with a coarse "
            "CO2 rate (0.5 tCO2/MWh). Replace the carrier assignment in a "
            "preprocessing feature if your analysis needs unit-level fuel "
            "data."
        ),
    )
    return out, n


def build_pypsa_usa():
    # Use ACTIVSg200 as a stand-in for PyPSA-USA / WECC-240. ACTIVSg200 is a
    # 200-bus synthetic US-Western-style network published by Texas A&M and
    # mirrored in the MATPOWER repo under an open license.
    src = _fetch_matpower(
        "case_ACTIVSg200", DATA_ROOT.parent / "_cache" / "case_ACTIVSg200.m"
    )
    mp = parse_matpower(src)
    n = _matpower_to_pypsa(mp, "pypsa-usa-activsg200")
    out = DATA_ROOT / "pypsa-usa"
    _export(n, out)
    shutil.copy2(src, out / "source.case_ACTIVSg200.m")
    _write_card(
        out,
        title="PyPSA-USA (ACTIVSg200 stand-in)",
        slug="pypsa-usa",
        description=(
            "A 200-bus synthetic US-Western interconnection — Texas A&M's "
            "ACTIVSg200 — used here as the canonical US-scale reference "
            "network until a full PyPSA-USA snapshot is wired into the "
            "ingestion pipeline. Realistic enough for transmission-flow "
            "questions, fast enough to solve interactively."
        ),
        source_url="https://github.com/MATPOWER/matpower/blob/master/data/case_ACTIVSg200.m",
        license="Creative Commons Attribution 4.0 International (CC BY 4.0) — Texas A&M ACTIVSg series",
        citation="Birchfield, A.B. et al., \"Grid Structural Characteristics "
        "as Validation Criteria for Synthetic Networks\", IEEE TPS, 2017.",
        nodes=len(n.buses),
        lines=len(n.lines),
        generators=len(n.generators),
        loads=len(n.loads),
        snapshots=len(n.snapshots),
        carrier_mix=_carrier_mix(n),
        example_solve=EXAMPLE_SOLVE.format(slug="pypsa-usa"),
        first_prompt=(
            "Compare dispatch cost and total flow on the inter-area lines for "
            "this PyPSA-USA stand-in network when load scales from 80% to 120%."
        ),
        notes=(
            "ACTIVSg200 is synthetic — the topology mirrors real WECC "
            "characteristics but bus/line names are not tied to real "
            "substations. When the upgrade to a full PyPSA-USA snapshot "
            "lands, the seed script will swap the canonical artifact row "
            "without breaking existing chats."
        ),
    )
    return out, n


def build_pypsa_eur_slice():
    # SciGRID-DE is the closest in-repo proxy for a PyPSA-Eur Germany slice.
    # It ships inside the pypsa.examples module, so no network fetch needed.
    n = pypsa.examples.scigrid_de()
    n.set_snapshots(n.snapshots[:24])  # 24-hour slice keeps the export small
    # SciGRID-DE doesn't ship a carriers table; add one with rough CO2 rates
    carrier_co2 = {
        "Gas": 0.187,
        "Hard Coal": 0.337,
        "Brown Coal": 0.365,
        "Oil": 0.265,
        "Waste": 0.0,
        "Multiple": 0.0,
        "Other": 0.0,
        "Nuclear": 0.0,
        "Run of River": 0.0,
        "Storage Hydro": 0.0,
        "Geothermal": 0.0,
        "Wind Offshore": 0.0,
        "Wind Onshore": 0.0,
        "Solar": 0.0,
    }
    for c, em in carrier_co2.items():
        if c not in n.carriers.index:
            n.add("Carrier", c, co2_emissions=em)
    out = DATA_ROOT / "pypsa-eur-slice"
    _export(n, out)
    _write_card(
        out,
        title="PyPSA-Eur slice — SciGRID Germany",
        slug="pypsa-eur-slice",
        description=(
            "A 24-hour slice of the SciGRID-DE German transmission network, "
            "shipped by PyPSA as part of pypsa.examples. Real topology with a "
            "real carrier mix (lignite, hard coal, nuclear, wind, solar, "
            "hydro) — the closest in-repo proxy for a PyPSA-Eur Germany "
            "slice. Swap in a full PyPSA-Eur snapshot once ingestion is wired."
        ),
        source_url="https://github.com/PyPSA/PyPSA/blob/master/examples/scigrid-de",
        license="CC BY 4.0 (SciGRID v0.2)",
        citation="Brown, T., Hoersch, J., Schlachtberger, D., \"PyPSA: "
        "Python for Power System Analysis\", JORS, 2018.",
        nodes=len(n.buses),
        lines=len(n.lines),
        generators=len(n.generators),
        loads=len(n.loads),
        snapshots=len(n.snapshots),
        carrier_mix=_carrier_mix(n),
        example_solve=EXAMPLE_SOLVE.format(slug="pypsa-eur-slice"),
        first_prompt=(
            "What's the cheapest dispatch for the German grid on this winter "
            "day, and how much of it comes from wind vs lignite?"
        ),
        notes=(
            "Carrier CO2 rates are approximate IPCC defaults. Marginal "
            "generation costs are inherited from the upstream PyPSA example "
            "(renewables at zero, thermals at IEA-flavoured values)."
        ),
    )
    return out, n


def main():
    print("Building reference networks under", DATA_ROOT)
    for builder in (build_ieee_30, build_pypsa_usa, build_pypsa_eur_slice):
        out, n = builder()
        print(
            f"  {out.name}: {len(n.buses)} buses, "
            f"{len(n.lines)} lines, {len(n.generators)} generators, "
            f"{len(n.loads)} loads, {len(n.snapshots)} snapshots"
        )
    print("done")


if __name__ == "__main__":
    main()

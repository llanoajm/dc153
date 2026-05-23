# PyPSA-USA (ACTIVSg200 stand-in)

A 200-bus synthetic US-Western interconnection — Texas A&M's ACTIVSg200 — used here as the canonical US-scale reference network until a full PyPSA-USA snapshot is wired into the ingestion pipeline. Realistic enough for transmission-flow questions, fast enough to solve interactively.

## Source
- URL: https://github.com/MATPOWER/matpower/blob/master/data/case_ACTIVSg200.m
- License: Creative Commons Attribution 4.0 International (CC BY 4.0) — Texas A&M ACTIVSg series
- Citation: Birchfield, A.B. et al., "Grid Structural Characteristics as Validation Criteria for Synthetic Networks", IEEE TPS, 2017.

## Scale
- Buses: 200
- Lines: 245
- Generators: 49
- Loads: 108
- Snapshots: 1

## Carrier mix (by p_nom)
- thermal: 100.0%

## Example zap solve

```python
from pathlib import Path
import pandas as pd
import pypsa
import zap

net_dir = Path("data/networks/pypsa-usa")
pnet = pypsa.Network()
pnet.import_from_csv_folder(str(net_dir))

snapshots = pnet.snapshots[:1]  # 1-hour smoke
network, devices = zap.importers.load_pypsa_network(pnet, snapshots)
outcome = network.dispatch(devices, solver="CLARABEL")

print("objective:", outcome.problem.value if hasattr(outcome, "problem") else "n/a")
print("first generator dispatch:", outcome.power[0][:5])
```

## Suggested first prompt

> Compare dispatch cost and total flow on the inter-area lines for this PyPSA-USA stand-in network when load scales from 80% to 120%.

## Notes
ACTIVSg200 is synthetic — the topology mirrors real WECC characteristics but bus/line names are not tied to real substations. When the upgrade to a full PyPSA-USA snapshot lands, the seed script will swap the canonical artifact row without breaking existing chats.

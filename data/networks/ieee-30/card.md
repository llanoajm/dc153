# IEEE 30-bus

The classic IEEE 30-bus test case (Alsac & Stott, 1974). Tiny, fast to solve, every paper uses it. Useful as a sanity-check network before reaching for anything bigger.

## Source
- URL: https://github.com/MATPOWER/matpower/blob/master/data/case30.m
- License: MATPOWER license (BSD-style; see matpower/LICENSE)
- Citation: Alsac, O. & Stott, B., "Optimal Load Flow with Steady State Security", IEEE Trans. PAS, 1974.

## Scale
- Buses: 30
- Lines: 41
- Generators: 6
- Loads: 20
- Snapshots: 1

## Carrier mix (by p_nom)
- thermal: 100.0%

## Example zap solve

```python
from pathlib import Path
import pandas as pd
import pypsa
import zap

net_dir = Path("data/networks/ieee-30")
pnet = pypsa.Network()
pnet.import_from_csv_folder(str(net_dir))

snapshots = pnet.snapshots[:1]  # 1-hour smoke
network, devices = zap.importers.load_pypsa_network(pnet, snapshots)
outcome = network.dispatch(devices, solver="CLARABEL")

print("objective:", outcome.problem.value if hasattr(outcome, "problem") else "n/a")
print("first generator dispatch:", outcome.power[0][:5])
```

## Suggested first prompt

> Run an economic dispatch on the IEEE 30-bus network for one hour and tell me which generators are at their capacity limits.

## Notes
MATPOWER stores generators without fuel-type metadata, so every generator here is in a single `thermal` carrier with a coarse CO2 rate (0.5 tCO2/MWh). Replace the carrier assignment in a preprocessing feature if your analysis needs unit-level fuel data.

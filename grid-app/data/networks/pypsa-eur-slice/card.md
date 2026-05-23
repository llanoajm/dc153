# PyPSA-Eur slice — SciGRID Germany

A 24-hour slice of the SciGRID-DE German transmission network, shipped by PyPSA as part of pypsa.examples. Real topology with a real carrier mix (lignite, hard coal, nuclear, wind, solar, hydro) — the closest in-repo proxy for a PyPSA-Eur Germany slice. Swap in a full PyPSA-Eur snapshot once ingestion is wired.

## Source
- URL: https://github.com/PyPSA/PyPSA/blob/master/examples/scigrid-de
- License: CC BY 4.0 (SciGRID v0.2)
- Citation: Brown, T., Hoersch, J., Schlachtberger, D., "PyPSA: Python for Power System Analysis", JORS, 2018.

## Scale
- Buses: 585
- Lines: 852
- Generators: 1423
- Loads: 489
- Snapshots: 24

## Carrier mix (by p_nom)
- Wind Onshore: 21.6%
- Solar: 21.5%
- Hard Coal: 14.7%
- Gas: 13.9%
- Brown Coal: 12.1%
- Nuclear: 7.0%
- Run of River: 2.3%
- Other: 1.8%
- Wind Offshore: 1.7%
- Oil: 1.6%
- Waste: 0.9%
- Storage Hydro: 0.8%
- Multiple: 0.1%
- Geothermal: 0.0%

## Example zap solve

```python
from pathlib import Path
import pandas as pd
import pypsa
import zap

net_dir = Path("data/networks/pypsa-eur-slice")
pnet = pypsa.Network()
pnet.import_from_csv_folder(str(net_dir))

snapshots = pnet.snapshots[:1]  # 1-hour smoke
network, devices = zap.importers.load_pypsa_network(pnet, snapshots)
outcome = network.dispatch(devices, solver="CLARABEL")

print("objective:", outcome.problem.value if hasattr(outcome, "problem") else "n/a")
print("first generator dispatch:", outcome.power[0][:5])
```

## Suggested first prompt

> What's the cheapest dispatch for the German grid on this winter day, and how much of it comes from wind vs lignite?

## Notes
Carrier CO2 rates are approximate IPCC defaults. Marginal generation costs are inherited from the upstream PyPSA example (renewables at zero, thermals at IEA-flavoured values).

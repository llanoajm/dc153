"""
Extended toy network: 7-node grid with Blackwell GB200 NVL72 datacenter load.

Active node topology (nodes 4-6 are structurally present but have no devices):

    Node 0  ──────────  Node 1  ─────────────  Node 2
  Peaker               Solar                 GB200 DC
  Bulk load            Battery               (50 racks)
       ╲                  │
        ╲              (vertical)
         ╲                │
          Node 3  ────────╯
         Gas CCGT

Lines:
  0 ↔ 1   45 MW nominal   (grid backbone)
  1 ↔ 3   50 MW nominal   (north-south trunk)
  3 ↔ 0   11 MW nominal   (return tie)
  1 → 2   20 MW nominal   (dedicated datacenter feed, fixed)

Device list (indices used in PARAMETER_NAMES):
  0  Generator   (Peaker@0, Solar@1, Gas@3)
  1  Load        (utility@0)
  2  ACLine      (0-1, 1-3, 3-0) ← expandable
  3  Battery     (@1)
  4  Load        (datacenter@2, Blackwell trace)
  5  ACLine      (1→2, datacenter feed)  ← fixed
"""

import numpy as np

from zap.network import PowerNetwork
from zap.devices import Generator, Load, ACLine

from .blackwell import facility_power_mw, RACKS

NUM_NODES = 7

PARAMETER_NAMES = {
    "generator": (0, "nominal_capacity"),  # optimize 3 generator capacities
    "ac_line": (2, "nominal_capacity"),    # optimize 3 original line capacities
}

TIME_HORIZON = 4  # one value per 6-hour block, matching toy network


def load_datacenter_network(num_racks: int = RACKS):
    """
    Return (net, devices) for the 7-node grid with the Blackwell datacenter.

    Device list:
      0  Generator   (Peaker@0, Solar@1, Gas@3)   ← expandable
      1  Load        (utility demand @0)
      2  ACLine      (0-1, 1-3, 3-0)              ← expandable
      3  Load        (GB200 datacenter @2)
      4  ACLine      (1→2, dedicated datacenter feed, fixed)

    Battery is excluded: StorageUnit.admm_prox_update() returns 2 values
    but the ADMMSolver unpacks 3, causing a ValueError at runtime.
    """
    net = PowerNetwork(NUM_NODES)

    generators = Generator(
        name="generator",
        num_nodes=NUM_NODES,
        terminal=np.array([0, 1, 3]),
        dynamic_capacity=np.array([
            np.ones(TIME_HORIZON),           # Peaker: fully dispatchable
            [0.2, 1.0, 1.0, 0.3],           # Solar: low at night/evening
            np.ones(TIME_HORIZON),           # Gas CCGT: always available
        ]),
        linear_cost=np.array([100.0, 0.5, 40.0]),        # $/MWh
        nominal_capacity=np.array([100.0, 50.0, 15.0]),  # MW
        capital_cost=np.array([4.0, 10.0, 10.0]),        # $/MW
        emission_rates=np.array([800.0, 0.0, 500.0]),    # gCO2/kWh
    )

    utility_load = Load(
        name="utility_load",
        num_nodes=NUM_NODES,
        terminal=np.array([0]),
        load=np.array([[30.0, 40.0, 45.0, 80.0]]),  # MW per step
        linear_cost=np.array([200.0]),               # curtailment penalty $/MWh
    )

    grid_lines = ACLine(
        name="grid_line",
        num_nodes=NUM_NODES,
        source_terminal=np.array([0, 1, 3]),
        sink_terminal=np.array([1, 3, 0]),
        susceptance=np.array([0.1, 0.05, 1.0]),
        capacity=np.ones(3),
        nominal_capacity=np.array([45.0, 50.0, 11.0]),
        linear_cost=0.025 * np.ones(3),
        capital_cost=np.array([100.0, 25.0, 30.0]),
    )

    dc_mw = facility_power_mw(num_racks)          # shape (4,) MW per step
    datacenter_load = Load(
        name="datacenter",
        num_nodes=NUM_NODES,
        terminal=np.array([2]),
        load=dc_mw.reshape(1, -1),                # shape (1, 4)
        linear_cost=np.array([500.0]),            # high SLA penalty $/MWh
    )

    dc_feed = ACLine(
        name="dc_feed",
        num_nodes=NUM_NODES,
        source_terminal=np.array([1]),
        sink_terminal=np.array([2]),
        susceptance=np.array([0.2]),
        capacity=np.ones(1),
        nominal_capacity=np.array([20.0]),   # MW, rated for datacenter peak
        linear_cost=np.array([0.025]),
        capital_cost=None,                   # fixed infra — not in planning params
    )

    devices = [generators, utility_load, grid_lines, datacenter_load, dc_feed]
    return net, devices

"""
GB200 NVL72 datacenter power modeling.

Specs (SemiAnalysis, NVIDIA Blackwell GB200 NVL72):
  72 × B200 GPUs per rack, NVLink domain
  120 kW peak per rack (full compute load)
  40 kW idle per rack (chassis + networking baseline)
  PUE 1.20 (modern hyperscaler data hall, indirect evaporative cooling)

The 4-step diurnal trace maps to the toy network's 4 time periods:
  Step 0  00-06h  night batch      25% utilization
  Step 1  06-12h  morning ramp     60% utilization
  Step 2  12-18h  peak inference   100% utilization
  Step 3  18-24h  sustained high   80% utilization
"""

import numpy as np

RACKS = 50
PEAK_KW_PER_RACK = 120.0   # NVL72 TDP per rack
IDLE_KW_PER_RACK = 40.0    # chassis idle (networking, cooling fans, BMC)
PUE = 1.20                 # facility efficiency ratio

# Compute utilization per 6-hour block
UTILIZATION_PER_STEP = np.array([0.25, 0.60, 1.00, 0.80])


def rack_power_kw(utilization: float) -> float:
    """Per-rack power at a given compute utilization [0, 1]. Linear IDLE→PEAK model."""
    return IDLE_KW_PER_RACK + utilization * (PEAK_KW_PER_RACK - IDLE_KW_PER_RACK)


def facility_power_mw(
    num_racks: int = RACKS,
    utilization: np.ndarray = UTILIZATION_PER_STEP,
) -> np.ndarray:
    """
    Total facility draw in MW (IT load × PUE) for each time step.

    Shape: (len(utilization),)
    """
    it_kw = (IDLE_KW_PER_RACK + utilization * (PEAK_KW_PER_RACK - IDLE_KW_PER_RACK)) * num_racks
    return it_kw * PUE / 1000.0


def power_profile(num_racks: int = RACKS) -> dict:
    """Structured Blackwell power profile for serialization and planning."""
    mw = facility_power_mw(num_racks)
    return {
        "racks": num_racks,
        "peak_kw_per_rack": PEAK_KW_PER_RACK,
        "idle_kw_per_rack": IDLE_KW_PER_RACK,
        "pue": PUE,
        "utilization_per_step": UTILIZATION_PER_STEP.tolist(),
        "power_mw_per_step": mw.tolist(),
        "peak_mw": float(mw.max()),
        "idle_mw": float(mw.min()),
        "time_labels": ["00-06h (Night)", "06-12h (Morning)", "12-18h (Afternoon)", "18-24h (Evening)"],
        "source": "SemiAnalysis / NVIDIA Blackwell GB200 NVL72 architecture spec",
    }

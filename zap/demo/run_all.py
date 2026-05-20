"""
Orchestrate all demo experiments and emit a single results JSON.

Usage:
    python -m zap.demo.run_all              # CPU, fast=True
    python -m zap.demo.run_all --machine cuda --fast false
"""

import json
import sys
import time
from pathlib import Path

from .blackwell import power_profile
from .mep_gd import run_mep_gd
from .mep_nn import run_mep_nn
from .rl_planning import run_rl_planning


NETWORK_METADATA = {
    "num_nodes": 7,
    "active_nodes": [0, 1, 2, 3],
    "nodes": [
        {"id": 0, "x": 150, "y": 250, "label": "Bulk Load + Peaker",    "type": "generator_load"},
        {"id": 1, "x": 400, "y": 110, "label": "Solar",                 "type": "generator_storage"},
        {"id": 2, "x": 660, "y": 110, "label": "GB200 Datacenter",      "type": "datacenter"},
        {"id": 3, "x": 400, "y": 330, "label": "Gas CCGT",              "type": "generator"},
    ],
    "lines": [
        {"src": 0, "dst": 1, "param_idx": 0, "nominal_mw": 45.0, "fixed": False, "label": "L 0-1"},
        {"src": 1, "dst": 3, "param_idx": 1, "nominal_mw": 50.0, "fixed": False, "label": "L 1-3"},
        {"src": 3, "dst": 0, "param_idx": 2, "nominal_mw": 11.0, "fixed": False, "label": "L 3-0"},
        {"src": 1, "dst": 2, "param_idx": None, "nominal_mw": 20.0, "fixed": True,  "label": "DC feed"},
    ],
    "generators": [
        {"node": 0, "name": "Peaker",    "param_idx": 0, "initial_mw": 100.0, "cost_mwh": 100.0, "color": "#2b6cb0"},
        {"node": 1, "name": "Solar",     "param_idx": 1, "initial_mw": 50.0,  "cost_mwh": 0.5,   "color": "#276749"},
        {"node": 3, "name": "Gas CCGT",  "param_idx": 2, "initial_mw": 15.0,  "cost_mwh": 40.0,  "color": "#c05621"},
    ],
    "time_steps": ["00-06h Night", "06-12h Morning", "12-18h Afternoon", "18-24h Evening"],
}


def _divider(title: str):
    print("\n" + "═" * 60)
    print(f"  {title}")
    print("═" * 60)


def run_all(
    machine: str = "cpu",
    out_path: str = None,
    fast: bool = False,
) -> dict:
    """
    Run all demo experiments and write results to out_path.

    fast=True uses shorter hyperparameters for local smoke testing.
    """
    if out_path is None:
        root = Path(__file__).parent.parent   # zap/ (steinmetz/zap)
        out_path = str(root / "data" / "demo" / "results.json")

    t_total = time.time()

    _divider("Blackwell GB200 NVL72 — power profile (no compute needed)")
    blackwell = power_profile()
    mw = blackwell["power_mw_per_step"]
    print(f"  50 racks × {blackwell['peak_kw_per_rack']:.0f} kW peak, PUE {blackwell['pue']}")
    print(f"  Draw per 6-h block: {[f'{x:.1f}' for x in mw]} MW")

    _divider("MEP — Gradient Descent (ADMM implicit differentiation)")
    mep_gd = run_mep_gd(
        machine=machine,
        num_admm_iterations=200 if fast else 800,
        num_gd_iterations=15 if fast else 70,
        step_size=0.5,
    )

    _divider("MEP — Neural Network Surrogate")
    mep_nn = run_mep_nn(
        machine=machine,
        n_samples=60 if fast else 350,
        num_train_epochs=80 if fast else 400,
        num_plan_steps=80 if fast else 300,
        num_admm_iterations=150 if fast else 400,
    )

    _divider("RL — DQN Load-Adaptable Expansion")
    rl = run_rl_planning(
        machine=machine,
        num_episodes=16 if fast else 80,
        steps_per_episode=6 if fast else 15,
        num_admm_iterations=80 if fast else 150,
    )

    results = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "machine": machine,
        "fast_mode": fast,
        "elapsed_total_s": round(time.time() - t_total, 2),
        "blackwell": blackwell,
        "network": NETWORK_METADATA,
        "mep_gd": mep_gd,
        "mep_nn": mep_nn,
        "rl": rl,
    }

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as f:
        json.dump(results, f, indent=2)

    print(f"\n✓ Results → {out_path}  ({out.stat().st_size // 1024} KB)")
    print(f"  Total time: {results['elapsed_total_s']:.1f}s on {machine}")

    return results


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--machine", default="cpu")
    p.add_argument("--out", default=None)
    p.add_argument("--fast", action="store_true")
    args = p.parse_args()

    run_all(machine=args.machine, out_path=args.out, fast=args.fast)

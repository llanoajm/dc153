"""
Minimum Expansion Planning via Gradient Descent.

Solves capacity expansion by differentiating through the ADMM dispatch layer
(implicit differentiation via unrolled ADMM + PyTorch autograd) and descending
on the gradient of total cost (operational + investment) w.r.t. capacity.
"""

import time

import numpy as np
import torch

from zap.admm import ADMMSolver, ADMMLayer
from zap.planning import PlanningProblem
from zap.planning.operation_objectives import DispatchCostObjective
from zap.planning.investment_objectives import InvestmentObjective
from zap.planning.solvers import GradientDescent

from .network import load_datacenter_network, PARAMETER_NAMES, TIME_HORIZON


def run_mep_gd(
    machine: str = "cpu",
    num_admm_iterations: int = 600,
    num_gd_iterations: int = 60,
    step_size: float = 0.5,
    verbose: bool = True,
) -> dict:
    """
    Run MEP via gradient descent with ADMM implicit differentiation.

    Returns a JSON-serializable results dict.
    """
    t0 = time.time()

    net, devices = load_datacenter_network()

    # Torchify devices to the target machine before building layers/objectives.
    # (runner.py pattern: devices are torchified before ADMMLayer construction)
    torch_devices = [d.torchify(machine=machine) for d in devices]

    solver = ADMMSolver(
        machine=machine,
        num_iterations=num_admm_iterations,
        minimum_iterations=50,
        atol=1e-3,
        rtol=0.0,
        rho_power=1.0,
        rho_angle=1.0,
        battery_window=TIME_HORIZON,
        adaptive_rho=True,
        adaptation_frequency=50,
        verbose=0,
    )

    layer = ADMMLayer(
        net, torch_devices, PARAMETER_NAMES, time_horizon=TIME_HORIZON, solver=solver
    )

    op_obj = DispatchCostObjective(net, torch_devices)
    inv_obj = InvestmentObjective(torch_devices, layer)
    problem = PlanningProblem(op_obj, inv_obj, layer)

    alg = GradientDescent(step_size=step_size, clip=1000.0)

    if verbose:
        print(f"[MEP-GD] {num_gd_iterations} GD iters × {num_admm_iterations} ADMM iters on {machine}")

    state, history = problem.solve(
        algorithm=alg,
        num_iterations=num_gd_iterations,
        verbosity=1 if verbose else 0,
    )

    elapsed = time.time() - t0

    final_gen = state["generator"]
    final_line = state["ac_line"]
    if isinstance(final_gen, torch.Tensor):
        final_gen = final_gen.cpu().numpy()
        final_line = final_line.cpu().numpy()

    # Flatten from (N,1) → (N,) in case ADMM uses column-vector params
    final_gen  = np.asarray(final_gen).ravel()
    final_line = np.asarray(final_line).ravel()

    cost_history = [float(c) for c in history.get("loss", [])]
    grad_norm_history = [float(g) for g in history.get("grad_norm", [])]

    results = {
        "method": "gradient_descent",
        "machine": machine,
        "elapsed_s": round(elapsed, 2),
        "num_admm_iterations": num_admm_iterations,
        "num_gd_iterations": num_gd_iterations,
        "step_size": step_size,
        "initial_gen_capacity_mw": [100.0, 50.0, 15.0],
        "initial_line_capacity_mw": [45.0, 50.0, 11.0],
        "final_gen_capacity_mw": final_gen.tolist(),
        "final_line_capacity_mw": final_line.tolist(),
        "cost_history": cost_history,
        "grad_norm_history": grad_norm_history,
        "op_cost": float(problem.op_cost.item()) if hasattr(problem, "op_cost") else None,
        "inv_cost": float(problem.inv_cost.item()) if hasattr(problem, "inv_cost") else None,
    }

    if verbose:
        print(f"[MEP-GD] Done in {elapsed:.1f}s | final cost: {cost_history[-1]:.2f}")
        gen_names = ["Peaker", "Solar", "Gas"]
        line_names = ["L0-1", "L1-3", "L3-0"]
        for name, init, final in zip(gen_names, [100., 50., 15.], final_gen.tolist()):
            print(f"  {name}: {init:.0f} → {final:.1f} MW")
        for name, init, final in zip(line_names, [45., 50., 11.], final_line.tolist()):
            print(f"  {name}: {init:.0f} → {final:.1f} MW")

    return results

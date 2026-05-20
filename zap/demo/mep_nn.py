"""
Minimum Expansion Planning via Neural Network Surrogate.

Approach:
  1. Sample capacity configurations via quasi-random (Sobol) sampling
  2. For each, solve ADMM dispatch and record total cost
  3. Train an MLP to approximate cost as a function of capacities
  4. Minimize the surrogate cost via Adam gradient descent, project to bounds
"""

import time

import numpy as np
import torch
import torch.nn as nn

from zap.admm import ADMMSolver, ADMMLayer
from zap.planning.operation_objectives import DispatchCostObjective
from zap.planning.investment_objectives import InvestmentObjective

from .network import load_datacenter_network, PARAMETER_NAMES, TIME_HORIZON


# ── Surrogate model ──────────────────────────────────────────────────────────

class CostSurrogate(nn.Module):
    """MLP mapping normalized capacities → total planning cost."""

    def __init__(self, input_dim: int, hidden: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden),
            nn.SiLU(),
            nn.Linear(hidden, hidden),
            nn.SiLU(),
            nn.Linear(hidden // 2 * 2, hidden // 2),
            nn.SiLU(),
            nn.Linear(hidden // 2, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


# ── Sampling ─────────────────────────────────────────────────────────────────

GEN_LO  = np.array([40.0,  15.0,  5.0])
GEN_HI  = np.array([300.0, 250.0, 120.0])
LINE_LO = np.array([15.0,  15.0,  4.0])
LINE_HI = np.array([150.0, 150.0, 60.0])


def _sobol_samples(n: int, rng) -> tuple[np.ndarray, np.ndarray]:
    """Return (gen_samples, line_samples) via Latin hypercube sampling."""
    gen_dim, line_dim = len(GEN_LO), len(LINE_LO)
    total_dim = gen_dim + line_dim
    # LHS: stratify each dimension independently into n equal-probability strata
    strata = np.zeros((n, total_dim))
    for d in range(total_dim):
        perm = rng.permutation(n)
        strata[:, d] = (perm + rng.random(n)) / n

    lo = np.concatenate([GEN_LO, LINE_LO])
    hi = np.concatenate([GEN_HI, LINE_HI])
    samples = lo + strata * (hi - lo)
    return samples[:, :gen_dim], samples[:, gen_dim:]


def _eval_cost(gen_t, line_t, layer, op_obj, inv_obj, machine: str = "cpu") -> float:
    """ADMM dispatch + cost evaluation. Returns nan on failure."""
    # Move to target device and unsqueeze to (N, 1)
    gen_t  = gen_t.to(machine)
    line_t = line_t.to(machine)
    gen_t  = gen_t.unsqueeze(1) if gen_t.dim() == 1 else gen_t
    line_t = line_t.unsqueeze(1) if line_t.dim() == 1 else line_t
    try:
        with torch.no_grad():
            admm_state = layer.forward(generator=gen_t, ac_line=line_t)
            outcome = admm_state.as_outcome()
            params = layer.setup_parameters(generator=gen_t, ac_line=line_t)
            op = float(op_obj(outcome, parameters=params, la=torch))
            inv = float(inv_obj(generator=gen_t, ac_line=line_t, la=torch))
        return op + inv
    except Exception:
        return float("nan")


# ── Main runner ───────────────────────────────────────────────────────────────

def run_mep_nn(
    machine: str = "cpu",
    n_samples: int = 300,
    num_train_epochs: int = 400,
    num_plan_steps: int = 300,
    num_admm_iterations: int = 400,
    hidden: int = 128,
    verbose: bool = True,
) -> dict:
    """
    Run MEP via neural network surrogate.

    Phase 1  — sample n_samples ADMM dispatch costs across capacity space
    Phase 2  — train MLP surrogate
    Phase 3  — minimize surrogate via Adam, project to feasible region
    """
    t0 = time.time()
    rng = np.random.default_rng(0)

    net, devices = load_datacenter_network()
    torch_devices = [d.torchify(machine=machine) for d in devices]

    solver = ADMMSolver(
        machine=machine,
        num_iterations=num_admm_iterations,
        minimum_iterations=30,
        atol=5e-3,
        rtol=0.0,
        rho_power=1.0,
        rho_angle=1.0,
        battery_window=TIME_HORIZON,
        adaptive_rho=True,
        adaptation_frequency=50,
        verbose=0,
    )
    layer = ADMMLayer(net, torch_devices, PARAMETER_NAMES, time_horizon=TIME_HORIZON, solver=solver)
    op_obj = DispatchCostObjective(net, torch_devices)
    inv_obj = InvestmentObjective(torch_devices, layer)

    # ── Phase 1: sample dispatch costs ──────────────────────────────────────
    if verbose:
        print(f"[MEP-NN] Sampling {n_samples} dispatch solves on {machine}…")

    gen_s, line_s = _sobol_samples(n_samples, rng)
    costs = []
    # Sobol samples are independent — disable warm-start so each solve starts
    # from a clean ADMM state. (Warm-starting from a prior sample's state is
    # also incorrect and would couple sample order to results.)
    saved_warm_start = layer.warm_start
    layer.warm_start = False
    cuda = machine.startswith("cuda")
    try:
        for i, (gc, lc) in enumerate(zip(gen_s, line_s)):
            gen_t = torch.tensor(gc, dtype=torch.float32)
            line_t = torch.tensor(lc, dtype=torch.float32)
            c = _eval_cost(gen_t, line_t, layer, op_obj, inv_obj, machine=machine)
            costs.append(c)
            if cuda and (i + 1) % 25 == 0:
                # Free fragmented blocks from the autograd-free dispatch path.
                if hasattr(layer, "state"):
                    del layer.state
                torch.cuda.empty_cache()
            if verbose and (i + 1) % 50 == 0:
                ok = sum(1 for x in costs if not np.isnan(x))
                mem = ""
                if cuda:
                    mem = f"  | gpu_mem={torch.cuda.memory_allocated()/1e9:.2f}GB"
                print(f"  {i+1}/{n_samples} sampled  ({ok} valid){mem}")
    finally:
        layer.warm_start = saved_warm_start
        if hasattr(layer, "state"):
            del layer.state
        if cuda:
            torch.cuda.empty_cache()

    costs = np.array(costs)
    valid = ~np.isnan(costs)
    gen_s, line_s, costs = gen_s[valid], line_s[valid], costs[valid]

    if valid.sum() == 0:
        raise RuntimeError(f"All {n_samples} ADMM dispatch solves failed (returned nan). "
                           f"Check machine={machine} and tensor device placement.")

    if verbose:
        print(f"  {valid.sum()}/{n_samples} valid. Cost ∈ [{costs.min():.0f}, {costs.max():.0f}]")

    # ── Phase 2: train surrogate ─────────────────────────────────────────────
    gen_mid  = torch.tensor((GEN_LO  + GEN_HI)  / 2, dtype=torch.float32)
    gen_span = torch.tensor((GEN_HI  - GEN_LO)  / 2, dtype=torch.float32)
    line_mid  = torch.tensor((LINE_LO + LINE_HI) / 2, dtype=torch.float32)
    line_span = torch.tensor((LINE_HI - LINE_LO) / 2, dtype=torch.float32)

    X_gen  = (torch.tensor(gen_s,  dtype=torch.float32) - gen_mid)  / gen_span
    X_line = (torch.tensor(line_s, dtype=torch.float32) - line_mid) / line_span
    X = torch.cat([X_gen, X_line], dim=1).to(machine)

    Y = torch.tensor(costs, dtype=torch.float32)
    y_mean, y_std = Y.mean(), Y.std().clamp(min=1.0)
    Y_n = ((Y - y_mean) / y_std).to(machine)

    input_dim = X.shape[1]  # 6
    surrogate = CostSurrogate(input_dim, hidden=hidden).to(machine)
    opt = torch.optim.Adam(surrogate.parameters(), lr=3e-3, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=num_train_epochs, eta_min=1e-5)

    if verbose:
        print(f"[MEP-NN] Training surrogate ({input_dim}→1, {num_train_epochs} epochs)…")

    train_losses = []
    for epoch in range(num_train_epochs):
        surrogate.train()
        pred = surrogate(X)
        loss = nn.functional.mse_loss(pred, Y_n)
        opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(surrogate.parameters(), 1.0)
        opt.step()
        sched.step()
        train_losses.append(float(loss))
        if verbose and (epoch + 1) % 100 == 0:
            print(f"  epoch {epoch+1}: loss={loss.item():.5f}")

    surrogate.eval()

    # ── Phase 3: plan via surrogate gradient descent ─────────────────────────
    if verbose:
        print(f"[MEP-NN] Planning via surrogate Adam ({num_plan_steps} steps)…")

    gen_init  = torch.tensor([100.0, 50.0, 15.0], dtype=torch.float32)
    line_init = torch.tensor([45.0, 50.0, 11.0],  dtype=torch.float32)

    p_gen  = nn.Parameter(((gen_init  - gen_mid)  / gen_span).to(machine))
    p_line = nn.Parameter(((line_init - line_mid) / line_span).to(machine))

    plan_opt = torch.optim.Adam([p_gen, p_line], lr=5e-3)
    surrogate_costs: list[float] = []

    for _ in range(num_plan_steps):
        plan_opt.zero_grad()
        x = torch.cat([p_gen, p_line]).unsqueeze(0)
        cost_n = surrogate(x)
        cost_n.backward()
        plan_opt.step()
        with torch.no_grad():
            p_gen.clamp_(-1.0, 1.0)
            p_line.clamp_(-1.0, 1.0)
        surrogate_costs.append(float(cost_n.detach().cpu() * y_std + y_mean))

    final_gen  = (p_gen.detach().cpu()  * gen_span  + gen_mid).numpy()
    final_line = (p_line.detach().cpu() * line_span + line_mid).numpy()

    # Clip to hard bounds (in case numerical drift)
    final_gen  = np.clip(final_gen,  GEN_LO,  GEN_HI)
    final_line = np.clip(final_line, LINE_LO, LINE_HI)

    elapsed = time.time() - t0

    if verbose:
        print(f"[MEP-NN] Done in {elapsed:.1f}s | final surrogate cost: {surrogate_costs[-1]:.2f}")
        gen_names  = ["Peaker", "Solar", "Gas"]
        line_names = ["L0-1", "L1-3", "L3-0"]
        for name, init, final in zip(gen_names,  [100., 50., 15.], final_gen):
            print(f"  {name}: {init:.0f} → {final:.1f} MW")
        for name, init, final in zip(line_names, [45., 50., 11.], final_line):
            print(f"  {name}: {init:.0f} → {final:.1f} MW")

    return {
        "method": "nn_surrogate",
        "machine": machine,
        "elapsed_s": round(elapsed, 2),
        "n_samples_attempted": n_samples,
        "n_samples_valid": int(valid.sum()),
        "num_train_epochs": num_train_epochs,
        "num_plan_steps": num_plan_steps,
        "hidden_dim": hidden,
        "cost_sample_range": [float(costs.min()), float(costs.max())],
        "train_loss_history": train_losses,
        "surrogate_cost_history": surrogate_costs,
        "initial_gen_capacity_mw": [100.0, 50.0, 15.0],
        "initial_line_capacity_mw": [45.0, 50.0, 11.0],
        "final_gen_capacity_mw": final_gen.tolist(),
        "final_line_capacity_mw": final_line.tolist(),
    }

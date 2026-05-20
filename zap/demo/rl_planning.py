"""
Load-adaptable capacity expansion via Deep Q-Network (DQN).

The RL agent observes the current grid capacity state and selects discrete
expansion actions (grow any one parameter by 10%, or hold). It is trained
across multiple load scenarios (different Blackwell datacenter utilization
levels), learning a policy that generalizes to varying electricity demand.

State:  [gen_cap / gen_ref, line_cap / line_ref, scenario_onehot]  (10-dim)
Action: expand gen_i, expand line_j, or do nothing  (7 actions)
Reward: improvement in total cost relative to episode start
"""

import random
import time
from collections import deque
from copy import deepcopy

import numpy as np
import torch
import torch.nn as nn

from zap.admm import ADMMSolver, ADMMLayer
from zap.planning.operation_objectives import DispatchCostObjective
from zap.planning.investment_objectives import InvestmentObjective

from .blackwell import facility_power_mw, RACKS, UTILIZATION_PER_STEP
from .network import load_datacenter_network, PARAMETER_NAMES, TIME_HORIZON, NUM_NODES
from zap.network import PowerNetwork
from zap.devices import Generator, Load, ACLine


N_SCENARIOS   = 4       # one per Blackwell utilization level
N_GEN         = 3       # Peaker, Solar, Gas
N_LINE        = 3       # L0-1, L1-3, L3-0
N_PARAMS      = N_GEN + N_LINE
N_ACTIONS     = N_PARAMS + 1   # expand each param, or do nothing
EXPAND_DELTA  = 0.10           # fractional capacity growth per action

GEN_REF  = np.array([100.0, 50.0, 15.0])
LINE_REF = np.array([45.0,  50.0, 11.0])
GEN_HI   = np.array([400.0, 300.0, 200.0])
LINE_HI  = np.array([200.0, 200.0, 100.0])

# Blackwell utilization per scenario (one step = full-day representative)
SCENARIO_UTIL = UTILIZATION_PER_STEP  # [0.25, 0.60, 1.00, 0.80]


# ── Neural network ─────────────────────────────────────────────────────────

class QNet(nn.Module):
    def __init__(self, state_dim: int, n_actions: int, hidden: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(state_dim, hidden),
            nn.SiLU(),
            nn.Linear(hidden, hidden),
            nn.SiLU(),
            nn.Linear(hidden, n_actions),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class ReplayBuffer:
    def __init__(self, capacity: int = 8000):
        self.buf = deque(maxlen=capacity)

    def push(self, s, a, r, ns, done):
        self.buf.append((s, a, r, ns, done))

    def sample(self, n: int):
        batch = random.sample(self.buf, n)
        s, a, r, ns, d = zip(*batch)
        return (
            torch.stack(s),
            torch.tensor(a, dtype=torch.long),
            torch.tensor(r, dtype=torch.float32),
            torch.stack(ns),
            torch.tensor(d, dtype=torch.float32),
        )

    def __len__(self):
        return len(self.buf)


# ── Environment ────────────────────────────────────────────────────────────

def _build_scenario_network(util: float):
    """Build a single-step network where the DC load matches one utilization level."""
    net = PowerNetwork(NUM_NODES)
    dc_mw = float(facility_power_mw(RACKS, np.array([util]))[0])

    generators = Generator(
        name="generator", num_nodes=NUM_NODES,
        terminal=np.array([0, 1, 3]),
        dynamic_capacity=np.array([np.ones(1), [1.0], np.ones(1)]),
        linear_cost=np.array([100.0, 0.5, 40.0]),
        nominal_capacity=np.array([100.0, 50.0, 15.0]),
        capital_cost=np.array([4.0, 10.0, 10.0]),
        emission_rates=np.array([800.0, 0.0, 500.0]),
    )
    utility_load = Load(
        name="utility_load", num_nodes=NUM_NODES, terminal=np.array([0]),
        load=np.array([[55.0]]),   # representative midday utility load
        linear_cost=np.array([200.0]),
    )
    grid_lines = ACLine(
        name="grid_line", num_nodes=NUM_NODES,
        source_terminal=np.array([0, 1, 3]),
        sink_terminal=np.array([1, 3, 0]),
        susceptance=np.array([0.1, 0.05, 1.0]),
        capacity=np.ones(3),
        nominal_capacity=np.array([45.0, 50.0, 11.0]),
        linear_cost=0.025 * np.ones(3),
        capital_cost=np.array([100.0, 25.0, 30.0]),
    )
    dc_load = Load(
        name="datacenter", num_nodes=NUM_NODES, terminal=np.array([2]),
        load=np.array([[dc_mw]]),
        linear_cost=np.array([500.0]),
    )
    dc_feed = ACLine(
        name="dc_feed", num_nodes=NUM_NODES,
        source_terminal=np.array([1]), sink_terminal=np.array([2]),
        susceptance=np.array([0.2]), capacity=np.ones(1),
        nominal_capacity=np.array([20.0]),
        linear_cost=np.array([0.025]), capital_cost=None,
    )
    devices = [generators, utility_load, grid_lines, dc_load, dc_feed]
    return net, devices


class GridEnv:
    """
    Single-scenario dispatch environment.
    time_horizon=1 (one representative hour per scenario).
    """

    def __init__(self, scenario_id: int, machine: str, n_admm: int):
        self.scenario_id = scenario_id
        self.machine = machine
        util = float(SCENARIO_UTIL[scenario_id])
        net, devices = _build_scenario_network(util)
        torch_devices = [d.torchify(machine=machine) for d in devices]

        solver = ADMMSolver(
            machine=machine, num_iterations=n_admm, minimum_iterations=20,
            atol=1e-2, rtol=0.0, rho_power=1.0, battery_window=1,
            adaptive_rho=True, adaptation_frequency=50, verbose=0,
        )
        self.layer = ADMMLayer(net, torch_devices, PARAMETER_NAMES, time_horizon=1, solver=solver)
        self.op_obj = DispatchCostObjective(net, torch_devices)
        self.inv_obj = InvestmentObjective(torch_devices, self.layer)

    def cost(self, gen_cap: np.ndarray, line_cap: np.ndarray) -> float:
        # Move to the layer's device and unsqueeze to (N, 1)
        gen_t  = torch.tensor(gen_cap,  dtype=torch.float32).to(self.machine).unsqueeze(1)
        line_t = torch.tensor(line_cap, dtype=torch.float32).to(self.machine).unsqueeze(1)
        try:
            with torch.no_grad():
                state  = self.layer.forward(generator=gen_t, ac_line=line_t).as_outcome()
                params = self.layer.setup_parameters(generator=gen_t, ac_line=line_t)
                op  = float(self.op_obj(state, parameters=params, la=torch))
                inv = float(self.inv_obj(generator=gen_t, ac_line=line_t, la=torch))
            return op + inv
        except Exception:
            return 1e6


def _state_vec(gen_cap, line_cap, scenario_id) -> torch.Tensor:
    gen_n = torch.tensor(gen_cap / GEN_REF, dtype=torch.float32)
    line_n = torch.tensor(line_cap / LINE_REF, dtype=torch.float32)
    oh = torch.zeros(N_SCENARIOS, dtype=torch.float32)
    oh[scenario_id] = 1.0
    return torch.cat([gen_n, line_n, oh])


# ── Main runner ────────────────────────────────────────────────────────────

def run_rl_planning(
    machine: str = "cpu",
    num_episodes: int = 80,
    steps_per_episode: int = 15,
    num_admm_iterations: int = 150,
    batch_size: int = 32,
    gamma: float = 0.95,
    epsilon_start: float = 1.0,
    epsilon_end: float = 0.10,
    epsilon_decay: float = 0.96,
    target_update_every: int = 5,
    verbose: bool = True,
) -> dict:
    """
    Train a DQN agent for load-adaptable capacity expansion.

    Training cycles through all 4 Blackwell load scenarios so the agent
    learns a single policy that performs well across all demand levels.
    """
    t0 = time.time()
    torch.manual_seed(42)
    np.random.seed(42)
    random.seed(42)

    # One dispatch environment per scenario
    envs = [GridEnv(s, machine, num_admm_iterations) for s in range(N_SCENARIOS)]

    state_dim = N_PARAMS + N_SCENARIOS  # 6 + 4 = 10
    q_net  = QNet(state_dim, N_ACTIONS).to(machine)
    tgt    = QNet(state_dim, N_ACTIONS).to(machine)
    tgt.load_state_dict(q_net.state_dict())
    tgt.eval()

    opt    = torch.optim.Adam(q_net.parameters(), lr=1e-3)
    replay = ReplayBuffer()

    epsilon = epsilon_start
    episode_rewards: list[float] = []
    episode_costs:   list[float] = []

    if verbose:
        print(f"[RL] DQN: {num_episodes} episodes × {steps_per_episode} steps on {machine}")
        print(f"     scenarios: {N_SCENARIOS} (Blackwell util={SCENARIO_UTIL.tolist()})")

    for ep in range(num_episodes):
        scenario = ep % N_SCENARIOS
        env = envs[scenario]

        gen_cap  = GEN_REF.copy()
        line_cap = LINE_REF.copy()
        state = _state_vec(gen_cap, line_cap, scenario)

        ep_reward = 0.0
        ep_cost   = env.cost(gen_cap, line_cap)
        cost0     = ep_cost  # baseline cost at episode start

        for step in range(steps_per_episode):
            # Epsilon-greedy
            if random.random() < epsilon:
                action = random.randrange(N_ACTIONS)
            else:
                q_net.eval()
                with torch.no_grad():
                    action = int(q_net(state.unsqueeze(0).to(machine)).argmax())

            # Apply action
            next_gen  = gen_cap.copy()
            next_line = line_cap.copy()
            if action < N_GEN:
                next_gen[action] = min(next_gen[action] * (1 + EXPAND_DELTA), GEN_HI[action])
            elif action < N_PARAMS:
                idx = action - N_GEN
                next_line[idx] = min(next_line[idx] * (1 + EXPAND_DELTA), LINE_HI[idx])
            # action == N_PARAMS → do nothing

            new_cost  = env.cost(next_gen, next_line)
            reward    = (ep_cost - new_cost) / max(cost0, 1.0)  # normalized improvement
            gen_cap   = next_gen
            line_cap  = next_line
            ep_cost   = new_cost
            done      = step == steps_per_episode - 1

            next_state = _state_vec(gen_cap, line_cap, scenario)
            replay.push(state, action, reward, next_state, float(done))
            state = next_state
            ep_reward += reward

            # Train on minibatch
            if len(replay) >= batch_size:
                s, a, r, ns, d = replay.sample(batch_size)
                s  = s.to(machine);  ns = ns.to(machine)
                r  = r.to(machine);  d  = d.to(machine)

                q_net.train()
                q_vals = q_net(s).gather(1, a.unsqueeze(1).to(machine)).squeeze(1)
                with torch.no_grad():
                    next_q = tgt(ns).max(1)[0]
                    targets = r + gamma * (1.0 - d) * next_q

                loss = nn.functional.smooth_l1_loss(q_vals, targets)
                opt.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(q_net.parameters(), 1.0)
                opt.step()

        if ep % target_update_every == 0:
            tgt.load_state_dict(q_net.state_dict())

        epsilon = max(epsilon_end, epsilon * epsilon_decay)
        episode_rewards.append(float(ep_reward))
        episode_costs.append(float(ep_cost))

        if verbose and (ep + 1) % 20 == 0:
            avg_r = np.mean(episode_rewards[-20:])
            print(f"  ep {ep+1}/{num_episodes}: avg_reward={avg_r:.4f} ε={epsilon:.3f}")

    # ── Evaluate final policy across all scenarios ───────────────────────────
    q_net.eval()
    final_caps = {}
    for sc in range(N_SCENARIOS):
        env = envs[sc]
        gen_cap  = GEN_REF.copy()
        line_cap = LINE_REF.copy()
        for _ in range(steps_per_episode):
            state = _state_vec(gen_cap, line_cap, sc)
            with torch.no_grad():
                action = int(q_net(state.unsqueeze(0).to(machine)).argmax())
            if action < N_GEN:
                gen_cap[action] = min(gen_cap[action] * (1 + EXPAND_DELTA), GEN_HI[action])
            elif action < N_PARAMS:
                idx = action - N_GEN
                line_cap[idx] = min(line_cap[idx] * (1 + EXPAND_DELTA), LINE_HI[idx])
        final_cost = env.cost(gen_cap, line_cap)
        final_caps[str(sc)] = {
            "final_gen_capacity_mw":  gen_cap.tolist(),
            "final_line_capacity_mw": line_cap.tolist(),
            "final_cost": round(float(final_cost), 2),
            "utilization": float(SCENARIO_UTIL[sc]),
        }

    elapsed = time.time() - t0

    if verbose:
        print(f"[RL] Done in {elapsed:.1f}s")
        for sc, caps in final_caps.items():
            print(f"  Scenario {sc} (util={caps['utilization']:.0%}): "
                  f"gen={[round(x,1) for x in caps['final_gen_capacity_mw']]} "
                  f"cost={caps['final_cost']:.0f}")

    return {
        "method": "rl_dqn",
        "machine": machine,
        "elapsed_s": round(elapsed, 2),
        "num_episodes": num_episodes,
        "steps_per_episode": steps_per_episode,
        "gamma": gamma,
        "episode_rewards": episode_rewards,
        "episode_costs": episode_costs,
        "final_caps_per_scenario": final_caps,
        "initial_gen_capacity_mw": GEN_REF.tolist(),
        "initial_line_capacity_mw": LINE_REF.tolist(),
        "scenarios": {
            "0": "Night (25% util)",
            "1": "Morning (60% util)",
            "2": "Afternoon (100% util)",
            "3": "Evening (80% util)",
        },
    }

# Steinmetz

## Brief

Steinmetz is a grid intelligence system for utility providers, IT infrastructure developers, and electricity-sector investors. It produces objective-based grid expansion plans, surfaces liabilities, and informs financial decisions across horizons ranging from daily operations to multi-year investments.

Energy dispatch on the grid is governed by a power-flow schedule that specifies, for each hour of the day, how much energy each device will supply or consume and at what price.

The optimal power-flow (OPF) schedule must satisfy a wide range of physical constraints and resiliency to device failures while minimizing the cost of energy based on bids submitted by utility providers in the day-ahead auction.

Providers submit bids based on their expectations of the resulting dispatch schedule and of how other providers will bid. They also use projected power-flow schedules to inform longer-horizon decisions, such as expansion planning, by estimating operational factors like congestion and curtailment, and translating those effects into expected project earnings.

The core difficulty is that the electricity market is disproportionately sensitive to small changes in the grid. A modest change in line capacity, topology, generation, storage, or load can materially change congestion patterns, locational prices, dispatch schedules, and project economics. As a result, nearly every important decision in the market can be framed as a question about marginal value: what happens to the schedule, prices, reliability, or earnings if some part of the grid changes?

Answering this is very computationally expensive. Each counterfactual typically requires resolving a high-fidelity, constraint-heavy power-flow problem from new starting conditions. That makes scenario analysis slow, sensitivity analysis difficult, and long-horizon planning expensive or wholly intractable through traditional OPF solvers. Incumbent tools often extend analysis into the future only by exploring representative days, dropping contingencies, or modeling only fragments of the grid.

This leaves the inverse problem largely untouched. Market participants do not only want to ask what happens if a specific line, battery, generator, or load is added. They want to ask what exact change would best achieve a desired objective: unlocking a target amount of power, reducing curtailment, improving speed-to-power, increasing risk-adjusted returns, or relieving a specific liability at lowest cost.

Steinmetz is an attempt at making that class of questions more tractable. It computes high-fidelity, physics-constrained, multi-period power-flow schedules over 100x faster than commercial solvers on the same problem, and up to 400x faster for large grids and long horizons. Because the solver runs on the GPU and preserves a computation graph of how it arrived at a solution, it is end-to-end differentiable: we can calculate the jacobian of the solution and its associated variables with respect to all starting parameters with a single backpropagation. For example, we might define a function that calculates the profit for an individual player as a function of the final OPF schedule. We can then trace through the computation graph and compute how the bidded capacity of a single battery affects profit.

Similarly, we may use simple gradient descent or neural networks to optimize profit with minor additions. We may do this for any arbitrary objective function, and use it to both inform optimal day-before bids, or plan capacity expansions. One backward pass yields the marginal value of every parameter at once for whatever objective the client defines. Obtaining the Jacobian for free would not be possible if not for the convex relaxation and parallel computation the OPF solver in our stack uses; if not for that, we would not be able to tackle these inverse design problems.

In that sense, Steinmetz is a marginal-value engine for the grid. It turns power-flow schedules from expensive static artifacts into objects that our harness can search, differentiate, stress-test, and easily optimize against. This opens a new class of financial and infrastructure decisions across utility providers, energy traders, investors, governments, and IT infrastructure developers.

## Market Mechanism

Country-agnostic.

Since the grid is disproportionately sensitive to small changes in its topology or available capacity, markets are usually highly regulated, with a central operator enforcing many operational constraints that reduce some of this volatility.

On any given day, every device in the grid must collectively satisfy that set of physical and redundancy constraints. As a result, the bulk of a supply-side device's behavior for the day is settled the day before, by the central operator, to keep energy reliable and reasonably priced.

Concretely, the central operator gathers each provider's costs and physical parameters (submitted as price-quantity offers in bid-based markets, or set from regulated cost models in cost-based ones) along with constraints like ramp rates and generator startup costs. It then computes the least-cost dispatch schedule for the next day that respects every constraint. The resulting power-flow schedule, with prices attached, becomes a binding financial commitment for how much energy each device is expected to provide at each hour and at what price.

For generators, this contract means that if they deliver less than their commitment they must buy back the difference at the real-time price. All deviations from the schedule are settled against that price, and generators decide whether to supply or hold back based on how the live price compares to their committed price.

For transmission owners, while they do not bid in the daily auction, they obtain value on the energy congestion they relieve. A merchant line operator captures a congestion rent: the price spread across the line, which is one of the shadow prices Steinmetz supports. However, regulated transmission owners (in Mexico, CFE) earn a regulated return regardless of congestion; the lines are built by EPCs like Edemtec under contract.

Since the power flow schedule is not strictly binding, utility providers still have a lot of wiggle room within the constraints that the schedule sets. This presents an opportunity for energy traders and individual utility companies to gain edge. Since all shortfalls in supply are traded at the current price, anticipating the differences and exploring different scenarios is something energy traders do often. Edge in the market reduces to pricing in the marginal value of plausible changes to supply-side devices.

Actors make every decision against these marginal values on horizons from the next hour to the next decade. The value does not have to be strictly monetary. Slight changes to the existing devices, or additions of transmission lines, batteries, or a large load like a data center can significantly change access to energy in different parts of the grid. For example, knowing the marginal change in power in a site from adding a transmission line between two devices presents an opportunity to find hidden power which can be tapped into through minor additions. Formulating the inverse problem, like finding the region with the least intensive way to unlock a certain amount of power, and the way itself, is extremely valuable to players like data center developers.

In short, utility providers must constantly make decisions for very different time horizons and with limited information, ranging from multi-year expansion plans, to day-before commitments and intraday supply-or-refrain decisions. In a given hour, a generator weighs whether to supply or hold back, factoring in startup costs, its estimate of the end-of-day cleared price, and its own device-specific constraints. For a multi-year expansion, the same reasoning plays out over siting, the outsized effect a single topology change can have on the entire market, the regulatory climate, macro trends, and its best guess at what every other player will do.

## Benchmarks

Source: `zap/experiments/steinmetz_bench/reports/STEINMETZ_BENCH.md`.

- 13 / 13 benchmark experiments reported results, all from synthetic fixtures.
- Validation: PyPSA roundtrip max LMP gap `2.47919e-06 $/MWh`; adjoint-vs-dual max relative error `4.656e-06`.
- GPU path: H100 Modal ADMM solve matched the CPU LP objective within `1.65254e-06` relative error; max absolute objective gap `0.227236 $` across 3 cases.
- Dollar backtests: data-center siting `50.0379 $/MWh`, data-center flexibility `3.51205e+06 $/yr`, utility SCED `4.74368e+07 $/yr`, transmission audit `0.930564 R2`, Mexico EPC corridor ranking `-0.857143` Spearman.

## Citations

```bibtex
@article{degleris2024gpu,
  title={GPU Accelerated Security Constrained Optimal Power Flow},
  author={Anthony Degleris and Abbas El Gamal and Ram Rajagopal},
  journal={arXiv preprint arXiv:2404.01255},
  year={2024},
}
```

The agent harness is based on [opencode](https://github.com/anomalyco/opencode).

## Setup

Use the `monorepo` branch for local setup. The `grid-app`, `zap`, and `opencode` branches can be viewed separately for cleaner commit history; `monorepo` is easiest for a unified setup.

```bash
git clone -b monorepo https://github.com/llanoajm/dc153.git
cd dc153
```

```bash
cd zap
poetry install --all-extras --with experiment
```

```bash
cd ../opencode
bun install
OPENROUTER_API_KEY=... bun dev serve
```

```bash
cd ../grid-app
npm install
cp .env.example .env.local
npm run dev
```

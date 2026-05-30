# GridAgent: An Agentic Marginal-Value Engine for the Power Sector

**Working title / internal codename: "GridAgent." Status: draft v0.1 for internal review.**

*A proposal to package our agentic coding platform plus GPU-accelerated, differentiable grid-optimization sandboxes into a product for utilities, investors, large-load (data center) developers, and governments.*

---

## 0. Executive summary

Every dollar in the electric power sector is, ultimately, the monetization of a *dispatch decision made inside a constraint set*. Who runs when, on which lines, at what price, is the output of a constrained optimization (optimal power flow, OPF) that grid operators solve continuously. Prices, congestion, curtailment, capacity value, and the entire economic case for building anything are duals and forecasts of that optimization.

A recent result (Degleris, El Gamal, Rajagopal, *Optimization and Engineering*, 2026) makes that optimization (a) fast — over 100× speedups vs. commercial solvers, 500M-variable contingency-constrained problems in under a minute on one GPU — and, more importantly, (b) **end-to-end differentiable**: the solver emits the gradient of any system metric with respect to any device parameter for free. That derivative *is* a shadow price — the marginal value of a MW of generation here, a MW of line capacity there, an MWh of storage, a unit of flexible load.

GridAgent wraps this and a family of open-source grid solvers in our agentic harness. A user states an objective in natural language ("what's the marginal value of 200 MW of flexible load at each node of the ERCOT West zone, and where should I put my data center?"). The agent compiles it into a differentiable OPF/planning program, acquires the data, runs it on H100s (via Modal), and returns the answer plus the sensitivity of that answer to every assumption. It does what a Claude-grade coding agent does, but with privileged access to the internals of these solvers and the ability to spin up more solver sandboxes on demand.

We sell the *marginal-value machine*, not the dispatch. The dispatch belongs to the system operator; the gradients and duals — the things that drive siting, sizing, bidding, hedging, and build decisions — are what every commercial actor can act on. This document lays out the market structures we can serve, the four client types and their objectives, the solver and system architecture, concrete historical backtests to prove value, the competitive landscape, and the limitations.

---

## 1. Background: power and phase schedules, and why expansion is downstream of them

### 1.1 The physics that forces scheduling

At grid scale, generation must equal load plus losses at every instant; the shared signal of that balance is frequency. Imbalance shows up in milliseconds with severe consequences (equipment trips, cascades), so balance is maintained continuously rather than settled after the fact. That single fact turns "running a utility" into "running a schedule."

Power does not route like packets. On a meshed AC network, real-power flow between two buses is governed (in the DC approximation) by `P ≈ (θᵢ − θⱼ) / X` — the **voltage phase-angle difference** across a line divided by its reactance. An operator does not choose flows; they choose injections, and the angle pattern and the resulting flows fall out of Kirchhoff's laws. Layered on top: thermal limits (current heats lines), voltage limits, stability limits (which on long corridors often bind first), and an **N-1 security standard** — the system must survive the loss of any single element. This is exactly the contingency-constrained OPF the paper solves.

So a grid is run as two coupled schedules:

- **Power schedule** (`p` in the paper): which generators produce how much, when — solved as unit commitment (day-ahead, which units on) plus economic dispatch (how to allocate output at least cost) subject to all the limits above, re-solved toward real time, with governor/AGC handling the sub-second balance.
- **Phase schedule** (`θ` in the paper): the angle pattern that *produces* those flows. In DC-OPF, `θ` is the internal variable whose differences set real-power flow and whose binding line limits generate the **congestion price**. (Note: this is the angle layer, not the reactive-power/voltage-magnitude layer, which DC-OPF omits — see Limitations.)

In restructured markets these schedules are cleared as a market: a day-ahead auction yields financially binding schedules and **locational marginal prices (LMPs)**, with a real-time market settling deviations. The LMP at each node decomposes into **energy + congestion + losses** — so the transmission constraints surface directly as the congestion component of price. In a vertically integrated utility the same optimization runs inside a control room rather than a market clearing.

### 1.2 Why planning and finance are (mostly) downstream

Expansion plans and valuations are largely *forecasted operations*. A transmission line is justified by where congestion persistently binds (LMP separation revealed by production-cost simulation). A generator's interconnection study asks "if we inject here, what new constraints appear and what upgrades are triggered?" An asset's pro forma — energy + capacity + ancillary + congestion revenue — is the output of a simulated future dispatch under the same constraint set. The cash flows are downstream of the physics because every revenue stream is the monetization of how the asset is dispatched within the limits.

But it is a feedback loop, not a one-way arrow: planning *reshapes* the constraints (you build to relax the binding limit); exogenous drivers (decarbonization mandates, electrification, data-center load) push the planned system to a shape current operations don't imply; and financial evaluation carries its own logic (regulated rate base × allowed ROE, cost of capital, depreciation) not reducible to dispatch. **GridAgent lives precisely at this seam**: it turns the operational constraint set into the marginal-value signals that drive planning and valuation, fast enough to run thousands of scenarios and differentiable enough to optimize the build directly.

---

## 2. Partial controllability of electricity markets

The single most important sales-qualifying question is: *in this jurisdiction, what can our client actually move?* Controllability is a spectrum. The physics is never controllable. What varies by market is how much of the *economics* is set by competitive dispatch (where shadow prices are real money and our gradients are directly actionable) versus by administrative/regulated decisions (where our value shifts toward planning justification and scenario analysis).

We rank six target markets from most to least "nodal/market-controllable."

### 2.1 United States — full nodal LMP, highest controllability

RTOs/ISOs (PJM, MISO, CAISO, ERCOT, SPP, NYISO, ISO-NE) run security-constrained unit commitment + economic dispatch and publish nodal LMPs decomposed into energy/congestion/loss. Merchant generation is largely "decide-and-build" gated by the interconnection queue; transmission is planned regionally (RTEP/MTEP/TPP) with cost allocation; FTRs/CRRs are tradeable congestion rights. **This is where every gradient we produce maps directly to a price or a tradeable position.** ~60% of US load is in organized markets; the Southeast and much of the West outside CAISO remain vertically integrated (planning-driven, not market-driven).

### 2.2 Mexico — nodal prices, but administratively reasserted

CENACE operates the system and the Wholesale Electricity Market (created 2014), clearing **nodal local marginal prices (Precio Marginal Local, PML)** = energy + losses + congestion. However, the 2024–2025 reforms (constitutional reform Oct 2024; Electricity Sector Law / LESE enacted March 2025) reasserted state control: the state utility CFE must supply at least ~54% of dispatched energy, strict merit-order dispatch is partly displaced by CFE priority, and the independent regulator (CRE) was folded into a centralized National Energy Commission (CNE) under the executive. Expansion is centrally planned through PRODESEN. *Implication:* nodal price signals still exist and congestion is still real, but private actors face a hard dispatch-share ceiling and a politicized planning process — our value tilts toward (a) siting/valuation under the new dispatch rules and (b) helping EPCs and the planner rank PRODESEN transmission projects. (See §2.x backtest.)

### 2.3 Brazil — cost-based, zonal, hydro-coordinated

The operator (ONS) centrally optimizes a predominantly hydrothermal system via the NEWAVE → DECOMP → DESSEM model chain; settlement (by CCEE) uses the **PLD (Preço de Liquidação de Diferenças)**, an *hourly* price since Jan 2021 but defined per **submarket (4 zones), not per node**. It is cost-based, not bid-based, and capped by a regulatory floor/ceiling. Forward contracts trade on BBCE. *Implication:* no nodal congestion price to trade, but enormous value in (a) hydrothermal scheduling / reservoir-value analysis, (b) submarket spread forecasting for PPAs, and (c) flexibility valuation as variable renewables grow. Our DC-OPF nodal machinery must be adapted to a zonal, hydro-dominated frame.

### 2.4 India — exchange-based, uniform price moving to coupling

A cost-of-service backbone (state DISCOMs, long-term PPAs) plus power exchanges (IEX ~90–95% share, PXIL, HPX) running DAM/RTM/TAM. Currently largely uniform pricing with congestion managed by splitting bid areas. **Market coupling** (a single market-clearing price across exchanges, operators rotating, Grid-India as backup) is scheduled to begin phased rollout with the day-ahead market around Jan 2026 — a structural change that increases the value of accurate clearing/congestion modeling. Grid-India / NLDC operates the system. *Implication:* growing addressable surface as the market liberalizes; near-term value in DAM/RTM price forecasting, congestion-zone analysis, and renewable+storage arbitrage.

### 2.5 Colombia — network-aware dispatch, *uniform national price*

XM operates the system and the "bolsa" (spot market). Notably, operational dispatch considers network constraints in detail, **but economic settlement uses a single uniform national price** — there is no nodal/zonal congestion price in settlement. A "cargo por confiabilidad" (firm-energy/scarcity-price) mechanism handles adequacy. Hydro-dominated → acute El Niño/drought exposure. Reform toward binding day-ahead/intraday markets is under active discussion. *Implication:* the congestion dual is *operationally real but not monetized in price*, so our value is in reliability/adequacy planning, hydro/scarcity risk, and being ready for the day-ahead-market reform.

### 2.6 Central America — a regional layer over six national markets

The **Regional Electricity Market (MER)** sits on the SIEPAC transmission backbone, operated by the EOR (Ente Operador Regional), regulated by CRIE, grid owned by EPR; it overlays six national markets (Guatemala, El Salvador, Honduras, Nicaragua, Costa Rica, Panama), with DC links to Mexico and Colombia. National markets are a mix of bid- and cost-based. Regional trade is growing (~3,000+ GWh/yr). *Implication:* the high-value problem is **cross-border transfer optimization and interconnection planning** — exactly a multi-zone OPF with interface limits — plus harmonizing six heterogeneous data regimes.

**Controllability spectrum (summary):**
`US (nodal, tradeable) ▸ Mexico (nodal, capped dispatch) ▸ India (zonal → coupling) ▸ Brazil (zonal, cost-based, hydro) ▸ Colombia (uniform price, network-aware dispatch) ▸ Central America (regional/interface-limited)`

Our gradient/dual product is most directly monetizable on the left; toward the right, value shifts to planning, scenario analysis, reliability, and reform-readiness. **All six are addressable; the pitch changes.**

---

## 3. The four client types: objectives, risks, and how each chains to our solver

For each client we give the quantifiable objective(s), the risks/problems that move those metrics, and the chain `metric → OPF/planner formulation` that our engine actually runs.

### 3.1 Utility providers

*(transmission owners, generators, vertically integrated utilities, storage operators, system operators)*

**Quantifiable objectives.**

- Vertically integrated utility / IRP: minimize total system cost (fuel + startup + unserved energy + carbon penalty) subject to reliability; maximize prudent rate base.
- Merchant generator: maximize expected energy + capacity + ancillary revenue net of fuel; minimize basis risk at its node.
- Transmission owner: maximize congestion-relief welfare delivered (regulated) or congestion rent captured (merchant HVDC).
- Storage operator: maximize arbitrage value stack (energy + regulation + capacity).

**Risks / problems that move the metric.** Fuel-price volatility; forced-outage and N-1 contingencies; renewable forecast error; congestion that strands an asset at a low-LMP node; curtailment of renewables; prudence disallowance (regulated); load-growth uncertainty (data centers); policy/dispatch-rule changes (esp. Mexico).

**Chain to the solver.**

- *Total system cost* → directly the objective `Σ_d f_d(p_d, θ_d)` of the contingency-constrained OPF (paper Eq. 4). Run as production-cost modeling over scenarios.
- *Nodal revenue / basis* → the nodal price is the dual of the power-balance constraint (the variable `u` in the paper); `revenue = Σ_t (price × dispatch)` at the asset's node, over the LMP distribution from many scenario solves.
- *Marginal value of a build* → `∂(system cost)/∂(device capacity)` via unrolled autodiff (paper Fig. 6, `∂f/∂p_max = −λ`). Negative gradient on an existing asset = retirement signal.
- *Arbitrage value of storage* → the battery is a first-class device with state-of-charge dynamics (paper §2.1); its intertemporal value falls straight out of the multi-period solve.

### 3.2 Electricity-sector investors

*(IPP/renewable developers, infrastructure funds, FTR/CRR and power-trading desks, lenders/underwriters)*

**Quantifiable objectives.** Project NPV / IRR; merchant-revenue P50/P10; basis risk; FTR/CRR auction edge; portfolio VaR; debt-sizing (DSCR under stressed prices).

**Risks / problems.** Price-cannibalization as more renewables enter the same node; congestion that decouples a project's node from the hub it hedged against; curtailment risk; merchant tail risk (revenue concentrated in scarcity hours); model risk in the price forecast itself.

**Chain to the solver.**

- *Merchant revenue distribution* → batch-solve OPF over M weather/load/outage scenarios → distribution of nodal price `u` at the project node → P50/P10 revenue.
- *FTR/CRR expected payoff* → for a source→sink (A→B) right of quantity Q: `payoff = Q · Σ_t (u_{B,t} − u_{A,t})`, read directly from converged nodal duals; the line-flow dual `μ_l` (= `−∂f/∂line-capacity`) attributes the spread to specific binding corridors = risk decomposition.
- *Sensitivity / hedge ratios* → `∂(revenue)/∂(load growth, a competitor's entry, a line derate)` via the same backward pass.
- *Debt sizing* → stressed-scenario LMP distributions → DSCR under P90 conditions.

### 3.3 Bespoke IT infrastructure developers

*(hyperscalers, colocation/data-center builders, crypto, large flexible industrial loads)*

This is the fastest-growing and least-served segment, and the one where our differentiable curtailment/flexibility signals are most novel.

**Quantifiable objectives.** Minimize effective $/MWh of delivered power; minimize/accelerate interconnection timeline; maximize value of on-site flexibility (batteries, on-site gen, deferrable/shiftable compute); meet curtailment-compliance mandates (e.g., ERCOT SB6 requires >75 MW new loads to curtail on instruction during emergencies).

**Risks / problems.** Multi-year interconnection queues; siting at a congested/high-LMP node; exposure to scarcity-price spikes if firm; stranded capital if flexibility is undervalued in planning; policy mandates forcing curtailment capability.

**Chain to the solver.**

- *Site selection* → rank candidate nodes by the LMP duration curve and curtailment frequency from historical + scenario OPF solves; the node with the favorable LMP *distribution* (not just mean) wins.
- *Flexibility sizing* → model the data center as a flexible load (the paper's curtailable-load device, a "generator" with `p_min < p_max ≤ 0`); compute `∂(curtailment relieved or $ saved)/∂(flexible-load capacity)` and `∂/∂(co-located battery power)` by autodiff. This directly sizes the on-site battery and the deferrable-compute envelope.
- *Spatial flexibility (multi-site)* → co-optimize load placement across sites; recent work shows spatial flexibility can cut renewable curtailment substantially and defer transmission upgrades — our engine quantifies it per-corridor.
- *Interconnection screening* → run the injection/withdrawal as a contingency-aware power-flow change to estimate which upgrades the load triggers before filing.

### 3.4 Government and regulators

*(system operators, ministries/PUCs, regional bodies like EOR/CRIE, transmission planners)*

**Quantifiable objectives.** Minimize total system cost to consumers; maximize reliability (loss-of-load expectation, expected unserved energy); maximize welfare from transmission investment; meet renewable/decarbonization and affordability targets; allocate costs fairly.

**Risks / problems.** Overbuilding (treating flexible large loads as firm); under-building (queue backlogs, congestion); stranded-asset risk under policy change; political pressure distorting merit order (Mexico); drought/hydro risk (Brazil, Colombia, Central America); cross-border coordination (Central America).

**Chain to the solver.**

- *Transmission-plan evaluation* → for each candidate corridor, `∂(system cost)/∂(line capacity)` ranks projects by marginal congestion-relief welfare; compare against realized congestion to audit a historical plan.
- *Reliability metrics* → contingency-constrained solve over outage scenarios → unserved energy, congestion frequency, LOLE proxies.
- *Large-load impact studies* → add the proposed load and re-solve to quantify congestion, curtailment, and required upgrades — directly informing flexible-interconnection rules.
- *Policy scenario analysis* → carbon penalty as an implicit cost in the planner's objective (paper §5.6 runs exactly this), CFE-share constraints (Mexico), etc.

---

## 4. Solver / optimizer / planner architecture (the math layer)

Three nested layers, all GPU-resident and differentiable.

### 4.1 The solver (inner loop): differentiable contingency-constrained DC-OPF

A PyTorch implementation of the paper's **proximal message-passing ADMM**. Key properties:

- **Device-node model.** Generators, loads, AC/DC lines, batteries, ramping units, and flexible loads are all "devices" with a convex cost function `f_d(p_d, θ_d)`; nodes enforce power balance (`p̄ = 0`) and phase consistency (`θ̃ = 0`). New devices = new proximal operators (modular).
- **No linear solves.** Only sparse incidence-matrix multiplies (scatter/gather kernels) and vectorized proximal operators → fully parallel on GPU.
- **Contingencies as batched parameter perturbations.** N-1 line outages = zeroing a line's capacity/susceptance per contingency `k`; all contingencies solved in parallel.
- **Outputs:** primal schedules `(p, θ)`, nodal prices (dual `u` of power balance), line congestion prices (dual `μ` of line limits), and — via the converged duals — full LMP decomposition.
- **Performance:** ~100–400× vs. Mosek on large cases; 500M-variable problems in ~60 s on one A100/H100; warm starts halve iteration counts (critical for scenario sweeps and planning).
- **Accuracy regime:** best at 1e-2 to 1e-4 — appropriate for production-cost modeling, day-ahead-style dispatch, and planning, where this error is below data uncertainty. (Not a substitute for the ISO's settlement-grade solve — see Limitations.)

### 4.2 The optimizer (sensitivity layer): unrolled autodiff

Because every ADMM iteration is a.e.-differentiable, the entire solver is a differentiable function `s*(x)` of the problem data `x`. We get `∂(any metric)/∂(any parameter)` by reverse-mode autodiff — the shadow price of anything. The backward pass costs roughly the same as the forward solve. This is the heart of the product: **arbitrary user-defined metrics become differentiable objectives.**

### 4.3 The planner (outer loop): gradient-based expansion / parameter optimization

Expansion planning is a bilevel problem: choose device capacities `η` to minimize a planner objective `Σ_m F_m(s*_m(η))` over scenarios `m`, where each `s*_m` is an OPF solution. We solve it by gradient descent: solve OPF (inner) → unrolled-diff to get `∂F/∂η` → step `η`. The paper does this for AC/DC lines, generators, and batteries across 8 scenarios with an implicit carbon penalty in ~4.5 minutes (vs. ~1.5 hours for a Mosek + implicit-diff baseline). Warm-starting each inner solve from the previous step keeps inner iterations minimal. The planner objective is **user-defined** — total cost, carbon, congestion rent, curtailment, a client's private NPV, anything expressible over `(p, θ, u, v, η)`.

---

## 5. System architecture: the agentic harness over solver sandboxes

GridAgent = our agentic coding platform (a Claude-grade agent) + a fleet of solver sandboxes + a natural-language-to-program compiler + data connectors + GPU execution.

```
┌──────────────────────────────────────────────────────────────────┐
│  USER (NL objective): "Where should I put 300 MW of flexible load  │
│  in ERCOT, and what battery sizing maximizes my arbitrage net of   │
│  SB6 curtailment risk?"                                            │
└───────────────┬──────────────────────────────────────────────────┘
                │
        ┌───────▼────────┐   Plans the job, writes/edits solver code,
        │  AGENT HARNESS │   chooses sandboxes, inspects internals,
        │ (LLM + tools)  │   iterates on results, explains the answer.
        └───┬───────┬────┘
            │       │
   ┌────────▼─┐  ┌──▼─────────────┐  ┌─────────────────┐
   │  DATA    │  │  SOLVER        │  │  REFERENCE /     │
   │  LAYER   │  │  SANDBOXES     │  │  VALIDATION      │
   │          │  │  (GPU, Modal)  │  │  SANDBOXES       │
   │ gridstatus│ │ • zap (paper's │  │ • Sienna/        │
   │ ISO APIs │  │   diff. DC-OPF)│  │   PowerSim.jl    │
   │ EIA/CENACE│ │ • planner loop │  │   (SCUC+SCED,    │
   │ PyPSA-USA│  │ • surrogate    │  │   UC truth)      │
   │ CENACE PML│ │   models       │  │ • PowerModels.jl │
   │ XM/CCEE  │  │ • RL gyms      │  │   (AC-OPF check) │
   └──────────┘  └────────────────┘  └─────────────────┘
```

**How the harness uses the sandboxes.** The agent has *white-box* access to the solver internals (unlike a user of a black-box commercial tool). It can:

1. **Compile** the NL objective into a planner/optimizer program — define the metric `F`, mark the decision parameters `η`, choose scenarios.
2. **Acquire data** through connectors (gridstatus for US/Canada ISO LMP+congestion+load; EIA; CENACE PML; XM; CCEE; PyPSA-USA for topology/fleet; pglib/RTS-GMLC for test systems).
3. **Pick the right sandbox.** Fast differentiable DC-OPF (the paper's `zap`) for sensitivities, scenario sweeps, and planning. A UC-aware sandbox (Sienna/PowerSimulations.jl or Prescient) when commitment/scarcity pricing matters. An AC-OPF sandbox (PowerModels.jl) when voltage/reactive fidelity matters. An RL gym (Grid2Op) for sequential control/redispatch policies.
4. **Run on H100s via Modal**, batching scenarios and contingencies.
5. **Differentiate** to return not just the answer but its sensitivity to every assumption.
6. **Validate** by cross-checking the fast DC result against a slower high-fidelity sandbox and reporting the gap.
7. **Explain** the result, the binding constraints, and the confidence — in the client's own terms.

The agentic layer is the moat: a commercial PCM tool gives you a GUI and a fixed model; GridAgent gives you an analyst that writes the model to your question, runs it at GPU scale, and tells you how much to trust it.

---

## 6. Applications by client type and player

**Utilities.**

- Vertically integrated utility: stochastic IRP (generation + transmission + storage co-optimization under scenarios with carbon and reliability constraints); fuel-cost-minimizing dispatch advisory; retirement screening.
- Transmission owner (regulated): rank RTEP/MTEP candidate projects by marginal congestion-relief welfare; build the prudence case.
- Merchant HVDC / transmission developer: pro-forma congestion-rent estimation for a spec line.
- Merchant generator: siting, sizing, repower/retire, revenue forecasting, self-hedge design.
- Storage operator: value-stack optimization (energy + regulation + capacity), optimal bidding.
- System operator: faster PCM, more contingencies, more stochastic scenarios.

**Investors.**

- Renewable/IPP developer: P50/P10 merchant revenue, cannibalization and basis risk by node.
- Infra fund / lender: stressed-DSCR debt sizing; portfolio VaR.
- FTR/CRR desk: congestion-spread distribution forecasting, position sizing, risk attribution by binding line.
- Virtual/INC-DEC trader: day-ahead vs. real-time spread screening (with the UC caveat).
- M&A diligence: independent revenue/valuation model for an asset under acquisition.

**Bespoke IT infrastructure.**

- Hyperscaler: multi-site spatial-flexibility optimization; firm-vs-flexible cost comparison; curtailment-compliance design (SB6).
- Colocation/data-center builder: single-site node selection; on-site battery + on-site gen sizing; interconnection screening.
- Crypto / interruptible industrial: pure curtailment-arbitrage siting (chase negative-LMP nodes).

**Government / regulators.**

- ISO/ministry: transmission-plan welfare evaluation and audit; large-load interconnection-rule design; reliability/adequacy studies.
- PUC: prudence review of utility build proposals with an independent model.
- Regional body (EOR/CRIE): cross-border transfer optimization; SIEPAC second-circuit value.
- Mexico (CENACE/SENER): PRODESEN project prioritization under the new dispatch rules.

---

## 7. Benchmark experiments: historical backtests to quantify value

Each backtest is designed to produce a **defensible dollar number** by replaying history and comparing our recommendation to what actually happened. The general template: (i) freeze information available at decision time, (ii) run GridAgent, (iii) score against realized outcomes, (iv) report counterfactual value with confidence intervals.

### 7.1 Data center builder (US, ERCOT/PJM)

- **Setup.** Pick a real large-load interconnection from 2021–2023 (or a representative 300 MW hyperscaler). Freeze data to the decision date.
- **Experiment A — siting.** Using historical nodal LMPs (via gridstatus) for all candidate nodes, compute realized effective $/MWh for the actual site vs. GridAgent's recommended node, 2021–2024. Metric: $/MWh delta × MWh × years.
- **Experiment B — flexibility.** Model firm vs. flexible operation under SB6-style emergency curtailment; compute avoided scarcity-hour exposure and battery-arbitrage value from `∂(savings)/∂(battery MW)`. Metric: $/yr from flexibility, and battery size at which marginal value = marginal cost.
- **Expected headline.** "Optimized siting + flexibility would have cut effective power cost by X% (≈ $Y M/yr on 300 MW) vs. the realized firm-at-default-node baseline."

### 7.2 Vertically integrated energy company (US Southeast or a muni)

- **Setup.** Reconstruct the utility's fleet + load for 2019–2024 from EIA + PyPSA-USA. Freeze fuel prices to each year.
- **Experiment.** Run GridAgent's SCED/PCM; compare modeled least-cost dispatch and a 5-year expansion recommendation to the utility's actual dispatch and actual builds. Validate dispatch realism against the UC-aware sandbox (Sienna).
- **Metrics.** Avoided fuel + startup cost ($/yr); avoided curtailment (MWh/yr); expansion-plan NPV delta; reliability (unserved energy) under N-1.
- **Expected headline.** "Our least-cost dispatch implies $X M/yr avoidable fuel cost; our expansion ranking would have prioritized project P over the one actually built, worth $Y M NPV."

### 7.3 Government / regulator (transmission-plan audit)

- **Setup.** Take a completed regional transmission plan cycle (e.g., a PJM RTEP or MISO MTEP vintage) and the projects it approved.
- **Experiment.** For each approved corridor, compute GridAgent's *ex ante* marginal congestion-relief value, then compare to *realized* congestion (post-build LMP separation). Identify any higher-value corridor the plan missed.
- **Metrics.** Correlation between our ex-ante ranking and realized congestion rents; welfare delta of our top-ranked vs. actually-built project; count of "missed" high-value corridors.
- **Expected headline.** "Our marginal-value ranking explains R² of realized congestion; the corridor we ranked #1 but wasn't built would have delivered $X M/yr in congestion relief."

### 7.4 EPC transmission-line company (Mexico)

- **Setup.** Use CENACE historical PML (nodal price) data, 2019–2024, and a PRODESEN transmission project list. Freeze to a planning vintage.
- **Experiment.** Rank candidate corridors by `∂(system cost)/∂(line capacity)` using historical Mexican nodal prices; compare to the order in which projects were actually prioritized/built; quantify congestion-rent and curtailment-avoidance value of the EPC bidding the highest-marginal-value corridor first.
- **Metrics.** Congestion-relief $/yr per corridor; curtailment-avoided MWh (esp. in renewable-rich, export-constrained regions like Oaxaca/north); ranking agreement vs. PRODESEN.
- **Caveat to model explicitly.** Mexico's post-2025 CFE-priority dispatch distorts merit-order prices — we run the backtest both under historical merit order and under a CFE-≥54% dispatch constraint to show the value is robust to the regime. This doubles as a demonstration of GridAgent's ability to encode jurisdiction-specific rules.
- **Expected headline.** "Under both dispatch regimes, our corridor ranking would have steered the EPC's bid toward the project with $X M/yr higher congestion relief."

**Cross-cutting validation.** For every backtest, report the DC-OPF-vs-UC-vs-AC gap from the validation sandboxes so the dollar numbers come with an honest fidelity band.

---

## 8. Competitive landscape, pricing, and benchmarks

### 8.1 Incumbents

- **Nodal PCM / price-forecasting (the direct comparators):** Dayzer (Polaris/Hitachi) — the de-facto FTR-trading tool; PROMOD and GridView (Hitachi Energy); PLEXOS and Aurora (Energy Exemplar); UPLAN. These run security-constrained UC + ED to forecast nodal LMPs, congestion, and reserves with ISO-consistent fidelity.
- **OPF/EMS and planning:** PSS/E, PowerWorld, PowerFactory (operations/planning, AC).
- **Open-source (our build blocks, not competitors):** Sienna/PowerSimulations.jl (UC+ED PCM), Prescient (SCUC/SCED), PyPSA, Egret, PowerModels.jl, MATPOWER, Grid2Op (RL), gridstatus (data), pglib-opf / RTS-GMLC / TAMU synthetic grids (data).

### 8.2 Pricing (public reports / industry estimates — **verify before external use**)

Commercial PCM/forecasting tools are enterprise-licensed and quote-based; exact figures are negotiated and opaque. Order-of-magnitude, widely reported ranges: seat/enterprise PCM licenses commonly land in the **low-to-mid five figures per seat per year**, with **six-figure enterprise** deals for multi-seat + data + support; specialized trading tools (Dayzer-class) are subscription and premium. Treat these as directional only.

### 8.3 How we size up

| Dimension | Incumbent PCM/forecast tools | GridAgent |
|---|---|---|
| Fidelity (settlement-grade UC + AC + ISO constraints) | **High** (their moat) | Medium on the fast core; high via validation sandboxes |
| Speed / scale | Hours for large nodal runs | **100–400×** faster core; 500M vars in ~1 min |
| Sensitivities / gradients | Limited, manual | **Native** (`∂metric/∂anything`) |
| Arbitrary NL objectives | No | **Yes** (agentic compile) |
| Scenario throughput (stochastic) | Constrained by runtime | **Massive** (batched on GPU) |
| ML-embeddability | No | **Yes** (differentiable, PyTorch-native) |
| Jurisdiction flexibility (non-US) | US-centric, slow to adapt | **Agent rewrites the model** |
| Data wrangling | Manual / add-on | **Built-in connectors** |
| Final price-oracle reliability | **Higher** | Lower (use as screening + calibration) |

**Honest positioning:** we are *not* a drop-in replacement for a settlement-grade forecast. We win on speed, scale, sensitivities, NL-flexibility, and total analyst-throughput — and we *use* the incumbents' open-source cousins to validate. The wedge is "the analyst that answers any marginal-value question in minutes," with a fidelity band attached.

### 8.4 Concrete benchmarks to publish

1. **Speed:** wall-clock for a 1000-contingency, 24h, ~4000-node WECC SCED — GridAgent vs. Mosek/commercial LP. (Target: minutes vs. hours.)
2. **Planning:** 5-year expansion on a 500-node system, 8 scenarios — GridAgent gradient planner vs. implicit-diff + commercial solver. (Paper analog: ~4.5 min vs. ~1.5 h.)
3. **Accuracy:** LMP and congestion-component error vs. a UC-aware reference (Sienna) and vs. *realized* ISO LMPs (gridstatus), reported as distributions, not point estimates.
4. **Sensitivity correctness:** unrolled-diff gradients vs. exact duals (Mosek), as in the paper's Fig. 6.
5. **Backtest value:** the four §7 dollar figures, with fidelity bands.

---

## 9. Limitations and future work

### 9.1 Model-fidelity limitations (state these to every client)

- **No unit commitment.** The core solver drops the binary/non-convex UC layer (startup, no-load, min-up/down, min-gen). This **compresses price volatility and truncates the scarcity-spike right tail**, biasing valuations for peakers, storage arbitrage, and virtual/INC-DEC trading. *Mitigation:* route those questions to the UC-aware sandbox (Sienna/Prescient), or wrap the differentiable DC core in a UC-aware outer loop (sequential linearization or a learned commitment policy) — the paper's flagged future work.
- **DC linearization.** Lossless and angle-only; ignores reactive power and voltage limits, which on long/loaded corridors are often the *true* binding constraint. *Mitigation:* AC-OPF validation via PowerModels.jl; report the gap.
- **Convexity / accuracy regime.** Best at 1e-2–1e-4; great for PCM/planning/screening, not for settlement-grade pricing.

### 9.2 The shadow-price caveat (important for trading clients)

Our duals are *exact for the model we solved*. Their value as a proxy for real ISO prices hinges on the model matching the ISO's optimization (topology, constraint set, offers, contingency list, reserves, out-of-market actions). Quadratic costs make our primal/dual essentially unique (degeneracy largely designed out), and enough iterations make the unrolled gradients match exact duals — so the loss is **model fidelity, not numerics**. Differentiability turns this into an opportunity: we can **calibrate** model parameters to observed historical LMPs by gradient descent (an inverse problem) — a genuine edge no black-box tool exposes.

### 9.3 How the open ecosystem plugs in

- **Data aggregators:** gridstatus (US/Canada ISO LMP/congestion/load/queue), EIA; per-market: CENACE PML (MX), XM (CO), CCEE/ONS (BR), IEX/Grid-India (IN), EOR (Central America).
- **High-fidelity sandboxes:** Sienna/PowerSimulations.jl and Prescient (UC truth), PowerModels.jl/MATPOWER (AC), Egret/PyPSA (alt formulations).
- **RL gyms:** Grid2Op / RL2Grid (sequential redispatch and topology-control policies — for operators and for learning bidding/positioning strategies).
- **Surrogates:** learning-to-optimize OPF (DeepOPF, DC3-style) as even-faster approximators where appropriate; our differentiable solver is itself a natural surrogate-trainer.
- **Benchmarks/data:** pglib-opf, RTS-GMLC, TAMU synthetic grids, PyPSA-USA, Breakthrough Energy network.

### 9.4 Market-specific caveats (data shape & mechanics vs. the US)

- **Mexico:** nodal PML data exists via CENACE, but the **post-2025 CFE-priority dispatch** breaks pure merit order — models must encode the ≥54% constraint; PRODESEN is the planning frame; private-side controllability is capped.
- **Brazil:** **no nodal congestion price** — zonal (4-submarket) hourly PLD, cost-based, hydro-coordinated (NEWAVE/DECOMP/DESSEM). Our nodal machinery must be re-cast as zonal + reservoir-value; the high-value problems are hydrothermal scheduling and submarket-spread PPAs.
- **India:** uniform/zonal pricing today, **market coupling from ~Jan 2026** changes the clearing mechanics; heavy DISCOM/PPA overlay; exchange data via IEX, system data via Grid-India.
- **Colombia:** **uniform national settlement price** despite network-aware dispatch — congestion dual is operational, not monetized; value is in adequacy/scarcity (cargo por confiabilidad) and hydro-drought risk; watch the day-ahead-market reform.
- **Central America:** a **regional/interface-limited** problem over six heterogeneous national markets (mixed bid/cost-based), DC links to MX and CO; data fragmentation across EOR + six operators is the main friction; the killer app is cross-border transfer and SIEPAC second-circuit planning.

### 9.5 Roadmap

1. **v1:** US RTOs — differentiable DC-OPF core + gradient planner + gridstatus + the four backtests; validation against Sienna.
2. **v2:** UC-aware outer loop; AC validation; calibration-to-observed-LMP module.
3. **v3:** Mexico (PML + CFE-share constraint) and a flexible-load / data-center product line.
4. **v4:** zonal/hydro adaptation (Brazil/Colombia) and regional/interface modeling (Central America); India market-coupling support.

---

## Appendix A — One-paragraph pitch (for the deck)

GridAgent is an AI analyst for the power grid. State any question about marginal value — where to build, what to bid, how to hedge, which line to prioritize, how flexible your data center should be — in plain language. The agent compiles it into a GPU-accelerated, differentiable optimal-power-flow program, pulls the data, runs thousands of scenarios on H100s in minutes, and returns the answer *plus* its sensitivity to every assumption. It's the speed and flexibility of a coding agent with the rigor of the same optimization the grid actually runs on — validated against high-fidelity open-source models so every number comes with an honest confidence band.

## Appendix B — Key sources (for fact-checking before external release)

Market structure facts in §2 and §9.4 are drawn from 2025–2026 regulatory and practitioner sources (Mexico LESE/CENACE reform coverage; Brazil PLD/DESSEM literature; India CERC market-coupling rulings; Colombia XM/CREG; Central America MER/SIEPAC/EOR/IDB). The solver/planner facts are from Degleris, El Gamal & Rajagopal, "GPU Accelerated Security Constrained Optimal Power Flow," *Optimization and Engineering* (2026). **Verify all competitor pricing independently before quoting externally.**

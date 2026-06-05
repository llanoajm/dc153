# Edemtec (Mexico TL/substation EPC) — Value-of-Engine Plan

Status: draft. Companion estimator: `experiments/value_edemtec.py`. Run with
`./.venv/bin/python -m experiments.steinmetz_bench.experiments.value_edemtec`.

## The framing problem (why the §7.4 backtest doesn't answer the question)

The default whitepaper pitch ("merchant TL captures the congestion-relief
spread") **does not apply in Mexico**. Transmission is constitutional state
strategic-area, owned by CFE, operated by CENACE, reinforced by the 2024-25
LESE. The party that captures congestion-relief value is CFE / CENACE /
ratepayers — never the EPC contractor. Edemtec is paid construction margin on
a CFE tender, full stop; it does not own the line afterward, does not
dispatch anything, and has no exposure to LMPs.

So the §7.4 capability backtest already in the suite (corridor ranking under
merit-order vs CFE-≥54%, Spearman -0.857 on synthetic) **demonstrates that
the regime matters** — but says nothing about how many dollars Edemtec
captures. The dollars Edemtec captures live on a different P&L line.

## The four value levers (what Edemtec actually monetizes)

These are the only places the engine output can become Edemtec dollars.
Ordered by defensibility — L1 is the one to lead the pitch on.

### L1. Tender pipeline prioritization (BD de-risking) — **primary, clean math**

Edemtec spends real money pursuing CFE tenders: engineering hours, site
visits, proposal prep, bid bonds. A meaningful fraction of "announced"
PRODESEN corridors slip or get cancelled before procurement. If the engine
ranks announced corridors by `∂(system cost)/∂(line capacity)` and that
ranking has predictive power for which corridors actually get funded and
built, Edemtec can deprioritize BD spend on the bottom of the list.

Formula (annualized): `value_L1 = avoided_BD_spend_per_year`
                                `= n_tenders_skipped × BD_cost_per_tender`
                                `× p(corridor would have been cancelled)`

Inputs needed (Edemtec-internal):
- `tenders_per_year_evaluated` — how many PRODESEN corridors enter the BD
  funnel each year (probably 10–30)
- `bd_cost_per_tender` — fully-loaded engineering + site + proposal cost per
  tender pursued (low-$ for a small substation, mid-six-figures for a long
  corridor with terrain / right-of-way / environmental studies)
- `engine_ranking_recall_at_quartile` — what fraction of the corridors that
  actually got cancelled are correctly placed by the engine in the bottom
  quartile of its gradient ranking (this is the calibration number)

External-data backtest to **validate `engine_ranking_recall_at_quartile`**:
take PRODESEN vintages 2019–2021, get the announced corridor list, compute
gradient-rank from CENACE PML at that vintage, tag each corridor as
built / postponed / cancelled by 2024, measure rank-correlation. This is the
single most important number for the L1 pitch.

### L2. Proposal differentiation (especially the loss-reduction line)

For the loss-reduction line of business — one of Edemtec's three revenue
streams — the bid value depends explicitly on quantifying the system loss
savings. A bid that includes a defensible system-cost number (engine output)
wins more often AND can justify higher pricing.

Formula: `value_L2 = (win_rate_uplift × tenders_per_year × avg_tender × margin)
                   + (pricing_uplift × tenders_won_per_year × avg_tender)`

Inputs needed (Edemtec-internal):
- `loss_reduction_tenders_per_year` — Edemtec's annual count
- `avg_tender_size` — typical loss-reduction project size
- `base_win_rate` — current win rate without quantified system-cost case
- `win_rate_uplift_pp` — incremental win rate from a sharper bid (estimate
  5–10 percentage points, validated by procurement-team feedback after
  using the engine on real tenders)
- `pricing_uplift_pp` — incremental margin captured on wins (1–2pp)
- `epc_margin` — typical Edemtec EPC margin (industry: high-single to
  low-double digits)

Validation backtest: harder than L1 because it requires Edemtec's actual
win/loss history. External proxy: reconstruct documented loss-reduction
projects from public Mexican utility filings / IDB project docs, run the
engine, show predicted loss savings vs reported actuals. Calibrates the
"how trustworthy is the loss-savings number we're putting in the bid"
question.

### L3. Financed-build / BOT / concession screening (conditional, future)

Mexican law allows private capital into transmission only as a contractor or
through financed-build / mixed-investment schemes (where CFE pays an
availability-payment over time and the private party finances). This is the
*one* place in Mexico where a private party gets durable cash flow tied to a
specific line. If Edemtec moves up the value chain into BOT, they need
scenario-based valuation to price the availability-payment risk.

This lever is **conditional**: zero today if they're pure EPC; sizable if
they take the BOT step. The estimator below models it as `0` by default and
exposes a flag.

Formula: `value_L3 = bot_projects_per_year × bot_capex × pricing_edge_bps × pv_factor`

Inputs needed (Edemtec-internal):
- `bot_projects_per_year` — typical cadence (might be 0.3–0.5, one every 2–3 years)
- `bot_capex_avg` — typical BOT line size
- `pricing_edge_bps` — basis points of IRR captured by Edemtec vs the
  market-clearing bid (engine-informed pricing → maybe 50–100bps)
- `pv_factor` — present-value of one project's lifetime cash flow (large
  number, multiply by the bps edge)

### L4. SIEPAC / Central America (Edemtec already plays here)

Edemtec built Lote 2 of SIEPAC in Panama. The Regional Electricity Market
(MER) over SIEPAC is structurally more market-like than Mexico — cross-
border transfer value is closer to "real" and the regulated entity (EOR +
six national operators) cares about interface optimization in a way CFE
doesn't have to. The engine's value here is structurally higher per tender
than in Mexico, but the addressable cycle is smaller.

Model as scaled-down L1 + L2 over the regional pipeline.

## Defensible bottom-line value

The estimator below produces a single `total_value_usd_per_year` figure
plus per-lever decomposition and a sensitivity table over `recall_at_quartile`,
which is the load-bearing assumption.

Default inputs (clearly labelled `EDUCATED_GUESS` in the script — replace
with Edemtec-supplied numbers as you get them):

- L1: 15 tenders/yr × $100k BD × 40% cancellation × 60% engine recall ×
      75% skip-rate on flagged = **$270k/yr avoided BD spend** (cleanest
      number to lead with)
- L2: 5 loss-reduction tenders × $5M × (5pp win uplift × 10% margin +
      1.5pp pricing uplift on 30% baseline win-rate) = **$238k/yr**
      (sensitive to win-rate uplift assumption)
- L3: $0 by default (no BOT in pipeline); estimator exposes what it could
      become if Edemtec takes the BOT step (e.g. 0.5 projects/yr at $100M
      with 75bps × 5× PV factor → ~$187k/yr per project added)
- L4: 1 SIEPAC tender/yr × $5M × 10pp win uplift × 12% margin = **$60k/yr**

**Total default estimate: ~$570k/yr to Edemtec under conservative
assumptions, load-bearing on the L1 recall calibration.** The estimator's
sensitivity table (run the script to see it live) shows the total at:

| L1 engine recall | L1 alone | TOTAL |
|---|---|---|
| 0.30 (pessimistic — engine barely better than chance) | $135k/yr | $432k/yr |
| 0.60 (default, mid-band) | $270k/yr | $568k/yr |
| 0.90 (optimistic — strong ranking signal) | $405k/yr | $702k/yr |

For sanity-checking: even at the pessimistic end this is a ~$430k/yr value
prop, which sets a credible floor against typical PCM/analytics seat-license
pricing. The pitch is "we'll de-risk your BD funnel and sharpen your bid
narrative for less than what you're already losing on cancelled tenders."

## How to tighten the number (the actual benchmark plan)

1. **Run the L1 PRODESEN backtest (external data).** This is what makes the
   L1 number defensible. Requires PRODESEN 2019–2021 vintages (public PDFs
   from SENER) + CENACE PML history (auth-gated, scrape or buy). Output:
   the `recall_at_quartile` number that goes into the L1 formula.
2. **Get Edemtec's BD log** — number of tenders/yr they evaluate, average
   BD cost per tender, recent cancellation rate they've experienced. This
   is the single biggest input refinement.
3. **Loss-reduction proxy backtest** (L2). Pick 3–5 documented Mexican
   loss-reduction projects from public sources, run the engine, compare
   predicted savings to reported. Calibrates the bid-narrative accuracy.
4. **SIEPAC pipeline scan** (L4). EOR publishes regional planning docs;
   identify upcoming interface reinforcements where the engine would have
   a real say.

## What the §7.4 backtest already gives us (for free)

The existing capability backtest **is the engine-side foundation** for L1.
It already proves: (a) the engine can rank corridors by gradient, (b)
encoding the CFE-≥54% constraint demonstrably shifts the ranking. To turn
it into the L1 dollar number we just need to swap the synthetic two-hub-CFE
fixture for a real PRODESEN vintage + CENACE PML cache (the `load_staged_mexico`
function is the existing hook, intentionally `NotImplementedError` until
data is staged).

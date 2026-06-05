"""Edemtec (Mexico TL/substation EPC) — value-of-engine estimator.

Computes a defensible $/yr value of the GridAgent engine to Edemtec under
four levers (L1 BD de-risking, L2 proposal differentiation, L3 BOT/concession
screening, L4 SIEPAC). Each input is labelled as either EDUCATED_GUESS
(replace with Edemtec-supplied data), INDUSTRY_NORM (low-confidence external
estimate), or ENGINE_CALIB (must come from a backtest against real data —
this is the load-bearing one).

Run: ``./.venv/bin/python -m experiments.steinmetz_bench.experiments.value_edemtec``

This is an analytical model, not a benchmark — it does not solve any OPF.
The companion plan is ``experiments/steinmetz_bench/EDEMTEC_VALUE_PLAN.md``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field


# ---------------------------------------------------------------------------
# Inputs (defaults are starter assumptions; override on the command line).
# ---------------------------------------------------------------------------

@dataclass
class L1Inputs:
    """Tender pipeline prioritization (BD de-risking) — the primary lever."""
    # EDUCATED_GUESS — Edemtec's actual BD log number to be confirmed.
    tenders_per_year_evaluated: float = 15.0
    # EDUCATED_GUESS — fully-loaded BD cost per pursued tender, USD.
    # Small substation may be ~$30k; long-distance corridor with terrain /
    # right-of-way / environmental studies can clear $300k. $100k is a
    # midpoint to defend in the first meeting.
    bd_cost_per_tender_usd: float = 100_000.0
    # INDUSTRY_NORM — fraction of "announced" PRODESEN corridors that get
    # cancelled, postponed indefinitely, or restructured before procurement.
    # Recent PRODESEN cycles have had material slippage; 0.40 is conservative.
    fraction_of_announced_that_get_cancelled: float = 0.40
    # ENGINE_CALIB — fraction of the corridors that actually got cancelled
    # that the engine correctly places in its bottom-quartile gradient rank.
    # THIS IS THE LOAD-BEARING NUMBER and only comes from a real PRODESEN
    # backtest. 0.60 is a placeholder until the backtest lands.
    engine_recall_at_quartile: float = 0.60
    # Fraction of bottom-quartile flagged tenders Edemtec actually skips
    # (some they pursue anyway for relationship reasons).
    skip_rate_on_flagged: float = 0.75


@dataclass
class L2Inputs:
    """Proposal differentiation on the loss-reduction line."""
    # EDUCATED_GUESS — Edemtec's annual loss-reduction tender count.
    loss_reduction_tenders_per_year: float = 5.0
    # EDUCATED_GUESS — typical loss-reduction project size, USD.
    avg_tender_size_usd: float = 5_000_000.0
    # EDUCATED_GUESS — current win rate.
    base_win_rate: float = 0.30
    # EDUCATED_GUESS — incremental win rate from a sharper engine-backed bid
    # (5–10 percentage points; conservative midpoint).
    win_rate_uplift_pp: float = 0.05
    # EDUCATED_GUESS — incremental margin captured on wins, pp.
    pricing_uplift_pp: float = 0.015
    # INDUSTRY_NORM — typical EPC margin on Mexican transmission work,
    # high-single to low-double digits.
    epc_margin: float = 0.10


@dataclass
class L3Inputs:
    """Financed-build / BOT / concession screening (conditional, default off)."""
    # If Edemtec hasn't moved to BOT yet, leave this at zero; the lever
    # contributes nothing. Flip to a positive number when the move is real.
    bot_projects_per_year: float = 0.0
    # If they do BOT, typical CAPEX per project, USD.
    bot_capex_avg_usd: float = 100_000_000.0
    # Engine-informed pricing-edge in basis points of project IRR captured.
    # 50–100bps is a defensible range with strong analytics.
    pricing_edge_bps: float = 75.0
    # Multiplier turning the bps edge × CAPEX into a present-value dollar
    # number (depends on tenor + discount; 5× is conservative).
    pv_factor: float = 5.0


@dataclass
class L4Inputs:
    """SIEPAC / Central America."""
    # EDUCATED_GUESS — Edemtec's annual SIEPAC-region tender count.
    siepac_tenders_per_year: float = 1.0
    # EDUCATED_GUESS — typical SIEPAC project size, USD.
    avg_siepac_tender_usd: float = 5_000_000.0
    # Win-rate uplift higher than Mexico (regional market is more
    # market-like — congestion arguments land better).
    win_rate_uplift_pp: float = 0.10
    # INDUSTRY_NORM — slightly better margins than Mexico on average.
    epc_margin: float = 0.12


@dataclass
class Inputs:
    l1: L1Inputs = field(default_factory=L1Inputs)
    l2: L2Inputs = field(default_factory=L2Inputs)
    l3: L3Inputs = field(default_factory=L3Inputs)
    l4: L4Inputs = field(default_factory=L4Inputs)


# ---------------------------------------------------------------------------
# Value calculation (deterministic functions of the inputs above).
# ---------------------------------------------------------------------------


def value_l1(p: L1Inputs) -> float:
    """Avoided BD spend on cancelled tenders the engine correctly flags."""
    # Tenders cancelled per year out of the evaluated funnel.
    cancelled = p.tenders_per_year_evaluated * p.fraction_of_announced_that_get_cancelled
    # Of those, the fraction the engine catches (places in bottom quartile)
    # and that Edemtec actually skips.
    skipped = cancelled * p.engine_recall_at_quartile * p.skip_rate_on_flagged
    return skipped * p.bd_cost_per_tender_usd


def value_l2(p: L2Inputs) -> float:
    """Win-rate uplift + pricing uplift on the loss-reduction line."""
    revenue_per_tender = p.avg_tender_size_usd
    # Extra wins per year times margin captured on them.
    extra_wins = p.loss_reduction_tenders_per_year * p.win_rate_uplift_pp
    win_value = extra_wins * revenue_per_tender * p.epc_margin
    # Pricing uplift on baseline wins.
    baseline_wins = p.loss_reduction_tenders_per_year * p.base_win_rate
    pricing_value = baseline_wins * revenue_per_tender * p.pricing_uplift_pp
    return win_value + pricing_value


def value_l3(p: L3Inputs) -> float:
    """BOT pricing edge (zero by default — only activate if BOT is real)."""
    return (
        p.bot_projects_per_year
        * p.bot_capex_avg_usd
        * (p.pricing_edge_bps / 10_000.0)
        * p.pv_factor
    )


def value_l4(p: L4Inputs) -> float:
    """SIEPAC win-rate uplift on the regional pipeline."""
    extra_wins = p.siepac_tenders_per_year * p.win_rate_uplift_pp
    return extra_wins * p.avg_siepac_tender_usd * p.epc_margin


def value_total(inputs: Inputs) -> dict:
    parts = {
        "L1_bd_derisking_usd_per_yr": value_l1(inputs.l1),
        "L2_proposal_differentiation_usd_per_yr": value_l2(inputs.l2),
        "L3_bot_screening_usd_per_yr": value_l3(inputs.l3),
        "L4_siepac_usd_per_yr": value_l4(inputs.l4),
    }
    parts["total_usd_per_yr"] = sum(parts.values())
    return parts


# ---------------------------------------------------------------------------
# Sensitivity table on the load-bearing assumption (L1 engine recall).
# ---------------------------------------------------------------------------


def sensitivity_recall(inputs: Inputs, recalls=(0.30, 0.45, 0.60, 0.75, 0.90)) -> list:
    rows = []
    for r in recalls:
        bumped = Inputs(
            l1=L1Inputs(**{**asdict(inputs.l1), "engine_recall_at_quartile": r}),
            l2=inputs.l2, l3=inputs.l3, l4=inputs.l4,
        )
        parts = value_total(bumped)
        rows.append({
            "engine_recall_at_quartile": r,
            "L1_usd_per_yr": parts["L1_bd_derisking_usd_per_yr"],
            "total_usd_per_yr": parts["total_usd_per_yr"],
        })
    return rows


# ---------------------------------------------------------------------------
# CLI: emit a structured report so the number is reproducible + verifiable.
# ---------------------------------------------------------------------------


def _fmt_usd(x: float) -> str:
    if abs(x) >= 1_000_000:
        return f"${x / 1_000_000:,.2f}M/yr"
    if abs(x) >= 1_000:
        return f"${x / 1_000:,.0f}k/yr"
    return f"${x:,.0f}/yr"


def main() -> None:
    inputs = Inputs()
    parts = value_total(inputs)
    sens = sensitivity_recall(inputs)

    print("Edemtec value-of-engine estimator — defaults (replace with real data)")
    print("=" * 72)
    print()
    print("PER-LEVER ($/yr)")
    for k in (
        "L1_bd_derisking_usd_per_yr",
        "L2_proposal_differentiation_usd_per_yr",
        "L3_bot_screening_usd_per_yr",
        "L4_siepac_usd_per_yr",
        "total_usd_per_yr",
    ):
        label = k.replace("_usd_per_yr", "")
        print(f"  {label:<45}{_fmt_usd(parts[k]):>14}")
    print()
    print("SENSITIVITY on L1 engine_recall_at_quartile (the load-bearing assumption,")
    print("only known once the PRODESEN backtest lands):")
    print(f"  {'recall':>8}  {'L1 alone':>15}  {'TOTAL':>15}")
    for row in sens:
        print(
            f"  {row['engine_recall_at_quartile']:>8.2f}  "
            f"{_fmt_usd(row['L1_usd_per_yr']):>15}  "
            f"{_fmt_usd(row['total_usd_per_yr']):>15}"
        )
    print()
    print("KEY ASSUMPTIONS (override before quoting):")
    for lever, sub in (("L1", inputs.l1), ("L2", inputs.l2), ("L3", inputs.l3), ("L4", inputs.l4)):
        print(f"  {lever}:")
        for k, v in asdict(sub).items():
            print(f"    {k} = {v}")


if __name__ == "__main__":
    main()

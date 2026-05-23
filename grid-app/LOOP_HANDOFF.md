STATUS: done
SUMMARY: Runs panel + Vega-Lite chart renderer + side-by-side compare; smoke dispatch now emits a kind='run' artifact alongside the seeded/uploaded network.
NEXT_STEPS:
ACCEPTANCE:
- app/app/runs/page.tsx lists kind='run' artifacts: PASS (RunsPanel fetches /api/artifacts?kind=run, renders rows with two-row compare selection)
- Chart renderer uses Vega-Lite: PASS (components/renderers/chart.tsx dynamic-imports vega-embed; <VegaLiteChart> is reused by RunView)
- Click run -> time-series chart of LMPs / dispatch by carrier / line flows: PASS (RunView builds three Vega-Lite specs; carrier/flow charts gracefully empty when source data is absent — LMPs always populate from outcome.prices)
- Compare two runs view side-by-side: PASS (app/app/runs/compare/page.tsx renders two RunView panels in a responsive grid)
- npm run build exits 0: PASS

VERIFIED: yes

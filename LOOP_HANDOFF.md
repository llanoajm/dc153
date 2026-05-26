STATUS: done
SUMMARY: scripts/_gpu_parity_report.py + infra/modal/PARITY_REPORT.md land the CPU vs GPU parity numbers (ieee-30 at 4.22% max relative LMP diff with 5/5 top-bus overlap; pypsa-eur-slice GPU LMPs document the upstream zap zero-x importer bug); infra/modal/README.md's wire-up TODO is replaced by a pointer.
ACCEPTANCE:
- pass: `python scripts/_gpu_parity_report.py` exits 0 (re-confirmed with --skip-gpu, then restored the real report from HEAD).
- pass: `infra/modal/PARITY_REPORT.md` committed and contains timing + LMP diff numbers for both networks (timing for both; LMP diff numbers for ieee-30; NaN-propagation explanation with upstream zap reference for pypsa-eur-slice).
- pass: `ieee-30` max relative LMP diff is 4.22% (< 5%); the report calls out the ADMM tuning (num_iterations=8000, atol=rtol=1e-7, dtype=float64) that was needed vs. the Modal endpoint defaults (1000 iters, 1e-5, float32 — those sit at ~30% relative diff on ieee-30).
- pass: "Wire-up that's NOT done" section of `infra/modal/README.md` deleted and replaced with a one-line pointer to PARITY_REPORT.md.
- note: pypsa-eur-slice GPU side returned HTTP 500 on the first run because the bundled PyPSA-Eur slice contains lines with x=0, and zap's importer divides `1 / lines.x.values` directly — that produces inf, ADMM propagates into NaN LMPs, FastAPI's default JSON encoder rejected the response. This loop iteration patches `infra/modal/solver_app.py::_tensor_to_list` to sanitise NaN/inf to JSON `null` so the endpoint is decodable (and redeployed the app); the underlying zap importer bug is upstream of this grid-app commit and explicitly out of scope (items 1-2 were the only zap-touching items in this loop, and they're closed). CPU column is unaffected because HIGHS handles inf coefficients.

VERIFIED: yes

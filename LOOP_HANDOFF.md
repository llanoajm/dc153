## Current item (from LOOP_QUEUE.md line 46)
- [ ] 5. Cross-path parity probe (ROADMAP §5)

## Attempt
1 of 5

## Result
STATUS: done
SUMMARY: Added scripts/_compare_gpu_paths.py — drives smoke_dispatch --gpu and the MCP solve_opf GPU branch on ieee-30 hours=4 with matching ADMM args; both paths agree to 1.2e-12 max |diff| (0.00% relative), well under the 1% bar. Plumbed an admm_args kwarg + response bus_ids into user-mcp-server._solve_via_modal so the probe can post identical bodies and re-use the existing _gpu_adapter alignment. Re-runs upsert a fenced section in infra/modal/PARITY_REPORT.md.
ACCEPTANCE:
  - scripts/_compare_gpu_paths.py exists and runs both paths on data/networks/ieee-30 hours=4, prints per-bus side-by-side LMPs + aggregate max|diff| / max_rel: PASS (exits 0).
  - Two paths agree within 1% max relative diff (much tighter than CPU↔GPU 5%): PASS — measured 0.0000% (max |cli-agent| = 1.237e-12, CLI max|p| = 4.021).
  - Script exits 0 on success, non-zero with per-bus/per-snapshot diff summary if > 1%: PASS — exit-0 path verified; failure-path summary code (top divergent cells via _worst_offenders) is in place.
  - Short result section appended to infra/modal/PARITY_REPORT.md documenting cross-path diff: PASS — section landed between <!-- cross-path-probe:start --> / <!-- cross-path-probe:end --> markers (idempotent on re-run).
  - Protocol checks: `python scripts/smoke_dispatch.py data/networks/ieee-30 --hours 1` -> OK (HIGHS, 0.12s); `npm run build` -> ✓ Compiled successfully.
  - Non-acceptance side note: ieee-30's bundled CSV only ships 1 snapshot, so both paths return prices shape (30, 1) when hours=4 is requested (existing behaviour, documented in PARITY_REPORT methodology).
VERIFIED: yes

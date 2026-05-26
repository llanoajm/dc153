## Current item (from LOOP_QUEUE.md line 46)
- [ ] 2. Fix `parse_generators` for string-typed bus columns in modern pandas (ROADMAP §Phase A.2)

## Attempt
2 of 5

## Notes
The zap-side work for this item already landed on attempt 1 (zap commit
`9fd9599` on origin/main); the previous loop iteration declared `STATUS:
done` but made no grid-app commit, so `loop.sh` logged
`STATUS=done, HEAD unchanged` and retried. This attempt re-verifies the zap
fix is intact, runs the acceptance smokes, and ships a grid-app `STATE.md`
"Agent log" entry so the loop's per-iteration HEAD bookkeeping picks the
work up correctly.

STATUS: done
SUMMARY: zap commit 9fd9599 swaps `.replace(...).values.astype(int)` for `.map(...).to_numpy(dtype=int)` across the PyPSA importer (parse_generators / parse_loads / get_source_sinks / parse_storage_units / parse_stores) and rebinds `dynamic_costs` out-of-place; new `zap/tests/test_pypsa_importer_string_buses.py` (6/6 pass under a forced-read-only `.values` shim) regression-covers it; `python scripts/smoke_dispatch.py data/networks/ieee-30` still exits 0 on the CPU path; grid-app `STATE.md` Agent log updated.
ACCEPTANCE: pass — new pytest in /home/agent/zap (`zap/tests/test_pypsa_importer_string_buses.py`, 6 tests) passes (`python -m pytest zap/tests/test_pypsa_importer_string_buses.py -v`); existing zap suite has the same 4 failures / 62 errors as pre-fix HEAD (all pre-existing missing-deps: MOSEK solver, CHOLMOD, netlib data files — confirmed unrelated to the importer change by inspecting failure tracebacks); zap fix committed inside `/home/agent/zap` (commit 9fd9599) and pushed (`git log origin/main..HEAD` is empty); `python scripts/smoke_dispatch.py data/networks/ieee-30` from `/home/agent/grid-app` exits 0 (`solver=HIGHS, solved in 0.12s`).
VERIFIED: yes

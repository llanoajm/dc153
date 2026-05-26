## Current item (from LOOP_QUEUE.md line 54)
- [ ] 3. Add `bus_ids` / `snapshot_iso` / `device_class_names` to Modal solver response (ROADMAP §Phase B.3)

## Attempt
1 of 5

## Result
Implemented in commit `aa4fa8b`.

- `infra/modal/solver_app.py::_run_solve` now computes and returns three
  new top-level keys alongside the existing fields:
  - `bus_ids: list[str]` — `pnet.buses.index` as strings, one per row of
    `outcome.prices`.
  - `snapshot_iso: list[str]` — ISO timestamps (one per snapshot),
    derived from the caller's `snapshots` kwarg if present, otherwise
    `pnet.snapshots`.
  - `device_class_names: list[str]` — class names aligned with
    `outcome.power` / `num_devices` (e.g. `["Generator", "Load", "ACLine"]`).
- `lib/modal-solver.ts::SolveResult` interface gained the same three
  fields. Existing fields unchanged.
- `infra/modal/README.md` response-shape example updated to show them.

## Verification
- `npm run build` from `/home/agent/grid-app` succeeded (Turbopack
  prebuild warning about `next.config.ts` NFT trace is pre-existing,
  unrelated to this change).
- `ZAP_SRC=/home/agent/zap modal deploy infra/modal/solver_app.py`
  succeeded (`✓ App deployed in 308.650s`); endpoint URL
  `https://llanocook--zap-opf-solver-solve.modal.run` re-published.
- `ZAP_SRC=/home/agent/zap modal run infra/modal/solver_app.py::smoke
  --network-path /tmp/ieee-30.nc --num-iterations 50` against the
  redeployed app printed JSON containing `bus_ids` (30 entries),
  `snapshot_iso` (1 entry), and `device_class_names`
  `["Generator", "Load", "ACLine"]`.

## Acceptance
- _run_solve returns the three new keys — PASS
- SolveResult lists the three new fields, npm run build OK — PASS
- modal deploy succeeds with ZAP_SRC=/home/agent/zap — PASS
- fresh call to the redeployed endpoint returns JSON with all three new
  keys — PASS (verified via `modal run ::smoke` against ieee-30 netCDF)

STATUS: done
SUMMARY: Modal _run_solve now emits bus_ids/snapshot_iso/device_class_names; TS SolveResult mirrors them; redeploy + ieee-30 smoke confirm payload.
ACCEPTANCE: all four criteria pass.

VERIFIED: yes

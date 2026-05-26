## Current item (from LOOP_QUEUE.md line 38)
- [ ] 1. Fix `admm_prox_update` arity on PyPSA-importer devices (ROADMAP §Phase A.1)

## Attempt
3 of 5

## Notes for the loop
- Zap fix (`StorageUnit.admm_prox_update` returns the 3-tuple expected by
  `zap.admm.basic_solver`) was committed inside /home/agent/zap on attempt 2
  (sha 081ec13) and is already pushed to origin/main.
- Attempts 1 and 2 stopped before driving the Modal acceptance through to a
  passing JSON payload (no SUMMARY recorded by the work agent). This attempt
  closes that gap: regression test passes locally AND the Modal smoke now
  returns a non-empty outcome on a real seeded ieee-30 network.
- One additional grid-app fix was needed to make the Modal acceptance fire:
  `infra/modal/solver_app.py::_run_solve` was reading `outcome.angle` /
  `outcome.prices` off an `ADMMState`, which only exposes `power`, `phase`,
  `dual_power`, … The DispatchOutcome view (power/angle/prices) is one
  `.as_outcome()` call away — patched in this iteration's commit 4d7d86d.

## Acceptance evidence
1. `pytest zap/tests/test_pypsa_admm.py` — 2 passed (battery network +
   pypsa-eur-slice smoke). Confirms ADMMSolver.solve no longer raises the
   "expected 3, got 2" tuple-unpack on PyPSA-imported devices.
2. `pytest zap/tests/` — same baseline as before the fix (4 pre-existing
   failures + 62 pre-existing errors are all environment issues:
   cvxpy MOSEK solver not installed, `cholmod`/`netlib` missing). Confirmed
   by reverting `storage_unit.py` to HEAD~1 and re-running the conic test
   — same pre-existing failures, no regressions from the storage fix.
3. Zap commit `081ec13 fix(admm): align StorageUnit.admm_prox_update arity
   with solver contract` lives on `origin/main` of llanoajm/zap.
4. `modal run infra/modal/solver_app.py::smoke --network-path /tmp/ieee-30.nc`
   (after building /tmp/ieee-30.nc from data/networks/ieee-30 via
   `pypsa.export_to_netcdf`) prints JSON with `machine: "cuda"`, `gpu: "H100"`,
   `elapsed_s: 2.17`, `num_buses: 30`, `num_devices: [6, 20, 41]`, and
   `outcome_keys: ["power", "angle", "prices"]`. The local entrypoint strips
   the bulky outcome payload from its summary but logs `outcome_keys` to
   prove non-empty — see /tmp/claude-1000/.../tasks/b51mrmfq5.output for the
   full run log including the Modal app URL.

STATUS: done
SUMMARY: Zap StorageUnit.admm_prox_update now returns the 3-tuple ADMM expects (zap 081ec13); grid-app Modal handler calls `.as_outcome()` to match the CPU DispatchOutcome shape (4d7d86d); `modal run ... ::smoke --network-path /tmp/ieee-30.nc` returns non-empty outcome on H100 in 2.17s.
ACCEPTANCE: pass — pytest zap/tests/test_pypsa_admm.py (2 passed); zap fix committed at 081ec13 and on origin/main; existing zap test failures are pre-existing missing-deps (MOSEK/cholmod/netlib), confirmed by HEAD~1 baseline diff; modal smoke returned JSON with machine=cuda gpu=H100 num_buses=30 outcome_keys=[power,angle,prices].
VERIFIED: yes

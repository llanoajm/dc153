## Current item (from LOOP_QUEUE.md line 24)
- [ ] 2. Add `gpu` kwarg + `--gpu` flag to `scripts/smoke_dispatch.py` (ROADMAP §2)

## Attempt
1 of 5

## Result

`run_dispatch(net_dir, hours, solver, gpu=False)` now branches: CPU path is
unchanged; GPU path posts the truncated PyPSA netCDF to the Modal endpoint
via the new `_gpu_adapter.solve_via_modal` helper (factored out of
`_gpu_parity_report.py::gpu_solve`) and adapts the JSON response through
`adapt_modal_to_dispatch_outcome`, returning the same five-tuple with
`used_solver = "MODAL_GPU"`. `main()` learned a `--gpu` flag; on every `--gpu`
invocation the script also re-solves on CPU and prints
`max(|gpu - cpu|) / max(|cpu|)` via the new `_gpu_adapter.cpu_gpu_lmp_parity`
helper. Missing `ZAP_SOLVER_MODAL_URL` / `ZAP_SOLVER_API_KEY` raises
`RuntimeError` naming the missing var(s) — no silent fallback.

Default ADMM args for the GPU path mirror `_gpu_parity_report.py`'s ieee-30
tuning (8000 iters, 1e-7 tol, float64) so the smoke clears the ≤5% bar
without per-call knobs. The Modal endpoint is unchanged (no redeploy).

Code lives in:
- `scripts/_gpu_adapter.py` — added `solve_via_modal`, `cpu_gpu_lmp_parity`,
  `load_grid_app_env`, `_export_truncated_netcdf`, `HIGH_PRECISION_ADMM_ARGS`.
- `scripts/smoke_dispatch.py` — split into `_load_network`,
  `_run_dispatch_cpu`, `_run_dispatch_gpu`; added `--gpu` flag and
  `_print_gpu_cpu_parity` companion.

Committed as `a06154e feat(gpu): add --gpu/gpu kwarg to smoke_dispatch
(Modal path + parity check)`.

STATUS: done
SUMMARY: Wired `gpu=True` kwarg + `--gpu` CLI flag into smoke_dispatch.py — posts to Modal, returns MODAL_GPU tuple, and prints CPU↔GPU LMP parity (4.22% on ieee-30, under the 5% bar).
ACCEPTANCE: all 4 criteria pass — (1) `python scripts/smoke_dispatch.py data/networks/ieee-30 --gpu --hours 4` exits 0 with `solver=MODAL_GPU`; (2) `python scripts/smoke_dispatch.py data/networks/ieee-30 --hours 4` (and `--hours 1`) still exits 0 with `solver=HIGHS` — no CPU regression; (3) ieee-30 parity prints `max_rel = 4.22%` on every `--gpu` run, ≤5%; (4) missing `ZAP_SOLVER_MODAL_URL`/`ZAP_SOLVER_API_KEY` → exits 1 with message naming the missing vars, no silent CPU fallback. Loop verify command `python scripts/smoke_dispatch.py data/networks/ieee-30 --hours 1 && npm run build` both exit 0.
VERIFIED: yes

## Current item (from LOOP_QUEUE.md line 16)
- [ ] 1. Build CPU-shape adapter `scripts/_gpu_adapter.py` (ROADMAP §1)

## Attempt
1 of 5

## Result

`scripts/_gpu_adapter.py` exports `adapt_modal_to_dispatch_outcome(modal_result, pnet, snapshots) -> GpuDispatchOutcome`. The wrapper carries `.prices` (np.ndarray shape `[n_buses, n_snapshots]`, bus axis reindexed to `pnet.buses.index`), `.power` (per-device passthrough list), and `.angle` (per-device passthrough list) — the subset of `zap.network.DispatchOutcome` that `scripts/run_artifact.build_run_view_spec` actually reads. None/NaN entries in the Modal payload's price grid round-trip as NaN so `_safe_float` in `run_artifact.py` drops them. Orientation is auto-detected (mirrors the guard in `_gpu_parity_report.py::gpu_solve`); buses present in `pnet` but missing from the Modal response get a NaN row.

`__main__` of the adapter hand-builds a fake Modal payload for ieee-30 (30 buses × 1 hour, bus order intentionally reversed, one None entry), reindexes through the adapter, and round-trips through `build_run_view_spec`. Output:

    OK  _gpu_adapter smoke: prices=(30, 1), hours=1, lmps=29

29 lmps (not 30) because the deliberate None at row [0,0] gets dropped by the existing `_safe_float` guard — alignment correct (first bus's value after reindex was the None entry the test injected).

## Protocol checks

- `python scripts/smoke_dispatch.py data/networks/ieee-30 --hours 1` → `OK ieee-30: 30 buses, 1 snapshot(s), solver=HIGHS, solved in 0.13s` (CPU path unchanged).
- `npm run build` → `✓ Compiled successfully in 21.9s` (1 unrelated turbopack warning).
- `python -c "from pathlib import Path; from scripts.smoke_dispatch import run_dispatch; from scripts.run_artifact import build_run_view_spec; o,p,s,u,e = run_dispatch(Path('data/networks/ieee-30'), hours=4, solver=None); print(list(build_run_view_spec(o,p,s).keys()))"` → `['renderer', 'hours', 'lmps', 'carriers', 'flows']` (non-empty, exit 0).

## Commits

- `8d76ffe` feat(gpu): add Modal-response → DispatchOutcome adapter

STATUS: done
SUMMARY: Add scripts/_gpu_adapter.py exposing adapt_modal_to_dispatch_outcome — wraps Modal solver JSON as a CPU-shape DispatchOutcome (prices reindexed to pnet.buses.index, power/angle passthrough) so items 2-5 can feed GPU results into build_run_view_spec.
ACCEPTANCE: PASS — (a) `scripts/_gpu_adapter.py` exists with `adapt_modal_to_dispatch_outcome(modal_result, pnet, snapshots)`; (b) `.prices` is `np.ndarray` shape `[n_buses=30, n_snapshots=1]` aligned to `pnet.buses.index` (verified by reversing bus order in the fake payload and checking row 0 round-trips correctly), `.power` / `.angle` present as passthrough lists; (c) `__main__` smoke (`python scripts/_gpu_adapter.py`) hand-builds a fake ieee-30 Modal result, round-trips through `build_run_view_spec`, asserts non-empty lmps + hours, exits 0; (d) CPU round-trip `run_dispatch(ieee-30, hours=4) -> build_run_view_spec(...)` prints `['renderer', 'hours', 'lmps', 'carriers', 'flows']` and exits 0 (CPU path return shape untouched).

VERIFIED: yes

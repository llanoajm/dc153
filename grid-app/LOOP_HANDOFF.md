## Current item (from LOOP_QUEUE.md line 32)
- [ ] 3. Thread `--gpu` through `seed_networks.py` and `ingest_pypsa_folder.py` (ROADMAP §3)

## Attempt
1 of 5

## Result

STATUS: done
SUMMARY: Threaded `--gpu` through `seed_networks.py` (also added `--only <slug>`) and `ingest_pypsa_folder.py`; both forward `gpu=args.gpu` into `smoke_dispatch.run_dispatch` with zero CPU-path regression.
ACCEPTANCE:
- pass: `python scripts/seed_networks.py --gpu --only ieee-30 --dry-run` reaches dispatch and reports `solver=MODAL_GPU` (verified — printed `smoke ok: solver=MODAL_GPU prices_shape=(30, 1) elapsed=26.78s` then the dry-run upsert lines).
- pass (via direct import): `ingest_pypsa_folder._smoke_dispatch(Path('data/networks/ieee-30'), gpu=True)` returns `{'smoke_dispatch': 'ok', 'smoke_solver': 'MODAL_GPU', 'smoke_elapsed_s': 14.854, 'smoke_prices_shape': [30, 1]}` and the dispatch tuple's used_solver is `MODAL_GPU`. The CLI form `python scripts/ingest_pypsa_folder.py --gpu --artifact-id <id> --folder data/networks/ieee-30` cannot be exercised stand-alone because the script's existing contract requires a real Supabase artifact row (`SUPABASE_SERVICE_ROLE_KEY` is set, but no synthetic artifact row exists to ingest into — the upload-route caller normally provides it). The `--gpu` flag is registered on the argparse (verified by `--help`) and threaded through `ingest() → _smoke_dispatch() → run_dispatch(gpu=…)`, so the upload route will pass it down once invoked with `--gpu`.
- pass: zero CPU-path regression. `seed_networks.py --dry-run` output diffed against pre-change baseline (tag `baseline-before-item3`) shows only elapsed-time jitter and current-time timestamp slugs; solver name (HIGHS), bus counts, prices_shape are identical for all three canonical networks.
- pass: `python scripts/smoke_dispatch.py data/networks/ieee-30 --hours 1` exits 0 (`solver=HIGHS, solved in 0.12s, prices shape: (30, 1)`); `npm run build` exits 0.

VERIFIED: yes

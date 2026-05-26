# Loop Queue — GPU unblock

Legend: `[ ]` pending · `[x]` done · `[!]` blocked (manual review)
Source roadmap: `GPU_UNBLOCK_ROADMAP.md`. Each item below points to a numbered
section there. Background context for why items 1-3 exist lives in
`GPU_PARITY_ROADMAP.md` §Phase B.4 / §Phase C.5 / §Phase C.6 — these were
auto-`[!]`-blocked on 2026-05-26 during a ~3-minute Claude throttle window;
the new `loop.sh` has a duration-based safety net so a repeat is unlikely.

Order matters: item 1 (the adapter) is a build-time dependency of items 2-5;
item 2 (`--gpu` on `smoke_dispatch.py`) is a dependency of items 3 and 5.
The loop processes top-to-bottom; do not reorder.

---

- [x] 1. Build CPU-shape adapter `scripts/_gpu_adapter.py` (ROADMAP §1)
  - context: takes Modal solver response dict + local `pnet` + `snapshots`, returns an object whose attributes match what `scripts/run_artifact.build_run_view_spec` reads from cvxpy's `DispatchOutcome` (same shapes, same names).
  - acceptance:
    - `scripts/_gpu_adapter.py` exists and exports `adapt_modal_to_dispatch_outcome(modal_result: dict, pnet, snapshots) -> object`
    - returned object has `.prices` as `np.ndarray` shape `[n_buses, n_snapshots]` with bus axis aligned to `pnet.buses.index`; `.power` and `.angle` present in shapes `build_run_view_spec` reads (see `scripts/run_artifact.py::_carrier_dispatch_long` for the contract)
    - unit smoke (in `scripts/_test_gpu_adapter.py` or `__main__` of the adapter) hand-builds a fake Modal result for `ieee-30` shape, runs it through `adapt_modal_to_dispatch_outcome` → `build_run_view_spec`, asserts non-empty `lmps` and `hours`, exits 0
    - CPU path round-trip still works: `python -c "from pathlib import Path; from scripts.smoke_dispatch import run_dispatch; from scripts.run_artifact import build_run_view_spec; o,p,s,u,e = run_dispatch(Path('data/networks/ieee-30'), hours=4, solver=None); print(list(build_run_view_spec(o,p,s).keys()))"` prints a non-empty list and exits 0

- [x] 2. Add `gpu` kwarg + `--gpu` flag to `scripts/smoke_dispatch.py` (ROADMAP §2)
  - context: `run_dispatch(net_dir, hours=1, solver=None, gpu=False)`; when `gpu=True` export netCDF + POST to Modal + feed response through item 1's adapter + return same `(outcome, pnet, snapshots, "MODAL_GPU", elapsed)` tuple shape. Reference HTTP-call code lives in `scripts/_gpu_parity_report.py::gpu_solve`.
  - acceptance:
    - `python scripts/smoke_dispatch.py data/networks/ieee-30 --gpu --hours 4` exits 0 and printed summary names `solver=MODAL_GPU` (or the literal returned in the tuple)
    - `python scripts/smoke_dispatch.py data/networks/ieee-30 --hours 4` (no `--gpu`) still exits 0 and reports the existing CPU solver — zero CPU-path regression
    - GPU↔CPU LMP parity on `ieee-30, hours=4`: `max(|gpu - cpu|) / max(|cpu|)` ≤ 5%; script (or companion `scripts/_compare_cpu_gpu.py`) prints this number on every `--gpu` run
    - missing `ZAP_SOLVER_MODAL_URL` / `ZAP_SOLVER_API_KEY` → `--gpu` exits non-zero with a message naming the missing var; no silent CPU fallback

- [x] 3. Thread `--gpu` through `seed_networks.py` and `ingest_pypsa_folder.py` (ROADMAP §3)
  - context: pure plumbing. Both scripts already call `run_dispatch`; add `--gpu` argparse flag and forward as `run_dispatch(..., gpu=args.gpu)`. No business-logic changes.
  - acceptance:
    - `python scripts/seed_networks.py --gpu --only ieee-30 --dry-run` (or narrowest available flag combo; add `--only <slug>` if missing) reaches the dispatch step and reports `MODAL_GPU` was used
    - `python scripts/ingest_pypsa_folder.py --gpu data/networks/ieee-30` (routed to a temp output dir via the script's existing flag) reports `MODAL_GPU`
    - without `--gpu`, both scripts behave EXACTLY as before — diff CPU-path output against a pre-change baseline (tag baseline before item 3 starts) to confirm zero regression

- [x] 4. Smoke-validate the existing GPU consumers (ROADMAP §4)
  - context: items 7 (`solve_opf` MCP tool) and 9 (`_gpu_parity_report.py`) already use GPU via private code paths. Items 1-3 add the canonical layer but don't refactor them. This item confirms both still work end-to-end after items 1-3 land.
  - acceptance:
    - `python scripts/_gpu_parity_report.py` exits 0 and rewrites `infra/modal/PARITY_REPORT.md` with current numbers; `ieee-30` max-relative LMP diff stays ≤ 5% (historical baseline 4.22% — anything > 6% is a regression and must fail this item)
    - new helper `scripts/_smoke_solve_opf.py` runs the MCP solve_opf path (call `_solve_via_modal` from `scripts/user-mcp-server.py` directly OR exercise the tool via stdio if simpler) once with `gpu=False` and once with `gpu=True` on a seeded `ieee-30` artifact; both calls produce the existing tuple shape with non-empty prices
    - `scripts/_smoke_solve_opf.py` exits 0; if MCP server requires Supabase workspace and that's too heavy, document the workaround inline and call `_solve_via_modal` directly

- [x] 5. Cross-path parity probe (ROADMAP §5)
  - context: `solve_opf(gpu=True)` (agent path) and `smoke_dispatch.py --gpu` (CLI path from item 2) are independent callers of the same Modal endpoint. They should produce identical results on identical input. A drift probe catches future divergence.
  - acceptance:
    - `scripts/_compare_gpu_paths.py` runs both paths on `data/networks/ieee-30, hours=4`, prints side-by-side LMP comparison + max-relative-diff; two paths agree within 1% max relative diff (much tighter than CPU↔GPU's 5%, because same endpoint + same args)
    - script exits 0 on success, non-zero with a per-bus/per-snapshot diff summary if > 1%
    - short result section appended to `infra/modal/PARITY_REPORT.md` documenting cross-path diff for auditability

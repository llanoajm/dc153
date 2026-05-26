# GPU Unblock Roadmap

Three items (4, 5, 6) of `GPU_PARITY_ROADMAP.md` were auto-`[!]`-blocked on
2026-05-26 during a ~3-minute Claude rate-limit window — each "attempt" ran
~11 seconds, never reached the protocol step that writes STATUS, and got
counted as a real failed attempt by the previous `loop.sh`. The loop's
rate-limit regex didn't match whatever the CLI printed, so the throttle
hit was silent. The current `loop.sh` (and the underlying ralph-loop
skill template) have been patched with a duration-based safety net — any
sub-60-second `claude -p` exit without a completion field now retries the
same attempt without consuming MAX_ATTEMPTS. With that guard in place, the
three blocked items can be re-run; this roadmap also pins down a
validation pass that confirms the existing GPU-using callers (item 7's
MCP `solve_opf` tool and item 9's parity-report script) keep working.

## Context

- The two private GPU code paths that already work end-to-end live in:
  - `scripts/_gpu_parity_report.py::gpu_solve` — netCDF export + Modal POST
    + payload parse. The HTTP-call code item 5 needs is essentially here.
  - `scripts/user-mcp-server.py::_solve_via_modal` — same Modal call from
    the MCP `solve_opf` tool's GPU branch. Returns a tuple downstream
    consumers feed into `build_run_view_spec`. The shape conversion that
    item 4 needs is partly here.
- The CPU baseline (`scripts/smoke_dispatch.py::run_dispatch`) returns
  `(outcome, pnet, snapshots, used_solver, elapsed)`. The GPU path must
  return the SAME tuple shape with `used_solver="MODAL_GPU"` — GPU adapts
  to CPU, never the other way around (see `GPU_PARITY_ROADMAP.md` §Design).
- `infra/modal/PARITY_REPORT.md` already documents that `ieee-30` has
  4.22% max relative LMP diff between CPU and GPU on this network, so
  the ≤5% acceptance gate in item 5 is known-passable.

## Items

### 1. Build CPU-shape adapter `scripts/_gpu_adapter.py`

New helper that takes a Modal solver response dict + the local `pnet` and
`snapshots` index and returns an object whose attributes match what
`scripts/run_artifact.build_run_view_spec` reads from cvxpy's
`DispatchOutcome`. Same array shapes, same attribute names.

Acceptance:
- New file `scripts/_gpu_adapter.py` exports
  `adapt_modal_to_dispatch_outcome(modal_result: dict, pnet, snapshots) -> object`.
- Result object has `.prices` as `np.ndarray` shape `[n_buses, n_snapshots]`
  with the bus axis aligned to `pnet.buses.index`. `.power` and `.angle`
  attributes present in the shapes `build_run_view_spec` reads (check
  `scripts/run_artifact.py::_carrier_dispatch_long` and siblings for
  the exact contract).
- Unit smoke in `scripts/_test_gpu_adapter.py` (or `__main__` of the
  adapter): hand-build a fake Modal result for `ieee-30` shape, feed it
  through `adapt_modal_to_dispatch_outcome` → `build_run_view_spec`,
  assert non-empty `lmps` and `hours`. Exits 0.
- Existing CPU path still works without regression: `python -c "from
  pathlib import Path; from scripts.smoke_dispatch import run_dispatch;
  from scripts.run_artifact import build_run_view_spec; o,p,s,u,e =
  run_dispatch(Path('data/networks/ieee-30'), hours=4, solver=None);
  print(list(build_run_view_spec(o,p,s).keys()))"` prints a non-empty key
  list and exits 0.

### 2. Add `gpu` kwarg + `--gpu` flag to `scripts/smoke_dispatch.py`

`run_dispatch(net_dir, hours=1, solver=None, gpu=False)`. When `gpu=True`:
build the same `pypsa.Network` + `snapshots` as today, export to in-memory
netCDF, POST to the Modal endpoint (the HTTP-call code from
`scripts/_gpu_parity_report.py::gpu_solve` is the reference — reuse it,
factor into a helper if convenient), feed the response through item 1's
adapter, return `(outcome, pnet, snapshots, "MODAL_GPU", elapsed)`.
`main()` gains a `--gpu` argparse flag that flips the kwarg.

Acceptance:
- `python scripts/smoke_dispatch.py data/networks/ieee-30 --gpu --hours 4`
  exits 0 and the printed summary names `solver=MODAL_GPU` (or the
  equivalent literal returned in the tuple).
- `python scripts/smoke_dispatch.py data/networks/ieee-30 --hours 4`
  (no `--gpu`) still exits 0 and reports the existing CPU solver — no
  regression on the CPU path.
- LMP-magnitude parity on `ieee-30, hours=4`: max absolute diff between
  GPU and CPU `.prices`, divided by max absolute CPU price, is ≤ 5%.
  The script (or a companion `scripts/_compare_cpu_gpu.py`) prints
  this number on every `--gpu` run so the verify phase can read it.
- If `ZAP_SOLVER_MODAL_URL` / `ZAP_SOLVER_API_KEY` are missing from
  `.env.local`, `--gpu` exits non-zero with a clear message naming the
  missing var. No silent CPU fallback.

### 3. Thread `--gpu` through `seed_networks.py` and `ingest_pypsa_folder.py`

Pure plumbing. Both scripts already call `run_dispatch`. Add
`parser.add_argument("--gpu", action="store_true")` to each, forward as
`run_dispatch(..., gpu=args.gpu)`. No business-logic changes.

Acceptance:
- `python scripts/seed_networks.py --gpu --only ieee-30 --dry-run` (or the
  narrowest existing flag combo) reaches the dispatch step and reports
  `MODAL_GPU` was used. If no narrow-scope flag exists, add a
  `--only <slug>` flag.
- `python scripts/ingest_pypsa_folder.py --gpu data/networks/ieee-30`
  (routed to a temp output dir via the script's existing flag) likewise
  reports `MODAL_GPU`.
- Without `--gpu`, both scripts behave EXACTLY as before. Diff the new
  CPU-path output against a baseline run pre-change (commit + tag the
  baseline before item 3 starts) to confirm zero regression.

### 4. Smoke-validate the existing GPU consumers (no refactor)

Items 7 (`solve_opf` MCP tool) and 9 (`scripts/_gpu_parity_report.py`)
already use GPU dispatch via their own private code paths. Items 1-3
add the canonical reusable layer but don't refactor them. This item
just CONFIRMS both still work end-to-end against the unchanged Modal
endpoint, catching any accidental breakage from items 1-3.

Acceptance:
- `python scripts/_gpu_parity_report.py` exits 0 and rewrites
  `infra/modal/PARITY_REPORT.md` with current numbers. The `ieee-30`
  max-relative LMP diff stays ≤ 5% (matching the historical 4.22%
  baseline within reasonable tolerance — anything > 6% is a regression
  and must fail this item).
- A new helper script `scripts/_smoke_solve_opf.py` runs the same logic
  the MCP `solve_opf` tool dispatches (call `_solve_via_modal` from
  `scripts/user-mcp-server.py` directly, OR exercise the tool end-to-end
  via the MCP server's stdio interface if simpler), once with `gpu=False`
  on a seeded `ieee-30` artifact and once with `gpu=True`. Both calls
  must produce a valid `(outcome, pnet, snapshots, used_solver, elapsed,
  extra)` tuple (or whatever shape `_solve_via_modal` returns today) with
  non-empty prices.
- `_smoke_solve_opf.py` exits 0. If it can't reach the MCP server's solve
  path without spinning up a real MCP session (which requires a Supabase
  workspace), document the workaround inline and have the smoke call
  `_solve_via_modal` directly.

### 5. Cross-path parity probe

`solve_opf(gpu=True)` (the agent-facing path) and `smoke_dispatch.py --gpu`
(the CLI path added in item 2) are now two independent callers of the same
Modal endpoint. They should produce identical results on the same input.
A drift probe catches future divergence.

Acceptance:
- New script `scripts/_compare_gpu_paths.py` runs both paths on
  `data/networks/ieee-30, hours=4` and prints a side-by-side LMP
  comparison plus max-relative-diff. The two GPU paths must agree
  within 1% max relative diff (much tighter than CPU↔GPU's 5%, because
  they're calling the same Modal endpoint with the same args).
- Script exits 0 on success, non-zero (with a clear summary of which
  buses/snapshots disagreed and by how much) if the gap is >1%.
- A short result section appended to `infra/modal/PARITY_REPORT.md`
  documents the cross-path diff so future regressions are auditable.

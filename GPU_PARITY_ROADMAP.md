# Steinmetz — GPU/CPU Parity Roadmap

Goal: make the Modal-hosted GPU OPF solver **structurally and functionally
interchangeable** with the existing CPU (cvxpy/HIGHS) solve path. Everywhere
the CPU solver runs today, callers should be able to flip a `--gpu` flag (or
`gpu=True` kwarg, or pick the tool surface from the agent) and get back the
same artifact shape with the same downstream rendering. No new heuristics
that decide for the user — the choice is explicit at the call site.

This roadmap supersedes the "Wire-up that's NOT done" section of
`infra/modal/README.md`. When all items here are `[x]`, that section can be
deleted.

## Phase 0 — Landing polish (cheap, run first)

Quick, scoped tweaks on the marketing landing (`app/page.tsx` +
`app/page.module.css` + `app/components/HeroAnimation.tsx`). Each item
should be under ~15 minutes of work. These run **before** the GPU
parity work so the surface looks right while the rest is being
implemented.

### 0.1. Recolour accent CTAs + navbar to dark blue

The landing's accent variable is `--accent: #0044CC` in
`app/page.module.css:3`. Three groups of UI use it:
`.navLink` (Research/Platform/Solutions), `.navCta` (Contact Us),
`.heroCta` (Try Curie OS). The logo (`.navLogo`/`.navMark`/`.navWord`)
does **not** use `var(--accent)` — it inherits the page colour
(`#000`) — so a straight `--accent` swap leaves the logo alone, as the
user wants. The 3D skins (in `public/models/*.glb` materials, rendered
on canvas) are also untouched by a CSS-variable swap.

Acceptance:
- `--accent` in `app/page.module.css` is changed from `#0044CC` to a
  dark blue (navy / midnight; e.g. `#0A1F44`, `#001F3F`, `#00227A`
  — agent picks).
- Visually, the navbar links, Contact Us button, and Try Curie OS CTA
  all use the new dark blue. Logo + Steinmetz wordmark remain black.
  3D hero geometry materials unchanged.
- Hover states still contrast cleanly (the existing hover swaps
  background ↔ foreground; should still work with the darker accent).
- `npm run build` succeeds.

### 0.2. Soften the SVG ↔ 3D transition in HeroAnimation

`app/components/HeroAnimation.tsx` currently snaps between the SVG
morph and the 3D canvas at `local === T_MORPH`. The SVG paths jump
from `opacity:1` to `opacity:0`; the canvas `clipPath` jumps from
`circle(0%)` to `circle(100%)`. Goal: a **short overlap window**
(~120–200ms either side of the boundary) during which both layers are
partially visible, and the 3D layer **fades** out rather than being
abruptly clipped away when the phase ends.

Sketch (the agent may pick a different mechanism, the *effect* is what
matters):
- Define a small `T_OVERLAP` (e.g. 150ms / `0.15`s).
- Within the last `T_OVERLAP` of the SVG morph: start ramping the
  canvas opacity (or clipPath radius) from 0 → 1 in parallel.
- Within the first `T_OVERLAP` of the 3D spin phase: keep the SVG
  paths at a fading opacity (1 → 0) instead of snapping to 0.
- When the 3D phase ends and the next morph starts: instead of
  resetting `clipPath` to `circle(0%)` abruptly, ramp the canvas
  opacity (or clip radius) from 1 → 0 over the first `T_OVERLAP` of
  the new morph.

Acceptance:
- Visual review (run dev server, look at the landing): the
  transitions between SVG and 3D are visibly smoother — no hard
  snap at the boundary; a brief moment where both are visible.
- No layout shift introduced. The animation cadence remains the
  same (no perceptible timing change beyond the overlap).
- `npm run build` succeeds; no new lint complaints from `HeroAnimation.tsx`.

### 0.3. Change "ambitious" → "critical"

Single word in `app/page.tsx:28`:
`"Powering the most ambitious"` → `"Powering the most critical"`.

Acceptance:
- The hero sub-headline reads "Powering the most critical / electrical
  infrastructure projects".
- `grep -n "ambitious" app/page.tsx` returns no matches.
- `npm run build` succeeds.

---

## Prerequisites and scope

This roadmap **crosses two repos**:

- `/home/agent/grid-app` — primary cwd; loop runs from here.
- `/home/agent/zap` — separate git repo. Items 1 and 2 edit zap source.
  The work-phase agent is expected to commit zap edits inside the zap repo
  before returning `STATUS: done`. The grid-app loop's commit handles only
  grid-app changes; zap commits stay in zap's history. (See the
  per-item Acceptance bullets — they call this out explicitly.)

CPU baseline to preserve exact parity with:

- Entry point: `scripts/smoke_dispatch.py::run_dispatch(net_dir, hours, solver)`
- Return tuple: `(outcome, pnet, snapshots, used_solver, elapsed)`
- Downstream consumer: `scripts/run_artifact.py::build_run_row` →
  `view_spec` for `components/runs/RunView.tsx`.
- Reference networks: `data/networks/ieee-30/` (small, fast) and
  `data/networks/pypsa-eur-slice/` (larger, exercise time-horizon).

---

## Phase A — Make ADMM work on real PyPSA networks (zap)

Gate: nothing else in this roadmap is meaningful until the GPU path can
solve a real seeded network end-to-end. Both items are in `/home/agent/zap`.

### 1. Fix `admm_prox_update` arity on PyPSA-importer devices

The Modal smoke caller observed `not enough values to unpack (expected 3,
got 2)` in `ADMMSolver.solve` when the devices come from
`zap.importers.pypsa.load_pypsa_network(...)`. Working ADMM tests in
`zap/tests/conic/test_cones.py` and `zap/tests/resource_opt/test_nu_opt.py`
all wrap devices through `ConeBridge` or `NUOptBridge` first.

Pick one fix:

- (a) Make `admm_prox_update` (or whichever device methods it calls) tolerate
  the PyPSA-importer device shapes directly, OR
- (b) Have `load_pypsa_network` wrap each device through `ConeBridge`
  (or the appropriate bridge) before returning, so the importer's output
  is uniform with the test fixtures.

Acceptance:
- In `/home/agent/zap`: `pytest zap/tests/admm/` (or whichever path covers
  ADMM tests) still passes; add one new test that loads
  `data/networks/ieee-30/` (or a small inline PyPSA network) via
  `load_pypsa_network` and runs `ADMMSolver(num_iterations=200).solve(...)`
  without raising. This test must currently fail on `main` and pass after
  the fix.
- Commit the fix inside `/home/agent/zap` with a conventional-commit message
  (e.g. `fix(admm): support pypsa-importer devices in solve`); push to
  origin if a remote is configured.
- From `/home/agent/grid-app`, after the zap fix is committed:
  `modal run infra/modal/solver_app.py::smoke --network-path
  data/networks/ieee-30.nc` (you'll need to export the folder to netCDF
  first; do that inline) returns a JSON payload with `machine`, `elapsed_s`,
  and a non-empty `outcome`.

### 2. Fix `parse_generators` for string-typed bus columns

`zap/importers/pypsa.py::parse_generators` calls
`.replace(buses_to_index).values.astype(int)` and crashes on modern pandas
when the bus column is string-dtype (which is the default for PyPSA networks
where buses are named, not numbered). Real PyPSA networks (PyPSA-Eur,
IEEE-30 as exported) hit this.

Acceptance:
- In `/home/agent/zap`: `pytest` for the importer module still passes; add
  a regression test that builds a tiny PyPSA network with string bus names
  (`"b0", "b1", "b2"`) and calls `parse_generators` (and any sibling
  `parse_*` functions with the same `.astype(int)` bug, if grep reveals
  them). Test fails on `main`, passes after fix.
- Commit inside `/home/agent/zap` with a descriptive message.
- From `/home/agent/grid-app`:
  `python scripts/smoke_dispatch.py data/networks/ieee-30` still succeeds
  on the CPU path (i.e. the fix doesn't regress the cvxpy importer use).

---

## Phase B — Modal handler returns rich payloads

### 3. Add labels (`bus_ids`, `snapshot_iso`, `device_class_names`) to Modal response

`infra/modal/solver_app.py::_run_solve` currently returns raw tensors with
no indices. The CPU `DispatchOutcome` consumer (`build_run_view_spec`)
needs bus IDs and snapshot timestamps to build the view_spec. Today those
come from the local `pypsa.Network` object; in the Modal path the network
lives only inside the container, so the response must carry the labels.

Acceptance:
- `infra/modal/solver_app.py::_run_solve` returns a payload that, in addition
  to today's keys, includes:
  - `bus_ids: list[str]` — `pnet.buses.index.tolist()` (or equivalent for
    whichever shape the zap network ended up with).
  - `snapshot_iso: list[str]` — ISO strings, one per snapshot.
  - `device_class_names: list[str]` — `[d.__class__.__name__ for d in devices]`,
    same order as `outcome.power` / `num_devices`.
- `lib/modal-solver.ts::SolveResult` interface updated to include those
  fields; existing fields unchanged.
- `modal deploy infra/modal/solver_app.py` succeeds from `/home/agent/grid-app`
  with `ZAP_SRC=/home/agent/zap`.
- A fresh call to the redeployed endpoint (either via `modal run ... ::smoke`
  on a real PyPSA folder, or via a curl with a `network_nc_b64` body)
  returns JSON containing all three new keys.

### 4. Build CPU-shape adapter for the Modal response

New helper, somewhere in `scripts/` (suggested: `scripts/_gpu_adapter.py`).
Takes a `SolveResult`-shaped dict (or its Python equivalent from
`solve_direct.remote(...)`) plus the local `pnet` and `snapshots` index
that the caller already has, and returns an object that **quacks like
cvxpy's `DispatchOutcome`** — same attribute names, same array shapes —
so it can flow into `run_artifact.build_run_view_spec` unchanged.

Specifically:

- `.prices` → `np.ndarray` of shape `[n_buses, n_snapshots]`,
  bus axis aligned to `pnet.buses.index`.
- `.power` → list / nested structure matching what `build_run_view_spec`
  expects (look at `_carrier_dispatch_long` and friends to see what's read).
- `.angle` → optional, `[n_lines, n_snapshots]` if present in Modal payload.

Acceptance:
- New file `scripts/_gpu_adapter.py` exporting one function:
  `adapt_modal_to_dispatch_outcome(modal_result: dict, pnet, snapshots) -> object`.
- Unit-style smoke (can live in `scripts/_test_gpu_adapter.py` or be a
  `__main__` block): given a hand-built fake Modal result on the
  `ieee-30` network shape, the adapter's output passes through
  `run_artifact.build_run_view_spec(outcome, pnet, snapshots)` without
  KeyErrors / shape errors, and the resulting `view_spec` has non-empty
  `lmps` and `hours` lists.
- Round-trip on a real network:
  `python -c "from scripts.smoke_dispatch import run_dispatch; from scripts.run_artifact import build_run_view_spec; o,p,s,u,e = run_dispatch(Path('data/networks/ieee-30'), hours=4, solver=None); print(build_run_view_spec(o,p,s).keys())"`
  (existing CPU path) still works — i.e. the adapter doesn't break the
  CPU return shape.

---

## Phase C — `--gpu` flag through every caller

### 5. Add `gpu` kwarg to `scripts/smoke_dispatch.py::run_dispatch`

`run_dispatch(net_dir, hours=1, solver=None, gpu=False)`. When `gpu=True`:

1. Build the same `pypsa.Network` + `snapshots` as today.
2. Export the network to in-memory netCDF bytes.
3. Call `lib/modal-solver.ts::solveOpfOnModal`'s Python sibling —
   simplest path is the Modal SDK's `solve_direct.remote(...)` from
   `infra/modal/solver_app.py`; if that's awkward to import, write a thin
   Python http client that mirrors `modal-solver.ts` (same env vars
   `ZAP_SOLVER_MODAL_URL`, `ZAP_SOLVER_API_KEY`).
4. Pass the response through the Phase B adapter.
5. Return `(outcome, pnet, snapshots, used_solver, elapsed)` with
   `used_solver = "MODAL_GPU"` (or similar; pick a value and use it
   consistently).

`scripts/smoke_dispatch.py::main` gains a `--gpu` flag that flips the kwarg.

Acceptance:
- `python scripts/smoke_dispatch.py data/networks/ieee-30 --gpu --hours 4`
  exits 0, prints a summary line, and reports `solver=MODAL_GPU` (or
  whichever sentinel chosen).
- `python scripts/smoke_dispatch.py data/networks/ieee-30 --hours 4`
  (no `--gpu`) still works exactly as before — no regression.
- LMP-magnitude parity: the GPU outcome's `.prices` is within 5% (max abs
  diff / max abs of CPU prices) of the CPU outcome's `.prices` on
  `ieee-30, hours=4`. Print the comparison from the script (or a
  companion script `scripts/_compare_cpu_gpu.py`) so the verify phase
  can see it.

### 6. Thread `--gpu` through `seed_networks.py` and `ingest_pypsa_folder.py`

Both call `run_dispatch` today. Add a `--gpu` flag that's plumbed through
verbatim. No business-logic changes.

Acceptance:
- `python scripts/seed_networks.py --gpu --only ieee-30 --dry-run`
  (or whichever subset/dry-run flag exists; if none, add one for the test)
  reaches the dispatch step and reports `MODAL_GPU` was used.
- `python scripts/ingest_pypsa_folder.py --gpu <some-test-folder>`
  similarly. If no test folder is convenient, use `data/networks/ieee-30`
  and route to a temp output dir.
- Without `--gpu`, both scripts behave exactly as before.

---

## Phase D — Agent surface and renderer provenance

### 7. MCP tool `solve_opf` (with `gpu` arg) in `scripts/user-mcp-server.py`

So the chat agent can trigger a solve and a `run` artifact appears inline.
The MCP server already auto-discovers public functions in
`$STEINMETZ_FEATURES_DIR`; this is a built-in tool, not a feature, so
add it as a first-class handler alongside whatever's already registered.

Tool signature (suggested):

```
solve_opf(network_artifact_id: str, hours: int = 24, gpu: bool = False)
  -> {"run_artifact_id": str, "machine": str, "elapsed_s": float, ...}
```

Implementation:

1. Fetch the network artifact (Supabase row + its stored PyPSA folder /
   netCDF blob).
2. Call `run_dispatch` with the appropriate `gpu` flag.
3. Call `build_run_row` and write the new row to Supabase
   (`artifacts` table, `kind='run'`, parent = the network artifact).
4. Return the new row's ID and the solve metadata.

Acceptance:
- `solve_opf` shows up in `tools/list` when the MCP server is started
  against a workspace.
- Calling `solve_opf` with a real seeded network's artifact ID and
  `gpu=False` produces a `run` artifact row in Supabase whose
  `view_spec.lmps` is non-empty.
- Same call with `gpu=True` produces an analogous artifact and the row's
  metadata includes `machine: "cuda"` (or whatever the GPU container
  reports).
- `may_I_proceed` is called for both paths (matches existing pattern in
  user-mcp-server.py for feature tools — GPU solves are expensive, the
  admission check matters).

### 8. Extend `build_run_row` and `RunView.tsx` for solver provenance

Today `build_run_row` records `used_solver` as a plain string ("HIGHS",
"CLARABEL", ...). Extend the row's metadata block to also carry
`machine`, `gpu`, `elapsed_s`, and (for GPU) the solver_args block from
the Modal response. `view_spec.renderer === "run"` already exists in
`components/renderers/run.tsx` / `components/runs/RunView.tsx`; surface
the new fields as a small "Solver" pill / footer on the run page.

Acceptance:
- `scripts/run_artifact.py::build_run_row` accepts (or threads through)
  the new provenance fields without breaking existing callers
  (`seed_networks.py`, `ingest_pypsa_folder.py`).
- A GPU-solved run artifact, when opened in the app, visibly shows
  "Solved on H100 · 4.2s · 1000 ADMM iters" (exact copy can vary; the
  point is the fields are rendered, not buried in JSON).
- A CPU-solved run artifact still renders correctly — the new fields
  degrade gracefully when `machine`/`gpu` are absent.
- `npm run build` succeeds from `/home/agent/grid-app`.

---

## Phase E — End-to-end parity proof

### 9. CPU-vs-GPU parity sanity script + committed report

One reproducible script that exercises the whole stack on the two
reference networks and emits a short markdown report capturing
correctness and timing. Lives at `scripts/_gpu_parity_report.py` and
writes its output to `infra/modal/PARITY_REPORT.md`. Not run in CI; run
once to commit the artifact so future drift is detectable.

For each of `ieee-30` (hours=4) and `pypsa-eur-slice` (hours=24, or
whichever the smaller PyPSA-Eur slice is):

1. CPU solve → record `elapsed`, top-5 LMPs.
2. GPU solve → record `elapsed`, top-5 LMPs.
3. Compare: max abs diff in LMPs, max relative diff, agreement on
   ordering of top-5 buses.

Acceptance:
- `python scripts/_gpu_parity_report.py` exits 0.
- `infra/modal/PARITY_REPORT.md` is committed and contains the timing +
  diff numbers for both networks.
- For `ieee-30`, max relative LMP diff is < 5%. If it's larger, the
  report explains why (likely ADMM convergence — bump
  `num_iterations` or `atol/rtol` and re-run).
- The README section in `infra/modal/README.md` labeled "Wire-up that's
  NOT done" is deleted; replaced with a one-line pointer to
  `PARITY_REPORT.md`.

---

## Phase F — Frontend validation, fix-as-you-go, and demos

This phase is structurally different from A–E. It has a **fixed terminal
item** (the screen-recording demos page). Item 10 is authorised to
**insert new `[ ]` queue items into `LOOP_QUEUE.md`** for any frontend
issue it surfaces that isn't fixable inline. Those inserted items go
**above** the terminal item, so the loop will work through them before
the terminus.

Mechanic: `LOOP_QUEUE.md` carries a sentinel comment line
`<==NEXT-LINE-IS-TERMINAL==>` immediately above the terminal item.
Item 10's work agent inserts new items at that marker (one above the
marker, marker stays). The loop's `next_queue_line` always grabs the
first `[ ]` line by file order, so dynamically inserted items are
worked next.

### 10. Frontend validation & bug-hunting with Playwright (substantial; 1.5× budget)

Self-expanding item, and the most substantive item in this roadmap.
**Not just a core-flow smoke pass — this is a varied validation /
bug-hunting exercise.** The agent has authority to edit
`LOOP_QUEUE.md` and is encouraged to probe broadly: edge cases,
error-state UI, accessibility, weird state transitions, race
conditions, anything that smells off. "Validating", not just testing —
broken, weird, slow, or ugly flows must be addressed before the loop
proceeds.

This item runs under a **1.5× work budget** (45 minutes instead of
the default 30) and 15-minute verify (instead of 10) because of its
scope. The loop enforces this automatically for any item whose
feature number is `10` or `10.x` (see `loop.sh` per-item timeout
override).

Setup:

- Create a test account in Supabase auth: email `claude@steinmetz.ai`,
  password auto-generated (32-char hex), `email_confirm: true` via the
  service-role admin API (do **not** rely on email delivery — the
  mailbox may not exist). Reference: `lib/supabase/service.ts` already
  has a service client; or extend `scripts/admin_create_user.sh` if
  that's the existing convention.
- Persist credentials only in `grid-app/.env.local` as
  `STEINMETZ_TEST_ACCOUNT_EMAIL` and `STEINMETZ_TEST_ACCOUNT_PASSWORD`.
  Do not commit them.
- If Playwright isn't installed in the project's node deps, install it
  as a devDependency (`@playwright/test`). The user-level
  `/home/agent/playwright/` directory exists but Steinmetz's tests live
  under `grid-app/tests/flows/` going forward.

Coverage breadth — minimum set, then **go further**. The list below is
table-stakes; the bug-hunt is what makes this item substantive.

#### A. Core flows (table stakes)

1. Signup (with a throwaway email, then cleanup) — confirms the
   signup form, validation messages, and post-signup redirect.
2. Login as `claude@steinmetz.ai` from `/login` → land on `/app`.
3. First-login workspace materialization — `lib/user-workspace.ts`
   should create the per-user dir; verify the user sees the empty
   workspace state, not an error.
4. Chat: send a message, observe poll-based response (no streaming
   yet per AGENTS.md), see tool-call cards (or note they're missing).
5. Network upload via `/api/upload` — drop a PyPSA CSV folder or zip,
   confirm the artifact appears in the workspace.
6. Network artifact view — open an existing seeded network (e.g.
   ieee-30), confirm renderers fire and view_spec is honoured.
7. Run artifact view — open a `kind='run'` artifact, confirm LMP
   heatmap / dispatch series render.
8. Dashboards page — confirm the agent-authored dashboard list loads,
   click into one.
9. Features page — confirm the features table lists per-user
   functions, can open a feature's source.
10. Org pages (`/app/orgs/...`) — confirm org-switcher, members list,
    org-overlay stacking (the HARDENING §1.3 fix should hold).
11. Settings — provider keys form, sign-out flow.
12. Logout — confirms session is cleared and `/app` redirects to
    `/login`.

#### B. Error / edge probes (the bug-hunt — broad, varied)

Pick a healthy sample from each bucket. Don't try to be exhaustive;
**do** try to be varied. Stop when you've found enough to make a
real difference, not when the list is checked.

- **Auth / session**: expired session mid-action, two tabs in
  conflict, login with wrong password, signup with already-used
  email, signup with malformed email, password reset (does it work?),
  signed-out access to `/app/*` deep links.
- **Form & input**: submit empty forms, submit oversized inputs,
  rapid double-click submit (idempotency), pasted whitespace,
  unicode in names, very long network names, special characters in
  feature names.
- **Network / artifact lifecycle**: upload corrupt zip, upload
  too-large file, upload non-PyPSA folder, ingest a network with
  zero generators, delete an artifact, rename a network, browse to
  a stale artifact ID, attempt to view another user's artifact ID
  (RLS should bite — confirm the error is clean, not a 500).
- **Chat / agent**: send empty message, send 10kb of text, send while
  a previous response is in-flight, navigate away mid-response,
  cancel a tool call (if cancel exists; if not, that's a finding).
- **Renderers / view_spec**: artifact with malformed view_spec,
  artifact missing expected fields, very long row table, chart
  with NaN values. Check that renderers degrade gracefully per the
  harness-first principle.
- **Org / sharing**: switch orgs mid-action, leave the org you're
  viewing, view an org you don't belong to.
- **Layout & a11y quick passes**: tab through key pages and check
  focus order, run a single axe scan per major page, check that
  important text isn't truncated at common widths (1024, 1280),
  check mobile viewport (375×667) renders without horizontal
  scroll on the landing + login.
- **Real-world weirdness**: browser back/forward across SPA routes,
  open the same page in two tabs and modify in both, slow-3G
  throttle on a network upload, page refresh during chat polling.
- **Whatever else the agent notices**: if the design feels off, the
  spacing is wrong, the copy is unclear, an interaction is
  surprising — file it or fix it.

Validation discipline:

- For each flow: write a Playwright spec under
  `tests/flows/<flow-name>.spec.ts`. Tests use a fixture that logs in
  as `claude@steinmetz.ai` (or signs up a throwaway in the signup
  test).
- Run the suite (`npx playwright test tests/flows/`).
- For every issue surfaced, classify it:
  - **Trivial / scoped** (typo, missing aria-label, obvious crash with
    a one-line fix, broken redirect): fix inline as part of this
    iteration's commit.
  - **Substantive** (missing feature, design rework, multi-file fix):
    insert a new `- [ ]` queue item above the
    `<==NEXT-LINE-IS-TERMINAL==>` sentinel. Write proper acceptance
    bullets for it. Number it `10.x` to make its provenance clear
    (`10.1`, `10.2`, ...).
  - **Out of scope** (e.g. demands a backend change far from frontend):
    note in `LOOP_ALERTS.md` for human review; do not block.

Acceptance:

- Test account `claude@steinmetz.ai` exists in Supabase auth (confirmed,
  service-role-created); password lives only in `.env.local` (gitignored).
- `tests/flows/` contains specs covering at least the 12 core flows
  AND a meaningful sample of error / edge probes across the buckets
  above (no need to cover every bucket exhaustively, but covering
  zero buckets isn't validation — it's a smoke test).
- `npx playwright test tests/flows/` exits 0 OR every failure is
  explained: either fixed inline (commit shows the fix) or filed as a
  new queue item above the terminal sentinel.
- For each finding, the agent makes the disposition explicit in the
  commit message or ACCEPTANCE block: **fixed inline**, **filed as
  10.x queue item**, or **noted in `LOOP_ALERTS.md` for human review**.
- `LOOP_QUEUE.md` ends this iteration with either (a) more `- [ ]`
  items than it started with (validation surfaced work, the expected
  outcome), or (b) the ACCEPTANCE field explicitly states `"no
  follow-up items needed — every flow ships clean"` (rare; treat
  with skepticism).
- The Steinmetz dev stack is verifiably running during the test
  (Playwright config points at `http://localhost:3000`; tests start
  the dev server or assume it's up — document which in the spec
  comments).

### 99. Demo screen recordings on `/app/demos` (TERMINAL ITEM)

**Do not run this until every preceding `[ ]` item is done.** Loop
mechanics guarantee this as long as nothing is inserted below the
`<==NEXT-LINE-IS-TERMINAL==>` sentinel.

**Bail-out clause**: if screen recording proves genuinely impossible
in this environment (after a substantive attempt — *not* a token-saving
cop-out), the work agent should write `BLOCKED: yes` in `LOOP_HANDOFF.md`
with a clear `SUMMARY:` of what was tried and what blocked. The loop
will mark the item `[!]` immediately and stop, rather than retry
five times. **Be skeptical of your own "impossible" claim**: Playwright
ships with `video: 'on'`; `ffmpeg` + Xvfb is a well-trodden fallback;
headless Chrome can record via `chrome-remote-interface` page capture.
"This is hard" or "I'm not sure which tool" is *not* grounds to
declare BLOCKED — enumerate options, try the most promising, then
the next. Only after concrete, named approaches have all failed for
environmental reasons does BLOCKED apply.

Goal: a `/app/demos` page that shows recorded video walkthroughs of
the validated core flows, gated by the existing `proxy.ts` auth so
only logged-in users see it.

Implementation outline (the agent may pick the exact tool):

- Recording: simplest path is Playwright's `video: 'on'` mode in
  `tests/demos/<flow-name>.recording.spec.ts` — one spec per flow,
  driving the validated user journey end-to-end with sensible timing
  (waits + scroll for visibility, not raw click-storms).
- Storage: prefer Supabase Storage (`demos` bucket, public-read
  policy is fine because the page that lists them is auth-gated).
  Fallback: `public/demos/` in the repo — only acceptable if total
  size stays under ~20MB; otherwise it'll bloat the repo.
- Page: `app/app/demos/page.tsx` lists each demo with title +
  description + inline `<video>` element. Layout matches existing
  authed-area pages (`app/app/dashboards/page.tsx` is a reasonable
  pattern). The route inherits auth from `proxy.ts` automatically
  because it's under `/app/*`.
- Per-demo metadata source: either a static array in the page
  component or a row per demo in Supabase (`demos` table). Pick the
  static array unless multiple demos already need to be edited
  independently.

Acceptance:

- `app/app/demos/page.tsx` exists; navigating to
  `http://localhost:3000/app/demos` while logged out redirects to
  `/login` (proxy.ts behaviour). Logged in, it renders the demos list.
- At least one recording per validated flow (matching the spec count
  from item 10) is uploaded/served and plays in the browser.
- `npm run build` succeeds.
- README pointer added in `STATE.md` so this surface is discoverable.

---

## Out of scope (do not invent items for these)

- Auto-tiering policy ("decide CPU vs GPU based on size"). Explicit choice
  only, per the conversation that produced this roadmap.
- Warm-pool / always-on GPU container. Cold-start is accepted.
- Differentiable-solve / gradient-through-ADMM use cases. Not required for
  dispatch parity.
- Quota / billing integration beyond the existing `may_I_proceed` admission
  check. Cost-policing is a separate Hardening item.

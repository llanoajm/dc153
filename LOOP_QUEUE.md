# Loop Queue — GPU/CPU parity

Legend: `[ ]` pending · `[x]` done · `[!]` blocked (manual review)
Source roadmap: `GPU_PARITY_ROADMAP.md`. Each item below points to a numbered
section there. Acceptance bullets here are the scriptable subset; read the
roadmap section for full context before working an item.

Cross-repo note: items 1 and 2 edit `/home/agent/zap`. The work agent must
commit zap edits inside `/home/agent/zap` (and push if origin is set)
before returning `STATUS: done`. The grid-app loop's per-iteration commit
only captures grid-app changes.

---

- [x] 0.1. Recolour accent CTAs + navbar to dark blue (ROADMAP §Phase 0.1)
  - context: `--accent: #0044CC` in `app/page.module.css:3` is the variable used by `.navLink`, `.navCta` (Contact Us), and `.heroCta` (Try Curie OS). Logo (`.navLogo`/`.navMark`/`.navWord`) inherits page colour `#000` and does NOT use `--accent` — straight variable swap leaves it alone. 3D skins (in `public/models/*.glb`) are unaffected by CSS.
  - acceptance:
    - `--accent` swapped from `#0044CC` to a dark blue (navy / midnight; agent picks the exact hex)
    - navbar links, Contact Us button, Try Curie OS CTA all visibly dark blue; logo + wordmark remain black; 3D hero materials unchanged
    - hover states still contrast cleanly
    - `npm run build` succeeds

- [x] 0.2. Soften SVG ↔ 3D transition in HeroAnimation (ROADMAP §Phase 0.2)
  - context: `app/components/HeroAnimation.tsx` snaps between the SVG morph and the 3D canvas at `local === T_MORPH` — SVG paths jump `opacity:1→0`, canvas `clipPath` jumps `circle(0%)→circle(100%)`. Goal: short overlap window (~120–200ms) where both layers are partially visible, and the 3D layer **fades** when the phase ends instead of being abruptly clipped away.
  - acceptance:
    - visual review on dev server shows transitions between SVG and 3D are smoother — no hard snap; a brief moment where both are visible
    - 3D removal at end of 3D phase is a quick fade (~150ms), not an instant clip-back
    - no layout shift, animation cadence preserved (no perceptible timing change beyond the overlap itself)
    - `npm run build` succeeds; no new lint complaints from `HeroAnimation.tsx`

- [x] 0.3. Change "ambitious" → "critical" in hero sub-headline (ROADMAP §Phase 0.3)
  - context: one word in `app/page.tsx:28`.
  - acceptance:
    - hero sub-headline reads "Powering the most critical / electrical infrastructure projects"
    - `grep -n "ambitious" app/page.tsx` returns no matches
    - `npm run build` succeeds

- [x] 1. Fix `admm_prox_update` arity on PyPSA-importer devices (ROADMAP §Phase A.1)
  - context: ADMM blows up with `not enough values to unpack (expected 3, got 2)` on `load_pypsa_network` outputs; tests wrap devices via `ConeBridge`/`NUOptBridge`.
  - acceptance:
    - new pytest in `/home/agent/zap` loads `ieee-30` (or inline string-bus PyPSA net) and runs `ADMMSolver(num_iterations=200).solve(...)` without raising; fails on main, passes after fix
    - existing `pytest /home/agent/zap/zap/tests/` still passes
    - zap fix committed inside `/home/agent/zap` (conventional commit subject); pushed if origin remote set
    - from `/home/agent/grid-app`, `modal run infra/modal/solver_app.py::smoke --network-path <ieee-30.nc>` returns JSON with non-empty `outcome`

- [x] 2. Fix `parse_generators` for string-typed bus columns in modern pandas (ROADMAP §Phase A.2)
  - context: `.replace(buses_to_index).values.astype(int)` chokes on string-dtype bus columns; real PyPSA networks default to string bus names.
  - acceptance:
    - new pytest in `/home/agent/zap` builds a tiny PyPSA net with string bus names, calls `parse_generators` (and siblings with same `astype(int)` pattern); fails on main, passes after fix
    - existing zap test suite still green
    - fix committed inside `/home/agent/zap`; pushed if origin set
    - from `/home/agent/grid-app`: `python scripts/smoke_dispatch.py data/networks/ieee-30` still exits 0 on the CPU path (no importer regression)

- [x] 3. Add `bus_ids` / `snapshot_iso` / `device_class_names` to Modal solver response (ROADMAP §Phase B.3)
  - context: CPU `DispatchOutcome` consumer needs indices to build view_spec; Modal payload today is raw tensors with no labels.
  - acceptance:
    - `infra/modal/solver_app.py::_run_solve` returns the three new keys alongside existing fields
    - `lib/modal-solver.ts::SolveResult` interface lists the three new fields; `npm run build` from `/home/agent/grid-app` succeeds
    - `modal deploy infra/modal/solver_app.py` from `/home/agent/grid-app` (with `ZAP_SRC=/home/agent/zap`) succeeds
    - fresh call to the redeployed endpoint returns JSON containing all three new keys

- [!] 4. Build CPU-shape adapter (`scripts/_gpu_adapter.py`) for Modal response (ROADMAP §Phase B.4)
  - context: Modal payload → object that quacks like cvxpy's `DispatchOutcome`, so `run_artifact.build_run_view_spec` flows unchanged.
  - acceptance:
    - new `scripts/_gpu_adapter.py` exports `adapt_modal_to_dispatch_outcome(modal_result, pnet, snapshots)`
    - adapter unit smoke (in module `__main__` or `scripts/_test_gpu_adapter.py`) builds a fake Modal result for `ieee-30` shape, passes it through `build_run_view_spec`, asserts non-empty `lmps` and `hours`
    - existing CPU path round-trip still works: `python -c "from scripts.smoke_dispatch import run_dispatch; ..."` still produces a usable `view_spec` (regression check)

- [!] 5. Add `gpu` kwarg + `--gpu` flag to `scripts/smoke_dispatch.py::run_dispatch` (ROADMAP §Phase C.5)
  - context: same tuple shape `(outcome, pnet, snapshots, used_solver, elapsed)` with `used_solver="MODAL_GPU"`; routes through Modal endpoint and Phase B adapter.
  - acceptance:
    - `python scripts/smoke_dispatch.py data/networks/ieee-30 --gpu --hours 4` exits 0; printed summary names `solver=MODAL_GPU`
    - `python scripts/smoke_dispatch.py data/networks/ieee-30 --hours 4` (no `--gpu`) still works exactly as before
    - GPU and CPU LMPs on `ieee-30, hours=4` agree within 5% max relative diff (printed by the script or by a companion `scripts/_compare_cpu_gpu.py`)

- [!] 6. Thread `--gpu` through `seed_networks.py` and `ingest_pypsa_folder.py` (ROADMAP §Phase C.6)
  - context: plumb the flag verbatim through both ingest callers; no business-logic changes.
  - acceptance:
    - `python scripts/seed_networks.py --gpu --only ieee-30 --dry-run` (or equivalent narrow-scope invocation) reports `MODAL_GPU` was used
    - `python scripts/ingest_pypsa_folder.py --gpu <test-folder>` likewise
    - without `--gpu`, both scripts behave exactly as before (run on `ieee-30`, compare exit code + emitted artifact to a baseline)

- [x] 7. Add MCP tool `solve_opf(network_artifact_id, hours, gpu)` to `scripts/user-mcp-server.py` (ROADMAP §Phase D.7)
  - context: agent-callable tool that fetches a network artifact, runs dispatch (CPU or GPU), writes a `run` artifact, returns its ID.
  - acceptance:
    - `solve_opf` appears in `tools/list` output when the MCP server is started against a workspace
    - calling `solve_opf` with a real seeded `ieee-30` artifact ID and `gpu=False` writes a `run` artifact row whose `view_spec.lmps` is non-empty
    - same call with `gpu=True` writes an analogous row; metadata includes `machine: "cuda"` (or whatever the GPU container reports)
    - `may_I_proceed` / `release` are called around the solve, matching existing patterns for feature tools

- [x] 8. Extend `build_run_row` + `RunView.tsx` to show solver provenance (ROADMAP §Phase D.8)
  - context: surface `machine`, `gpu`, `elapsed_s`, `solver_args` from GPU runs (and existing `used_solver` for CPU runs) in the run page header/footer.
  - acceptance:
    - `scripts/run_artifact.py::build_run_row` accepts and threads through the new provenance fields without breaking existing callers
    - a GPU run artifact opened in the app visibly shows machine + gpu + elapsed; a CPU run artifact still renders correctly with the new fields absent
    - `npm run build` from `/home/agent/grid-app` succeeds

- [x] 9. End-to-end CPU vs GPU parity report (ROADMAP §Phase E.9)
  - context: one reproducible script + committed report capturing timing and LMP-diff numbers on `ieee-30` and `pypsa-eur-slice`.
  - acceptance:
    - `python scripts/_gpu_parity_report.py` exits 0
    - `infra/modal/PARITY_REPORT.md` committed and contains timing + LMP diff numbers for both networks
    - `ieee-30` max relative LMP diff < 5% (or report explains why and references the ADMM knobs tuned)
    - "Wire-up that's NOT done" section of `infra/modal/README.md` deleted; replaced with a one-line pointer to `PARITY_REPORT.md`

- [x] 10. Frontend validation & bug-hunting with Playwright (substantial; 1.5× budget) (ROADMAP §Phase F.10)
  - context: self-expanding bug-hunt, not a smoke pass. Creates Supabase test account `claude@steinmetz.ai`, writes Playwright specs covering core flows AND varied error/edge probes (auth/session, form input, artifact lifecycle, chat, renderers, orgs, a11y, real-world weirdness — see ROADMAP §F.10 bucket B for the full prompt). Fixes trivial issues inline; inserts `- [ ] 10.x` queue items above the `<==NEXT-LINE-IS-TERMINAL==>` sentinel for substantive ones. Runs under 45m work / 15m verify budget (1.5× default; enforced by loop.sh per-item timeout override).
  - acceptance:
    - test account `claude@steinmetz.ai` exists in Supabase auth, created via service-role admin API with `email_confirm: true`; password persisted to `.env.local` as `STEINMETZ_TEST_ACCOUNT_PASSWORD` (gitignored under `.env*`), never committed
    - `tests/flows/` contains Playwright specs covering the 12 core flows (signup, login, workspace materialization, chat send/receive, network upload, network artifact view, run artifact view, dashboards page, features page, org pages, settings, logout) AND a meaningful sample across the error/edge buckets (auth/session, form/input, artifact lifecycle, chat, renderers, org/sharing, a11y, real-world)
    - `npx playwright test tests/flows/` exits 0 OR every failure has explicit disposition: **fixed inline**, **filed as 10.x queue item**, or **noted in LOOP_ALERTS.md for human review**
    - `LOOP_QUEUE.md` either gained `- [ ]` items above the sentinel this iteration (the expected outcome), OR ACCEPTANCE explicitly states "no follow-up items needed — every flow ships clean" (treat with skepticism)
    - dev stack (Next.js on 3000, opencode proxy on 4097, opencode server on 4096) verifiably running during the test run; spec comments document the launch assumption

- [x] 10.1 Validate `STEINMETZ_OPENCODE_TOKEN` / `STEINMETZ_INTERNAL_TOKEN` format at server boot (ROADMAP §Phase F.10 — filed by item 10)
  - context: while validating Phase F.10, `/api/opencode/session` was 500ing
    with `TypeError: Cannot convert argument to a ByteString because the
    character at index 72 has a value of 9474 which is greater than 255`.
    Root cause: the shell that launched `npm run dev` exported
    `STEINMETZ_OPENCODE_TOKEN` (and `STEINMETZ_INTERNAL_TOKEN`) with a
    trailing `" │\n"` (U+2502 box-drawing + newline, evidently copy-pasted
    from a TUI table). Next.js's dotenv loader does NOT override
    pre-existing env vars, so the corrupt shell value beat the clean
    `.env.local` entry and Node's fetch refused the resulting bearer
    header. The chat textarea silently stayed on "Loading…" with no
    surfaced error — only a Playwright probe + DOM scrape revealed the
    underlying TypeError. A startup-time validator would fail fast instead
    of bleeding into every chat session.
  - acceptance:
    - on Next.js boot, validate each of `STEINMETZ_OPENCODE_TOKEN` and
      `STEINMETZ_INTERNAL_TOKEN` (when present) matches `^[0-9a-f]{32,}$`
      and is otherwise ASCII-only; log a loud warning AND set the value
      to undefined (or throw) if it doesn't, so downstream code falls
      back to `.env.local` instead of using the polluted value
    - unit test covers: clean 64-char hex → kept; trailing whitespace →
      kept after trim; embedded `│` (U+2502) or other non-ASCII → rejected
    - AGENTS.md "Known operational gotchas" gains a one-liner pointing at
      this footgun + the `env -i HOME=$HOME PATH=$PATH npm run dev`
      mitigation; LOOP_ALERTS.md note from 2026-05-26 can be closed once
      this lands

- [x] 10.2 Surface a clear inline error when `/api/opencode/session` 500s during chat bootstrap (ROADMAP §Phase F.10 — filed by item 10)
  - context: when the session POST 500s (e.g. the env-pollution above, or
    opencode itself being down), the chat page leaves the textarea stuck
    on placeholder "Loading…" with no visible explanation. The component
    state machine catches the error and stores it but only renders it when
    `hasAnyRenderableContent` is true (see app/app/page.tsx around line
    305) — empty-session boots therefore swallow the message entirely.
    Users sit on a non-functional UI with no clue what's wrong.
  - acceptance:
    - on session-bootstrap failure, the chat page renders the captured
      error text above the textarea regardless of message-list state, and
      offers a "Retry" affordance that re-invokes the POST
    - the textarea placeholder swaps from "Loading…" to "Chat is offline —
      see error above" so the disabled state is at least explained
    - Playwright spec (extend `tests/flows/chat.spec.ts`) drives the
      failure mode by intercepting `POST /api/opencode/session` with a
      500 and asserts the error + retry button are visible
<==NEXT-LINE-IS-TERMINAL==>
<!-- Loop note: item 10 (and any 10.x items it inserts) must finish BEFORE the
     terminal item below. Insert any new validation-spawned queue items
     immediately ABOVE this comment so the loop processes them before item 99. -->

- [ ] 99. Demo screen recordings on `/app/demos` — TERMINAL ITEM (ROADMAP §Phase F.99)
  - context: auth-gated `/app/demos` page lists video walkthroughs of validated flows. Recordings produced via Playwright `video: 'on'` (or another browser-recording tool the agent picks); stored in Supabase Storage `demos` bucket (preferred) or `public/demos/` (only if total < ~20MB).
  - acceptance:
    - `app/app/demos/page.tsx` exists; `http://localhost:3000/app/demos` redirects to `/login` when logged out and renders the demos list when logged in
    - at least one recording per validated flow from item 10 (and any 10.x items) is uploaded/served, plays in the browser
    - `npm run build` succeeds from `/home/agent/grid-app`
    - `STATE.md` updated with a pointer to the demos page so the surface is discoverable

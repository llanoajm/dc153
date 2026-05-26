## Current item (from LOOP_QUEUE.md line 115)
- [ ] 10.1 Validate `STEINMETZ_OPENCODE_TOKEN` / `STEINMETZ_INTERNAL_TOKEN` format at server boot (ROADMAP §Phase F.10 — filed by item 10)

## Attempt
1 of 5

## Context to load before working
- GPU_PARITY_ROADMAP.md           (full roadmap; the item in LOOP_QUEUE.md points to a §section here)
- AGENTS.md                       (project rules, layered architecture, harness-first principle)
- CLAUDE.md                       (one-line include of AGENTS.md)
- STATE.md                        (current build cursor — read tail for what's freshly shipped)
- infra/modal/README.md           (existing Modal deploy + wire-up notes)
- infra/modal/solver_app.py       (deployed Modal app; the body of `_run_solve` is the GPU call site)
- lib/modal-solver.ts             (TS client; `SolveResult` interface lives here)
- scripts/smoke_dispatch.py       (CPU baseline: `run_dispatch` returns `(outcome, pnet, snapshots, used_solver, elapsed)`)
- scripts/run_artifact.py         (`build_run_row` / `build_run_view_spec` — downstream consumer of any solve outcome)
- scripts/user-mcp-server.py      (per-user MCP server — where new agent-callable tools register)
- components/runs/RunView.tsx     (renders run artifacts; provenance fields surface here)
- /home/agent/zap/zap/admm/       (ADMMSolver / ADMMLayer source — Phase A.1)
- /home/agent/zap/zap/importers/pypsa.py  (`load_pypsa_network`, `parse_generators` — Phase A.2)
- /home/agent/zap/zap/tests/      (existing zap test layout — pattern for the new regression tests)
- LOOP_QUEUE.md                          (the queue you're working from)
- recent tail of LOOP_JOURNAL.md

## Protocol
1. Read the context above plus any acceptance criteria nested under the
   current item in LOOP_QUEUE.md.
2. Implement the item against those acceptance criteria. Run the relevant
   smoke for the item (e.g. `python scripts/smoke_dispatch.py data/networks/ieee-30`
   for Phase C items, `npm run build` for TS/renderer items in Phase B/D,
   `pytest /home/agent/zap/zap/tests/` for Phase A items, `modal deploy
   infra/modal/solver_app.py` after touching the Modal app) before concluding.
3. Commit your code changes with a descriptive conventional-commit message.
4. Overwrite LOOP_HANDOFF.md to end with EXACTLY these fields, one per line:
   STATUS: done | partial
   SUMMARY: <1 sentence, will be embedded in the loop's tag commit>
   NEXT_STEPS: <only if partial; concrete handoff for the next agent>
   ACCEPTANCE: <which criteria pass, which don't>
   BLOCKED: yes  ← ONLY include this line if the item is genuinely
                   blocked by an environmental constraint (not "this is
                   hard" or "I'm not sure"). When BLOCKED: yes is set,
                   the loop marks the item [!] immediately and stops
                   retrying — no more attempts. Use NEXT_STEPS to
                   describe what you tried and what blocked you.
                   Be skeptical of your own "impossible" claim:
                   enumerate concrete approaches and try the most
                   promising before declaring BLOCKED.
   Do NOT commit LOOP_HANDOFF.md — the loop owns the bookkeeping commit.

## Constraints
- Cross-repo items (1, 2) edit /home/agent/zap. Commit zap changes INSIDE
  /home/agent/zap with a conventional-commit subject and push to origin if
  configured, BEFORE returning STATUS: done. The grid-app loop's tag commit
  only captures grid-app changes. Do not stage zap files into grid-app.
- Otherwise honour AGENTS.md: "in end-user mode the agent must not modify
  zap source." Items 1-2 are the explicit maintainer-mode exceptions for
  this loop; everything else stays out of /home/agent/zap.
- Do not commit secrets. .env.local holds ZAP_SOLVER_API_KEY — never stage
  it. Same for OpenRouter / Supabase service-role keys.
- Don't bypass `may_I_proceed` / `release` in user-mcp-server.py for the
  new `solve_opf` tool — match the existing admission pattern.
- No emojis in code or user-facing strings.
- Don't add npm dependencies a few lines of code could replace.
- For new Next.js routes / server code, remember this is Next 16
  (`cookies()/headers()/params/searchParams` are async; `proxy.ts` not
  `middleware.ts`; Turbopack is default).
- Modal deploys take 3-5 minutes on first call after image changes; budget
  for it but do not skip the deploy when an item's acceptance demands a
  fresh endpoint.
- Do NOT introduce a CPU-vs-GPU auto-tiering heuristic. The roadmap is
  explicit: `--gpu` is a manual choice everywhere. (Phase E item 9
  produces the parity data needed to inform a future heuristic; that
  heuristic is out of scope for this loop.)
- Do NOT delete the CPU path or alter its return shape. GPU adapts to
  match CPU, not the other way around.
- If an acceptance criterion can't be verified scriptably in this
  environment (e.g. the Modal endpoint is down), say so explicitly in
  ACCEPTANCE: rather than rubber-stamping.
- Phase F mechanic: `LOOP_QUEUE.md` contains a sentinel line
  `<==NEXT-LINE-IS-TERMINAL==>` immediately above item 99 (the demos
  page). Item 99 is the **fixed terminus** and must remain the last
  `- [ ]` line in the queue at all times. Item 10 (and only item 10)
  is authorised to insert new `- [ ]` queue items — they go
  IMMEDIATELY ABOVE the sentinel line, never below it. Number them
  `10.x` (e.g. `- [ ] 10.1 Fix overflow on artifact list`) so their
  provenance is unambiguous. Edits to LOOP_QUEUE.md from item 10 are
  staged + committed by the work agent as part of that iteration's
  commit (the loop's bookkeeping commit will pick them up).
- For Phase F items, the test account credentials
  (`STEINMETZ_TEST_ACCOUNT_EMAIL` / `STEINMETZ_TEST_ACCOUNT_PASSWORD`)
  live in `.env.local` only and must never be staged. Verify
  `.env.local` is in `.gitignore` before writing them.

STATUS: done
SUMMARY: Added lib/bearer-token-validation.ts + instrumentation.ts so STEINMETZ_OPENCODE_TOKEN / STEINMETZ_INTERNAL_TOKEN get format-validated at Next.js boot, with a best-effort .env.local fallback and defense-in-depth at each read site.
ACCEPTANCE:
  - boot-time validation: PASS — instrumentation.ts calls validateBearerTokensAtBoot() in the nodejs runtime; rejects non-ASCII (incl. U+2502) and non-hex/<32-char values; loud warning; deletes the polluted env var and best-effort re-reads .env.local to recover the clean committed value.
  - unit test: PASS — `npm run test:unit` (node:test + jiti) runs 13 tests covering clean 64-char hex kept, leading/trailing whitespace trimmed, embedded U+2502 rejected, other non-ASCII rejected, uppercase hex / short / empty / null / whitespace-only rejected, plus sanitizeBearerTokenEnv scrub + clean-passthrough + missing-env paths.
  - docs: PASS — AGENTS.md gained a "Known operational gotchas" section pointing at the footgun + `env -i HOME=$HOME PATH=$PATH npm run dev` mitigation; LOOP_ALERTS.md 2026-05-26 HUMAN-REVIEW note marked [CLOSED by item 10.1].
  - build: PASS — `npm run build` compiles successfully in 21.5s; warning count unchanged from baseline (1 pre-existing Turbopack NFT warning in user-workspace.ts, not caused by this change).

VERIFIED: yes

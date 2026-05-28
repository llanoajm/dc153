## Current item (from LOOP_QUEUE.md line 91)
- [ ] 12. solve_plan MCP tool wrapping PlanningProblem.solve (ROADMAP §12)

## Attempt
1 of 5

## Context to load before working
- WORKSPACE_REDESIGN.md  (the design: ontology, schema §4, IA §5, focus→problem §6, hero planning loop §7, chat-centric UX §10, and the §11 build guardrails — READ THIS FIRST)
- REDESIGN_ROADMAP.md    (the ordered backlog this queue derives from; per-item context + acceptance, and a GUARDRAILS block — obey it)
- AGENTS.md              (project brief; CRITICAL: Next.js 16 breaking changes, and PROD is served from THIS VM via "next start" on :3000 — do not disturb it or run any next build/dev)
- STATE.md               (current build cursor / app state)
- LOOP_QUEUE.md            (the queue you're working from)
- recent tail of LOOP_JOURNAL.md

## Protocol
1. Read the context above plus any acceptance criteria nested under the
   current item in LOOP_QUEUE.md.
2. Implement the item against those acceptance criteria. Run `npx tsc --noEmit && npm run test:unit`
   (and any other checks the criteria name) before concluding.
3. Commit your code changes with a descriptive conventional-commit message.
4. Overwrite LOOP_HANDOFF.md to end with EXACTLY these fields, one per line:
   STATUS: done | partial
   SUMMARY: <1 sentence, will be embedded in the loop's tag commit>
   NEXT_STEPS: <only if partial; concrete handoff for the next agent>
   ACCEPTANCE: <which criteria pass, which don't>
   Do NOT commit LOOP_HANDOFF.md — the loop owns the bookkeeping commit.

## Constraints
- PRODUCTION IS LIVE on :3000 via `next start` from THIS checkout. NEVER run `next build`, `npm run build`, `npm run start`, or `npm run dev`, and never stop/restart anything on :3000 — a build rewrites .next and corrupts the running server. Verify ONLY with `npx tsc --noEmit && npm run test:unit`. Do NOT run Playwright/a browser against :3000 or the shared .next; defer visual checks to human review and note them in LOOP_JOURNAL.md.
- Do NOT auto-apply DDL to the live Supabase DB. Schema items produce reviewed .sql migrations + a backfill script under supabase/ for a human to apply. Never run psql/supabase ALTER/CREATE/DROP against the production database.
- END-USER MODE: NEVER edit /home/agent/zap (read-only library). Objectives/features are user-space Python that import from zap; never modify or commit to the zap repo.
- Build ADDITIVELY. Do NOT delete or revert the pre-existing refactor carried in this branch. Do NOT run `git reset --hard`, `git clean`, `git checkout -- .`, or force-push yourself — the loop harness owns rollback.
- Per-user/per-workspace isolation: end-user creations live per-workspace (filesystem + Supabase), never in shared zap/opencode git history.
- No new heavy dependencies for what a few lines solve. Match existing patterns (Tailwind utility-first; server components do IO; client components are thin and "use client"). No emojis in UI or code.
- If an item's acceptance cannot be met safely under these constraints, set its line in LOOP_QUEUE.md to `[!]` and record why in LOOP_ALERTS.md — do not force it or weaken the guardrails.

STATUS: done
SUMMARY: Added the solve_plan MCP builtin wrapping zap's PlanningProblem.solve (scripts/plan_artifact.py) — runs a small CPU capacity-expansion plan on a network artifact and writes a kind='plan' artifact carrying the loss/op_cost/inv_cost history + final per-generator build.
NEXT_STEPS:
ACCEPTANCE:
- PASS: driving the MCP server over stdio (initialize + tools/list + tools/call), solve_plan runs a small CPU plan (3 iters) on data/networks/ieee-30 end-to-end. scripts/_smoke_solve_plan.py's e2e layer wrote a real plan artifact (e0042bb4-51d9-4e16-9de5-596d567f2db9) against canonical ieee-30 f25eaa9b-…, returning a plan_artifact_id; metadata.history carries loss/op_cost/inv_cost per iteration and metadata.final_caps the per-generator before→after build.
- PASS: CPU-only (solver=HIGHS, never Modal/GPU), bounded iterations, finishes in ~1–2s — well under the per-item timeout.
- PASS (checks): `npx tsc --noEmit` exit 0 (no TS added); `npm run test:unit` 46/46 pass; solve_opf CPU smoke still green after the shared _resolve_network_artifact refactor.
- NOTE: ieee-30 generators have no capital_cost so inv_cost==0 (loss curve + capacity trajectory still demonstrate the loop). view_spec is minimal-but-renderable; the rich kind='plan' renderer is item 13's deliverable.
VERIFIED: yes

## Current item (from LOOP_QUEUE.md line 109)
- [x] 15. Intent routing in the agent (no "zap", no UUID) (ROADMAP §15)

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
SUMMARY: Reworked the grid-engineer persona (lib/user-workspace.ts, reused by lib/workspace.ts) with NL→tool routing (dispatch/Run via solve_opf vs planning/Plan via solve_plan), the [active-network] workspace-network default (never ask for a UUID), and a never-say-"zap" rule; documented both routing transcripts in REDESIGN_NOTES.md.
NEXT_STEPS: (none — item complete) Item 16 is next: ontology polish (features→Objectives UI rename, Runs & Plans tab, demote generic panels to a Library; old routes still resolve). Follow-up noted in item-14/15: thread the workspace's stored workspaces.focus into the solve_plan call so the agent passes focus explicitly (today the persona derives emissions_weight from Decarbonization intent, same routing outcome).
ACCEPTANCE: PASS — persona template updated with routing rules + workspace-network default (never asks for a UUID, never says "zap"); the [active-network] context-line format matches ChatView.tsx exactly. PASS — REDESIGN_NOTES.md documents the two phrasings routing to solve_opf (Run) vs solve_plan (Plan), used because full in-loop live-agent execution is infeasible under the guardrails (no disturbing prod opencode/:3000). PASS — `npx tsc --noEmit` exit 0; `npm run test:unit` 46/46. Visual/live-agent review deferred to human per guardrails.
VERIFIED: yes

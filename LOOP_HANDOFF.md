## Current item (from LOOP_QUEUE.md line 32)
- [x] 3. ensureWorkspace(workspaceId) + per-workspace dir (ROADMAP §3)

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
SUMMARY: Added lib/workspace.ts with ensureWorkspace(workspaceId) (per-workspace dir + .steinmetz/workspace.json primary-network record) reusing an extracted materializeWorkspaceDir, and threaded an optional workspaceId through lib/opencode-client.ts so sessions can open with cwd = the workspace dir; legacy per-user path unchanged.
NEXT_STEPS:
ACCEPTANCE: PASS — lib/workspace.ts exports ensureWorkspace(workspaceId) returning grid-workspaces/<id>/ and materializes .opencode/, features/, venv via the shared materializeWorkspaceDir, recording the primary network in .steinmetz/workspace.json (read/write/setPrimaryNetwork helpers). PASS — opencode session creation/getMessages/sendPrompt/abortSession accept a workspaceId and open with cwd = that dir (resolveWorkspaceDir in lib/opencode-client.ts); no call site passes it yet so the per-user flow is byte-identical. PASS — `npx tsc --noEmit` exit 0 and the existing per-user path (ensureUserWorkspace) still compiles; `npm run test:unit` 13/13. Note: per-workspace re-keying of Linux-account/cgroup hardening (§4.4) is intentionally deferred (gates off in dev) — ensureWorkspace does dir bootstrap + meta only.
VERIFIED: yes

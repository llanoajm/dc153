## Current item (from LOOP_QUEUE.md line 25)
- [x] 2. Backfill script: default workspace per user (ROADMAP §2)

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
SUMMARY: Added scripts/backfill_workspaces.py — an idempotent, service-role, dry-run-by-default backfill creating a default "My workspace" per user and stamping artifacts.workspace_id (canonical user_id-NULL networks left at NULL).
ACCEPTANCE: PASS — scripts/backfill_workspaces.py creates a per-user "My workspace" and sets workspace_id on their artifacts while leaving canonical (user_id NULL) networks at NULL (verified via offline simulation with assertions). PASS — --dry-run is the default, prints the planned changes, writes nothing, exits 0 (run live: clean no-op since the DB has zero owners today); real apply is gated behind explicit --apply. PASS — idempotent by design: a second --dry-run post-apply reports 0 workspaces to create and 0 artifacts to assign (asserted in the offline sim). NOTE — the legacy public.features table has no workspace_id column (migration 0001 added it to artifacts only); stamping it would require unreviewed DDL, so features are not column-updated — they are surfaced as kind='feature'/'objective' artifacts which DO get stamped, and users owning only features still get a default workspace. NOTE — migration 0001 is not yet applied to the live DB (workspaces→404, artifacts.workspace_id→400); a human must paste it before --apply yields a meaningful plan. npx tsc --noEmit exit 0; npm run test:unit 13/13 pass.
VERIFIED: yes

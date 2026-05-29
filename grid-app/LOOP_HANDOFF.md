## Current item (from LOOP_QUEUE.md line 116)
- [x] 16. Ontology polish: features→Objectives, Runs&Plans tab, demote panels (ROADMAP §16)

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
SUMMARY: Reframed the left-rail nav to the five workspace nouns (Data Source / Chats / Objectives / Runs & Plans / Library), renaming features→Objectives and Runs→Runs & Plans in the UI while every old route still resolves.
ACCEPTANCE: PASS — nav reflects the five nouns (Data Source / Chats / Objectives / Runs & Plans / Library) with the three studies top-level and the demoted generic panels under a collapsed "Library" disclosure; PASS — old routes still resolve (RAIL_ROUTES unchanged: /app/networks, /app/features, /app/runs, /app/sources, /app/glossary, /app/dashboards, /app/panels, /app/orgs, /app/settings all reachable); PASS — `npx tsc --noEmit` exit 0 and `npm run test:unit` 46/46; DEFERRED — the Playwright nav check (acceptance names it) was NOT run per the :3000/browser guardrail — `tests/flows/app-shell.spec.ts` was updated to the new top-level-noun + Library-group structure and is the spec for the human to run, alongside a visual review of the rail.

VERIFIED: yes

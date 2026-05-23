## Current item (from LOOP_QUEUE.md line 30)
- [ ] 3. Artifacts table + universal renderer (ROADMAP §2, §11.6)

## Attempt
1 of 5

## Context to load before working
- AGENTS.md         (project brief, harness-first principles, quick start)
- ROADMAP.md        (full plan; the section number in the current item refers here)
- STATE.md          (human-maintained build cursor — READ, do not restructure;
                     you MAY append a short note under "## Agent log" if useful)
- LOOP_QUEUE.md            (the queue you're working from)
- recent tail of LOOP_JOURNAL.md

## Protocol
1. Read the context above plus any acceptance criteria nested under the
   current item in LOOP_QUEUE.md.
2. Implement the item against those acceptance criteria. Run `npm run build`
   (and any other checks the criteria name) before concluding.
3. Commit your code changes with a descriptive conventional-commit message.
4. Overwrite LOOP_HANDOFF.md to end with EXACTLY these fields, one per line:
   STATUS: done | partial
   SUMMARY: <1 sentence, will be embedded in the loop's tag commit>
   NEXT_STEPS: <only if partial; concrete handoff for the next agent>
   ACCEPTANCE: <which criteria pass, which don't>
   Do NOT commit LOOP_HANDOFF.md — the loop owns the bookkeeping commit.

## Constraints
- Per-user isolation: do not commit user features/skills to zap or opencode.
- Don't modify zap source — features are user-space Python importing from zap.
- Don't use opencode.ai hosted layer (no Big Pickle / Zen / Go free models).
- No emojis in code or UI unless explicitly requested.

STATUS: done
SUMMARY: Artifacts table + RLS, lib/artifacts.ts CRUD, eight renderers + dispatcher, /api/artifacts GET+POST, /app/artifacts/[id] page; npm run build exits 0.
NEXT_STEPS:
ACCEPTANCE: schema.sql artifacts table with all required columns + RLS — pass; lib/artifacts.ts createArtifact/getArtifact/listArtifacts — pass; components/renderers/{markdown,table,chart,diff,code,file,log,dashboard}.tsx — pass; app/api/artifacts/route.ts GET (empty array when no rows) + POST create — pass; app/app/artifacts/[id]/page.tsx renders via matching renderer — pass; npm run build exits 0 — pass. NOTE: requires the user to paste updated supabase/schema.sql into the Supabase SQL editor before the table is reachable at runtime; build-time verification passes without DB access.
VERIFIED: yes

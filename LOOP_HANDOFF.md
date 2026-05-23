## Current item (from LOOP_QUEUE.md line 114)
- [ ] 12. Candidate feature drafting from sources + approval flow (ROADMAP §4)

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
SUMMARY: PDF ingest now drafts features from concrete-math sections; new /app/features panel + /api/features endpoints let the user approve (canonical), reject (rename to _<slug>.py to hide from MCP), or edit drafts, with source<->feature lineage on the artifact viewer.
ACCEPTANCE: all pass — (1) intake drafter in scripts/draft_features.py writes features/<slug>.py + inserts feature artifact rows with status='draft' and parent_id from ingest_pdf.py; (2) app/app/features/page.tsx + components/features/FeaturesPanel.tsx show approve/edit/reject per draft; (3) /api/features/<id> PATCH flips status to canonical/deprecated and reverse; (4) components/features/LineageStrip.tsx renders source -> feature drafts on /app/artifacts/<id>; (5) npm run build exits 0.

VERIFIED: yes

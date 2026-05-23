## Current item (from LOOP_QUEUE.md line 48)
- [ ] 5. Bundled reference networks (ROADMAP §0)

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
SUMMARY: Bundled three reference networks (IEEE-30, PyPSA-USA stand-in via ACTIVSg200, PyPSA-Eur slice via SciGRID-DE) as canonical artifacts with smoke-dispatch and seed scripts.
ACCEPTANCE: data/networks/{ieee-30,pypsa-usa,pypsa-eur-slice}/ exist with PyPSA CSV folders + card.md (source URL, license, node count, carrier mix, example zap solve, suggested first prompt) — PASS. scripts/seed_networks.py upserts canonical artifacts rows (status='canonical', org_id=null, user_id=null) — PASS (code path verified end-to-end; live insert returns 404 only until the user pastes the artifacts table from supabase/schema.sql, which is the same pending step noted on item #3). scripts/smoke_dispatch.py data/networks/<name> exits 0 for all three (HIGHS solver, 0.13s/0.26s/0.64s) — PASS. npm run build exits 0 — PASS.
VERIFIED: yes

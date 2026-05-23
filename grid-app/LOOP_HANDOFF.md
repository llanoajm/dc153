## Current item (from LOOP_QUEUE.md line 57)
- [ ] 6. Network-graph renderer + PyPSA folder ingest + smoke-dispatch on upload (ROADMAP §1, §6, §11.6)

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
SUMMARY: Network-graph SVG renderer + PyPSA folder upload route + detached smoke-dispatch pipeline (queued -> extracting -> embedded -> ready) wired through the Networks panel.
ACCEPTANCE: all 5 criteria pass — (1) `components/renderers/network-graph.tsx` renders bus/line topology via geo projection (when buses have x/y) or Fruchterman-Reingold force layout otherwise; (2) `app/api/upload/route.ts` accepts a multipart PyPSA folder, writes to `<workspace>/sources/<slug>/raw/`, creates a `network` artifact, and spawns the detached ingester; (3) `scripts/ingest_pypsa_folder.py` updates `metadata.pipeline_status` through queued -> extracting -> embedded -> ready (and flips `status='failed_validation'` on error); (4) Networks panel at `/app/networks` lists `kind='network'` artifacts with live status polling and rows linking to `/app/artifacts/<id>` which dispatches the universal renderer to network-graph; (5) `npm run build` exits 0.
VERIFIED: yes

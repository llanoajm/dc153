## Current item (from LOOP_QUEUE.md line 85)
- [ ] 9. Geo-map renderer + LMP heatmap + time slider (ROADMAP §11.7)

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
SUMMARY: Geo-map renderer (MapLibre + OSM tiles) with LMP overlay, signed-flow line color, DC-dashed styling, force-directed fallback, and a dispatch-hour time slider.
ACCEPTANCE: All criteria pass. (1) `components/renderers/geo-map.tsx` exists and renders via MapLibre with an OSM raster style (no Mapbox token). (2) Bus glyphs placed at lat/lon when buses have `x`/`y`; SVG force-directed fallback otherwise. (3) Lines log-thickness from `s_nom`, color from signed flow, dashed for DC. (4) Per-bus LMP color overlay anchored on the dispatch LMP extent. (5) Time slider scrubs `dispatch.hours`; both LMPs and flows re-paint on tick. (6) `npm run build` exits 0.
VERIFIED: yes

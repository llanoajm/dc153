## Current item (from LOOP_QUEUE.md line 151)
- [ ] 16. Agentic view authoring v1: dashboards as composed view specs (ROADMAP §11.8)

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
SUMMARY: Roadmap item 16 — dashboard view spec + DashboardRenderer composing every built-in renderer with shared time-slider controls, plus pin-to-rail via metadata.pinned and /api/artifacts/[id]/pin.
ACCEPTANCE: all pass — (1) schema documented in lib/view-specs/dashboard.ts with types + validator + defaults; (2) DashboardRenderer dispatches chart/table/network-graph/geo-map/run/etc and threads _controlled_hour_idx across panels (geo-map locks its slider, RunView gets a Vega rule overlay); (3) view_spec drives the layout purely from the artifact row so re-renders reproduce; (4) PinButton on /app/artifacts/[id] + /app/dashboards toggles metadata.pinned and the workspace shell surfaces a "Pinned" rail section threaded from listPinnedDashboards(); (5) npm run build exits 0.
VERIFIED: yes

## Current item (from LOOP_QUEUE.md line 12)
- [ ] 1. Streaming + tool-call cards in the chat (ROADMAP §11)

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
SUMMARY: Wired SSE streaming from opencode's /event into the chat and rendered Read/Edit/Write/Bash/Grep/Glob/WebFetch/WebSearch/Skill tool calls as inline cards (no more polling).
ACCEPTANCE: all pass — (1) `app/api/opencode/session/[id]/stream/route.ts` returns `text/event-stream` filtered to the requested sessionID with SSE heartbeats; (2) `app/app/page.tsx` consumes the stream via EventSource and the 2.5s `setInterval` polling is gone; (3) `components/chat/ToolCallCard.tsx` dispatches into `components/chat/cards/{Read,Edit,Write,Bash,Grep,Glob,WebFetch,WebSearch,Skill}.tsx` with a Generic fallback; (4) `npm run build` exits 0 (also fixed a pre-existing Next 16 prerender error in `app/login/page.tsx` by wrapping `useSearchParams` in `<Suspense>`); (5) manual curl against `/api/opencode/session/<id>/stream` hits the route (redirects to /login when unauthenticated, as expected — proxy.ts auth-gates it). Note: queue text said `/sessions/[id]/stream` (plural) but the existing API is `/session/[id]/...` (singular); kept the singular convention so the new route matches its siblings.
VERIFIED: yes

## Current item (from LOOP_QUEUE.md line 142)
- [ ] 10.2 Surface a clear inline error when `/api/opencode/session` 500s during chat bootstrap (ROADMAP §Phase F.10 — filed by item 10)

## Attempt
1 of 5

## Result

STATUS: done
SUMMARY: chat page now renders an inline error banner + Retry button above the textarea on session-bootstrap failure (and swaps the textarea placeholder to "Chat is offline — see error above"), backed by a new Playwright spec that intercepts POST /api/opencode/session with 500.
ACCEPTANCE:
  - PASS: banner with captured error renders above the textarea regardless of message-list state (app/app/page.tsx, new `!sessionId && error` block, role="alert").
  - PASS: Retry affordance re-invokes the POST (extracted bootstrapSession into a useCallback, button calls it; test asserts hits increments).
  - PASS: textarea placeholder swaps from "Loading…" to "Chat is offline — see error above" when sessionId is null and error is set.
  - PASS: tests/flows/chat.spec.ts gains a spec that intercepts POST /api/opencode/session with 500 and asserts banner + Retry button visible; full chat.spec.ts is 5/5 green.
VERIFIED: yes

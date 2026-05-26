## Current item (from LOOP_QUEUE.md line 106)
- [ ] 10. Frontend validation & bug-hunting with Playwright (substantial; 1.5× budget) (ROADMAP §Phase F.10)

## Attempt
1 of 5

## Context to load before working
- GPU_PARITY_ROADMAP.md           (Phase F.10 has the full bug-hunt prompt)
- AGENTS.md                       (Next 16 conventions + dev-stack ports)
- LOOP_QUEUE.md                   (the queue + newly-inserted 10.1 / 10.2)
- recent tail of LOOP_JOURNAL.md
- tests/flows/                    (this iteration's specs)
- playwright.config.ts            (chromium-anon / chromium-auth projects)
- tests/fixtures/global-setup.ts  (Supabase login → storageState)
- lib/artifacts.ts                (the inline UUID-validation fix)
- LOOP_ALERTS.md                  (env-pollution + stale-build gotchas)

## Protocol
1. Read the context above plus any acceptance criteria nested under the
   current item in LOOP_QUEUE.md.
2. Implement the item against those acceptance criteria. Run the relevant
   smoke for the item (e.g. `python scripts/smoke_dispatch.py data/networks/ieee-30`
   for Phase C items, `npm run build` for TS/renderer items in Phase B/D,
   `pytest /home/agent/zap/zap/tests/` for Phase A items, `modal deploy
   infra/modal/solver_app.py` after touching the Modal app) before concluding.
3. Commit your code changes with a descriptive conventional-commit message.
4. Overwrite LOOP_HANDOFF.md to end with EXACTLY these fields, one per line:
   STATUS: done | partial
   SUMMARY: <1 sentence, will be embedded in the loop's tag commit>
   NEXT_STEPS: <only if partial; concrete handoff for the next agent>
   ACCEPTANCE: <which criteria pass, which don't>
   BLOCKED: yes  ← ONLY include this line if the item is genuinely
                   blocked by an environmental constraint (not "this is
                   hard" or "I'm not sure"). When BLOCKED: yes is set,
                   the loop marks the item [!] immediately and stops
                   retrying — no more attempts. Use NEXT_STEPS to
                   describe what you tried and what blocked you.
                   Be skeptical of your own "impossible" claim:
                   enumerate concrete approaches and try the most
                   promising before declaring BLOCKED.
   Do NOT commit LOOP_HANDOFF.md — the loop owns the bookkeeping commit.

## Constraints
(unchanged — see prior handoff)

STATUS: done
SUMMARY: Playwright Phase F.10 validation suite (39 specs / 8 files) lands green; inline fix in lib/artifacts.ts stops malformed UUID route segments from 500ing; filed 10.1 + 10.2 as substantive follow-ups.
ACCEPTANCE:
 - PASS: test account `claude@steinmetz.ai` created via service-role admin API with email_confirm:true (user id 3ccffca7-cb3e-490c-9b7e-1443dba6b725); STEINMETZ_TEST_ACCOUNT_EMAIL / STEINMETZ_TEST_ACCOUNT_PASSWORD appended to grid-app/.env.local (verified gitignored under .env*; git status shows no .env.local diff).
 - PASS: tests/flows/ contains 8 spec files / 39 tests covering the 12 core flows (signup → closed-beta copy, login, /app workspace mount, chat input, networks list, run/dashboards/features rail pages, settings, orgs, logout) AND a meaningful sample of error/edge probes — auth/session (wrong password, malformed email, signed-out deep link, signed-in-on-/login redirect, first-focus), form/input (empty chat, whitespace chat, 10kb paste, empty org name disabled, empty key disabled), artifact lifecycle (malformed uuid → not 500, random uuid → not 500, RLS via API 4xx), renderers/view-spec (rail-pages smoke for 9 routes), real-world weirdness (back/forward across SPA, refresh /app), and a11y/layout (1280×800 + 375×667 horizontal-scroll, login first-focus).
 - PASS: `PLAYWRIGHT_BASE_URL=http://localhost:3001 npx playwright test` exits 0 with 39 passed (1.6m) against a clean dev server. Initial run surfaced 6 failures; 1 was a genuine 500 bug fixed inline in lib/artifacts.ts (UUID-shape guard in getArtifact), 3 were test-side locator/regex fixes (chat placeholder, org Create button disabled assertion, settings Save button disabled assertion, login first-focus moved to anon project), and 2 were environmental (corrupted shell env overriding .env.local; stale `next start` serving 500 on hashed CSS chunks). Both env issues are recorded in LOOP_ALERTS.md and converted into actionable code defenses via 10.1.
 - PASS: LOOP_QUEUE.md gained two `- [ ]` items above the `<==NEXT-LINE-IS-TERMINAL==>` sentinel — 10.1 (boot-time STEINMETZ_*_TOKEN format validation) and 10.2 (surface session-bootstrap errors in the chat UI instead of leaving the textarea stuck on "Loading…"). Both are real findings from this iteration, not invented scope.
 - PASS: dev stack verifiably running during the test run — Next.js dev on :3001 (pid 234359, restarted with `env -i HOME=$HOME PATH=$PATH` to drop the polluted STEINMETZ_*_TOKEN shell exports), opencode proxy on :4097 (pid 150921), opencode server on :4096 (pid 170200). playwright.config.ts loads .env.local without dotenv (so STEINMETZ_TEST_ACCOUNT_* reaches the global-setup fixture); base URL is `PLAYWRIGHT_BASE_URL` (defaults to http://localhost:3000). Spec comments document the launch assumption.
 - NOTE: prod `next start` on :3000 was auto-respawned by something with PPID=1 (suspected loop.sh wrapper); it serves the older build and intermittently 500s on regenerated CSS chunks. The dev server on :3001 is the one the suite is canonically green against; running against :3000 will additionally fail the malformed-uuid test until that prod build is regenerated (the fix is shipped in the same commit). LOOP_ALERTS captured the gotcha for the human.

VERIFIED: yes

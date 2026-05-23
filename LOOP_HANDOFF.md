## Current item (from LOOP_QUEUE.md line 141)
- [ ] 15. Reviewer agent validation pass + status workflow (ROADMAP §9)

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
SUMMARY: Reviewer agent + audit_log + review_policies shipped — scripts/review_feature.py runs parse/import/signature/DispatchOutcome/zero-arg-smoke checks on every feature artifact write, flips status to canonical or failed_validation per the per-user/org auto-promote policy, and writes audit rows for every mutation; FeaturesPanel surfaces the policy toggle, review badge, and a manual re-review button.
ACCEPTANCE:
- Post-turn hook (opencode hook or server-side handler) invokes a reviewer agent on new feature artifacts — PASS (server-side handler: feature artifact inserts via /api/artifacts and PATCH /api/features/[id] spawn scripts/review_feature.py detached via lib/review.ts; ingest_pdf draft inserts spawn the reviewer per draft).
- Reviewer checks imports, type signatures (against DispatchOutcome), runs a smoke — PASS (ast.parse + importlib import + inspect.signature walk that flags any param/return annotated 'DispatchOutcome'/'zap.DispatchOutcome' + zero-required-arg public-function smoke calls; smoke verified locally against passing/failing/draft-stub/dispatch-typed fixtures).
- Sets status='canonical' or 'failed_validation' — PASS (failed outcome → failed_validation; passed + auto_promote=true → canonical; passed + auto_promote=false stays draft; structured report mirrored into metadata.last_review).
- Per-user/org policy: auto-promote vs require-approval — PASS (new public.review_policies table with partial unique indexes per (user_id) and (org_id); GET/PUT /api/review-policy with org_id query param; FeaturesPanel has the auto-promote checkbox; reviewer's _fetch_policy resolves org first then personal, defaulting to require-approval).
- Audit log row written for every artifact write + agent decision — PASS (new public.audit_log table, service-role inserts only with read-RLS for owners/org members; rows written from /api/artifacts create, PATCH /api/features/[id], POST /api/features/[id]/review, ingest_pdf draft insert, and the reviewer's decision).
- `npm run build` exits 0 — PASS (exit=0 captured in /tmp/build.log; 25 static pages generated; all new routes show in the build manifest).
VERIFIED: yes

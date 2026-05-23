## Current item (from LOOP_QUEUE.md line 132)
- [ ] 14. Org scopes + shared glossary/skills/networks (ROADMAP §10)

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
SUMMARY: Org scopes shipped — orgs/org_members tables with RLS + roles, artifacts gain org_id with scope-aware policies, syncOrgContextOverlays composes org-then-personal glossary/context files into every session, /app/orgs lets owners create orgs and invite members and edit the canonical org docs.
NEXT_STEPS:
ACCEPTANCE: all four programmatic criteria pass — (1) `orgs` + `org_members` with role check + RLS live in supabase/schema.sql (user must paste into Supabase before runtime); (2) artifacts carry org_id and the RLS scope policy admits personal/org-canonical/org-member/bundled rows; (3) glossary + context_doc compose at session time via syncOrgContextOverlays which writes `glossary.org.<slug>.md` / `company-context.org.<slug>.md` and re-orders opencode.jsonc instructions so org loads first; (4) onboarding loop wired — every /app load runs syncOrgContextOverlays, /app/orgs lets owners author the canonical org glossary/context that a new member then sees on their first login; `npm run build` exits 0.
VERIFIED: yes

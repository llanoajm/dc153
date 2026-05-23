## Current item (from LOOP_QUEUE.md line 75)
- [ ] 8. Agentic data acquisition (web-fetch a named network) (ROADMAP §6.5)

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
SUMMARY: Agentic data acquisition (ROADMAP §6.5) — `/api/fetch` + MCP tool `steinmetz__fetch_network` download a URL into the workspace, write a network artifact with source_url/license/fetched_at/checksum, and reuse the upload ingestion pipeline; missing license keeps the artifact draft and prompts the user.
NEXT_STEPS:
ACCEPTANCE: Agent uses WebSearch/WebFetch via existing opencode tools — PASS (already wired); fetched data lands in `<workspace>/sources/<slug>/raw/` — PASS (scripts/fetch_url.py); artifact row has `metadata.source_url`/`.license`/`.fetched_at`/`.checksum` — PASS (artifact created via Supabase REST with these fields); license capture / prompt-before-canonical — PASS (`metadata.license_unknown=true` + `status='draft'` when license empty, AGENTS.md documents the rule); validation reuses upload pipeline — PASS (spawns `ingest_pypsa_folder.py` detached); `npm run build` exits 0 — PASS.

VERIFIED: yes

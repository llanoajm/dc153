## Current item (from LOOP_QUEUE.md line 66)
- [ ] 7. Heterogeneous upload + custom-importer skill loop (ROADMAP §1)

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
SUMMARY: Upload pipeline now tries PyPSA → MATPOWER → per-user custom importers, parks unknown formats at pipeline_status='awaiting_importer' with a CSV fingerprint, and exposes list_pending_imports / inspect_upload / write_custom_importer MCP tools plus a /api/upload/reingest/[id] route so the agent can author and re-run an importer.
ACCEPTANCE: all pass — standard converters tried first (PyPSA CSV folder then MATPOWER .m); inspection.json + awaiting_importer status surface to the agent via MCP; write_custom_importer writes features/import_<slug>.py + .opencode/skills/<slug>/SKILL.md; matching importer is auto-invoked on subsequent uploads via _try_custom_importers; hard parse failures still flip status='failed_validation'; npm run build exits 0.
VERIFIED: yes

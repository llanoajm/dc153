## Current item (from LOOP_QUEUE.md line 40)
- [ ] 4. Per-user MCP server exposing `features/` (ROADMAP §5)

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
SUMMARY: Added scripts/user-mcp-server.py (stdio JSON-RPC MCP introspecting features/) and wired it into each workspace's opencode.jsonc via lib/user-workspace.ts, with a bootstrap features/example.py stub.
NEXT_STEPS:
ACCEPTANCE: all pass — scripts/user-mcp-server.py exists and exposes public functions of features/*.py as MCP tools (verified by direct JSON-RPC); the workspace opencode.jsonc registers mcp.user-features (verified — /mcp reports {"user-features":{"status":"connected"}} after server restart); features/example.py bootstrap lands and is picked up by the server (example__hello visible in tools/list); npm run build exits 0 (one pre-existing NFT trace warning unrelated to this change).
VERIFIED: yes

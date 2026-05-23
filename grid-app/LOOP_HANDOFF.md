## Current item (from LOOP_QUEUE.md line 21)
- [ ] 2. Workspace shell (ROADMAP §11.5)

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
SUMMARY: Wrapped the authed area in a workspace shell — LeftRail (default sections per §11.5), CenterTabs (chat as default tab), RightRail (placeholder), and a Cmd/Ctrl+K CommandPalette — mounted from `app/app/layout.tsx`.
ACCEPTANCE: all pass — (1) `components/shell/{LeftRail,CenterTabs,RightRail}.tsx` (plus `WorkspaceShell.tsx` and `CommandPalette.tsx`) exist; (2) `app/app/layout.tsx` renders `<WorkspaceShell>{children}</WorkspaceShell>` with the chat (`app/app/page.tsx`) wired as the default non-closable "Chat" tab; (3) LeftRail's default sections are Chats, Sources, Networks, Datasets, Runs, Reports, Skills / Features, Glossary — collapsible to a thin strip; (4) `CommandPalette.tsx` listens for Cmd/Ctrl+K (Escape to close) and opens an empty palette modal; (5) `npm run build` exits 0. Rail nav is in-memory active-state only — no routes wired yet, since the only surface that exists is the chat; future items will add real route targets.

VERIFIED: yes

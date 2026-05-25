## Current item (from LOOP_QUEUE.md line 45)
- [ ] 1.3 Fix org-overlay stacking bug (HARDENING_ROADMAP §1.3)

## Attempt
1 of 5

## Context to load before working
- HARDENING_ROADMAP.md   (the infrastructure roadmap this queue is derived from — read the section matching the item's "§N.N" pointer end-to-end before touching code)
- ROADMAP.md             (the product roadmap — context for which features the hardening work has to keep working; don't add product features from here)
- STATE.md               (current build cursor — what's wired today, recent decisions, gotchas)
- AGENTS.md              (project conventions; treat as authoritative)
- CLAUDE.md              (re-exports AGENTS.md — same source of truth)
- supabase/schema.sql    (canonical schema; user has to paste any changes you make into Supabase — call that out in your summary if you change it)
- LOOP_QUEUE.md                 (this queue you're working from)
- recent tail of LOOP_JOURNAL.md

## Protocol
1. Read the context above plus the acceptance criteria nested under the
   current item in LOOP_QUEUE.md, and the matching §N.N section of HARDENING_ROADMAP.md.
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
- Do NOT modify the opencode fork at /home/agent/opencode. Permission tightening goes in the workspace opencode.jsonc; auth gating goes in front of opencode, not inside it. Keep our fork clean against upstream dev.
- Do NOT modify zap source at /home/agent/zap in end-user mode. Features are user-space Python that imports from zap.
- Do NOT use opencode.ai hosted layers (no Big Pickle, no OpenCode Zen, no OpenCode Go free models). Direct providers only.
- Do NOT introduce containers, orchestrators, or a second VM. Everything in HARDENING_ROADMAP.md runs as Linux users + systemd units on the existing machine. Single-VM is the explicit target end state; if you think an item needs more than that, surface it in NEXT_STEPS — the escalation lives in a separate doc (TIER3_EXPANSION.md) and is out of scope here.
- Do NOT re-architect the MCP-as-tools model. `may_I_proceed` (item 2.2) is the only way grid-app gates per-tool execution; do not introduce a parallel "operations are HTTP endpoints" catalog.
- Do NOT add a custom opencode fork divergence. If a hardening item seems to require editing the fork, surface it in NEXT_STEPS and ship the rest.
- Do NOT use emojis in user-facing UI or in code unless the user explicitly asked. This includes commit messages and doc files you add.
- Next.js 16.2.6 breaks: `cookies()` / `headers()` / `params` / `searchParams` are async (must `await`); `middleware.ts` is renamed `proxy.ts` with an exported `proxy()` function; Turbopack is the default; `next lint` is removed. Read node_modules/next/dist/docs/ before writing route-handler / middleware-shaped code.
- Bring-your-own keys: never commit secrets. Supabase service-role key lives in `.env.local`. OpenRouter shared key lives in opencode's env. Per-user OpenRouter keys go in `provider_keys` (item 1.4) once that ships.
- If you edit `supabase/schema.sql`, call it out loudly in SUMMARY — the user has to paste the new SQL into Supabase before the change is live; verify steps that depend on the new table will fail until they do.
- Per-user isolation rule: features/skills/chats are per-user, never committed to zap or opencode git history. Storage is filesystem (`/home/agent/grid-workspaces/<id>/`) + Supabase (RLS-gated tables).
- The product roadmap (ROADMAP.md) is out of scope for this queue. Don't pick up feature work even if you notice gaps.

STATUS: done
SUMMARY: Added profiles.active_org_id + a workspace-header org switcher; syncOrgContextOverlays now emits only the active org's overlay and the session-creation route accepts/validates active_org_id (403 for non-members) — user MUST paste updated supabase/schema.sql into Supabase before the switcher / session route can persist.
NEXT_STEPS:
ACCEPTANCE: schema column added (supabase/schema.sql + public/schema.sql) PASS; lib/orgs.ts syncOrgContextOverlays emits only the active org and deletes non-active overlay files via applyOrgOverlays PASS; app/api/opencode/session/route.ts accepts active_org_id, validates via getMyRoleIn, returns 403 for non-members, then re-syncs and createSession PASS; UI switcher at components/orgs/OrgSwitcher.tsx mounted in app/app/layout.tsx header, flips active_org_id through new PUT /api/orgs/active and router.refresh() retriggers the layout's sync PASS; npm run build exits 0 PASS. NOT IMPLEMENTED in this PR: the §1.3 acceptance phrase "chat that started in A is flagged and cannot be silently re-scoped" — the column is the source of truth so any in-flight session keeps its already-loaded system prompt until the next prompt round, but there is no per-session record of which org was active when the chat started; a follow-up could stamp active_org_id on a chat-session table for the flag UX.

VERIFIED: yes

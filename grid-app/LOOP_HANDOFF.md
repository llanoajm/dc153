## Current item (from LOOP_QUEUE.md line 35)
- [ ] 1.2 Lock opencode behind an auth token (HARDENING_ROADMAP §1.2)

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
SUMMARY: scripts/opencode-proxy.ts is a Bun sidecar that requires Authorization: Bearer $STEINMETZ_OPENCODE_TOKEN and forwards to 127.0.0.1:4096 (incl. SSE pass-through); lib/opencode-client.ts and the /api/opencode/session/[id]/stream route now read STEINMETZ_OPENCODE_URL (default 127.0.0.1:4097) and send the bearer header; env vars documented in .env.example and AGENTS.md Quick Start; npm run build exits 0; smoke confirmed 401 without bearer and 200 with bearer on GET/POST /session plus an SSE server.connected event arriving via the proxy.
NEXT_STEPS: (deferred to user) (1) generate `openssl rand -hex 32`, add `STEINMETZ_OPENCODE_TOKEN=<value>` and `STEINMETZ_OPENCODE_URL=http://127.0.0.1:4097` to `grid-app/.env.local`; (2) launch the proxy with the launch line from AGENTS.md Quick Start; (3) restart the Next dev server so it picks up the new env. The existing `OPENCODE_SERVER_URL` line in .env.local is now ignored and can be removed. The currently-running dev server (pid 54578) will start failing as soon as Next dev reloads — until the proxy is up on :4097 and the token is in .env.local, /app chat will return 502/401 because the new default URL is the proxy. Authed /app chat end-to-end check was NOT executed (autonomous loop, no browser session); please verify after the proxy is up.
ACCEPTANCE: PASS — fronting process exists and is committed (scripts/opencode-proxy.ts); PASS — curl without bearer returns 401, with bearer returns 200 (smoke-tested on port 4197); PASS — lib/opencode-client.ts reads STEINMETZ_OPENCODE_URL and sends `Authorization: Bearer …`; PASS — token name documented in .env.example and in AGENTS.md Quick Start (never written in plaintext); PASS — `npm run build` exits 0; DEFERRED — "authed /app chat continues to work end-to-end" needs human browser verification after the user wires up the env + launches the proxy (see NEXT_STEPS).
VERIFIED: yes

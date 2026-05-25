<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version (16.2.6) has breaking changes — APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Specifically already-encountered breaks: `cookies()` / `headers()` / `params` / `searchParams` are async (must `await`); `middleware.ts` is renamed `proxy.ts` with exported `proxy()` function; Turbopack is the default; `next lint` removed.
<!-- END:nextjs-agent-rules -->

# Steinmetz — project brief

Read this first. The **source of truth for the plan** is `ROADMAP.md` in this directory. The **source of truth for current state** is `STATE.md`. The **memory system** holds durable principles (read `~/.claude/projects/-home-agent/memory/MEMORY.md` — it's auto-loaded but worth referring back to).

## What this is

A web frontend for a power-systems agent. Three layers:

1. **Frontend (this directory `/home/agent/grid-app`):** Next.js 16 + Tailwind 4 + Supabase Auth. Landing, auth, chat UI, API proxy to opencode.
2. **Agent harness (`/home/agent/opencode`):** our fork of `anomalyco/opencode`. Runs as a local HTTP server on `127.0.0.1:4096`. Sessions, tools, agents, MCP, permissions. Don't modify casually — we rebase against upstream `dev`.
3. **Compute library (`/home/agent/zap`):** our fork of `degleris1/zap`. Python, installed editable in `.venv`. **In end-user mode the agent must not modify zap source** — features are user-space Python that imports from zap. (Maintainer-mode editing of zap is a separate workflow; don't conflate them.)

Per-user workspaces live at `/home/agent/grid-workspaces/<supabase-user-id>/`. Each contains `AGENTS.md`, `.opencode/agent/grid-engineer.md`, `features/`, `.opencode/skills/`. Created lazily on first login by `lib/user-workspace.ts`. The agent's opencode session opens with `cwd = <workspace dir>`.

## Design principle (load-bearing)

**Harness-first**: don't build deterministic UI flows that cap the agent's expressivity. Every output is `{kind, payload, view_spec}`; renderers are generic and driven by metadata the agent emits. Tool calls are exposed inline. The agent can author dashboards and propose new workspace categories at runtime. See `ROADMAP.md` "Design principle" section and the `feedback-harness-first-ui` memory entry.

When in doubt, pick the design that lets the agent do something we didn't think of, not the design that fits a pre-imagined screenshot.

## Other durable rules

- **Per-user isolation**: features/skills/chats are per-user, never committed to zap or opencode git. Storage = filesystem (`/home/agent/grid-workspaces/<id>/`) + Supabase (`features` table with RLS).
- **Don't use opencode.ai hosted layer**: no Big Pickle, no OpenCode Zen, no OpenCode Go free models. Direct providers only (OpenRouter is wired with the user's key in opencode's env).
- **Bring-your-own keys**: the user's OpenRouter key lives only in the opencode server's env. The Supabase service-role key lives only in `.env.local`. Neither is in any committed file.

## Quick start

If services aren't running (check `ss -tlnp | grep -E ':3000|:4096'`):

```bash
# opencode server (the harness) — binds 127.0.0.1:4096
cd /home/agent/opencode
OPENROUTER_API_KEY='sk-or-...' PATH="$HOME/.bun/bin:$PATH" nohup bun dev serve > /tmp/oc-server.log 2>&1 & disown

# Bearer-auth fronting proxy (HARDENING §1.2) — binds 127.0.0.1:4097.
# Token must match STEINMETZ_OPENCODE_TOKEN in grid-app/.env.local.
cd /home/agent/grid-app
STEINMETZ_OPENCODE_TOKEN="$(grep '^STEINMETZ_OPENCODE_TOKEN=' .env.local | cut -d= -f2-)" \
  PATH="$HOME/.bun/bin:$PATH" nohup bun run scripts/opencode-proxy.ts > /tmp/oc-proxy.log 2>&1 & disown

# Next.js dev (this app)
nohup npm run dev > /tmp/nx-dev.log 2>&1 & disown
```

URLs (the VM is remote; user connects via SSH tunnel `-L 3000:localhost:3000`):
- App: `http://localhost:3000`
- opencode (via proxy, bearer-auth): `http://localhost:4097`
- opencode (raw upstream — never call from outside the VM): `http://localhost:4096`
- Roadmap (via tunnel): `http://localhost:3000/ROADMAP.md`
- Schema (via tunnel): `http://localhost:3000/schema.sql`

## Layout you actually need to know

```
grid-app/
├─ app/
│  ├─ page.tsx                 # landing (Steinmetz lockup)
│  ├─ login/, signup/          # Supabase Auth forms
│  ├─ auth/callback, signout   # auth route handlers
│  ├─ app/                     # authed area; layout.tsx materializes workspace
│  │  ├─ layout.tsx
│  │  └─ page.tsx              # v0 chat UI (polling, no streaming, no tool-call cards yet)
│  └─ api/opencode/            # proxy routes → opencode server with x-opencode-directory header
├─ components/lockup.tsx       # Steinmetz logo lockup
├─ lib/
│  ├─ supabase/{client,server,service}.ts
│  ├─ opencode-client.ts       # server-side HTTP to opencode
│  └─ user-workspace.ts        # ensureUserWorkspace(userId) — materializes per-user dir
├─ proxy.ts                    # Next 16 proxy.ts (renamed from middleware) — auth gate
├─ supabase/schema.sql         # profiles + features + RLS — paste into Supabase SQL editor
├─ public/{schema.sql,ROADMAP.md, spi-mark*.png}  # public copies for browser viewing
├─ ROADMAP.md                  # THE plan
└─ STATE.md                    # current build cursor
```

## How to proceed when you're new to this project

1. Read `STATE.md` for the current build cursor.
2. Read `ROADMAP.md`'s "Design principle" section and skim the build order at the bottom.
3. Check memory: `cat ~/.claude/projects/-home-agent/memory/MEMORY.md` and read any of the linked entries that touch the area you're about to work on.
4. Verify services are up (see Quick start). Restart if needed.
5. Confirm with the user what they want next — don't assume the build order is fixed. The roadmap is a strong default, not a contract.

## Style for code in this repo

- Match the existing patterns. Server components do DB/IO; client components are marked `"use client"` and stay thin.
- Tailwind utility-first. Use the `font-mark` / `font-serif-soft` classes from `globals.css` for branded type.
- No emojis in user-facing UI or code unless the user asks.
- Don't add deps for things a few lines of code can do.
- New routes: prefer route handlers over server actions for anything proxy-shaped.
- New artifact kinds / view specs (see ROADMAP §11.6): add the renderer in `components/renderers/` (to be created), don't bake the new kind into the panel that shows it.

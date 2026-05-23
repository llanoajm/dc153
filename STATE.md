# Steinmetz — current state

Build cursor. Update when you finish something or change direction. Last updated: 2026-05-23.

## What's wired (works today)

- **Frontend (`/home/agent/grid-app`)**: Next.js 16, Tailwind 4, Supabase Auth.
  - Landing `/` — Steinmetz lockup, sign-in / create-account.
  - `/login`, `/signup` — email+password forms.
  - `/auth/callback`, `/auth/signout` — route handlers.
  - `/app` — authed area. Materializes the user's workspace on first visit. Bare v0 chat: user message in, polls for assistant response, only text parts visible.
  - `proxy.ts` — Next 16 proxy gating `/app/*` and `/api/opencode/*` on a Supabase session.
- **Backend services on the VM**:
  - opencode server (our fork) on `127.0.0.1:4096`, OpenRouter key in env, persistent SQLite at `~/.local/share/opencode/`.
  - Next.js dev on `0.0.0.0:3000`.
  - Both started detached (`nohup ... & disown`); verify with `ss -tlnp | grep -E ':3000|:4096'`.
- **Per-user workspace** at `/home/agent/grid-workspaces/<supabase-user-id>/`:
  - Auto-materialized in `lib/user-workspace.ts` on first `/app` request.
  - Contains `AGENTS.md` (workspace conventions), `.opencode/agent/grid-engineer.md` (primary agent persona), empty `features/` + `.opencode/skills/`.
- **zap library** at `/home/agent/zap`, installed editable in `.venv`. Treated as read-only by end-user-mode agents.
- **Supabase**: project `hfqkimojlihvdesokkqr`. Auth on. Schema at `supabase/schema.sql` (also served at `/schema.sql`). **User has been instructed to paste the schema into the SQL editor**; verify with the user before relying on `profiles` / `features` tables.
- **Branding**: matches `llanoajm/steinmetz-web/index.html`. Sora + EB Garamond, black-on-white, centered.

## What is NOT wired (deferred)

Everything past v0. See `ROADMAP.md` build order for the prioritized list. Highest-impact gaps:

- ~~**Tool-call cards in chat**~~ Done (2026-05-23): cards for Read, Edit, Write, Bash, Grep, Glob, WebFetch, WebSearch, Skill in `components/chat/cards/` + dispatcher at `components/chat/ToolCallCard.tsx`; unknown tools fall back to a generic JSON card. Reasoning parts collapse behind a `<details>`.
- **Workspace shell** — there's a header strip and a chat. No left rail, tabs, right rail, command palette.
- **Artifacts table + universal renderer** — Supabase has the `features` table but nothing writes to it; no `artifacts` table yet; no `view_spec` rendering.
- ~~**Streaming** — current chat polls every 2.5s during pending state.~~ Done (2026-05-23): SSE proxy at `app/api/opencode/session/[id]/stream/route.ts` filtered to the session, chat consumes via EventSource (no polling).
- **Per-user MCP server exposing `features/`** — agent re-reads its own code each session.
- **Bundled reference networks** — none. Workspace starts empty.
- **Geo-map, network-graph renderer** — nothing.
- **Source document ingestion (PDF/PPTX/etc) → glossary / company-context** — nothing.
- **Web-fetch data acquisition** — nothing.

## Known operational gotchas

- The OpenRouter key was pasted in chat earlier; **user should rotate it**. Same for the Supabase service-role key.
- Background processes I started via `nohup ... & disown` survive my agent session, but **they don't survive a VM reboot**. If the user reboots, restart with the Quick Start commands in `AGENTS.md`.
- `proxy.ts` matcher excludes images and most static assets, but if you add a new public file type, double-check it doesn't get caught by the auth gate.
- Supabase: if email confirmation is enabled in their Auth settings, signup→`/app` is a two-step flow (signup → check email → click link → `/app`). For local dev they should disable it.
- The default model on chat is `~anthropic/claude-sonnet-latest` via OpenRouter, default agent is `grid-engineer`. Hardcoded in `lib/opencode-client.ts`. Move to user-settable when adding settings UI.

## Decisions made during build

- **Chose Next.js 16** (was released; we hit some new-version breakages, see `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`).
- **Hard fork zap to `llanoajm/zap`** (committed `.opencode/` bootstrap, reset main to that bootstrap; the M2 nitrogen-emissions demo commit lives on branch `demo/m2-maintainer-mode-test` for reference).
- **Reverted the "agent commits to zap" model** after user clarified per-user isolation. End-user features go to per-user workspace + Supabase, never to the zap repo.
- **Chose OpenRouter** as inference provider (user's key, no opencode.ai hosted layer).
- **Picked port 3000** for Next.js (we killed the legacy `packages/app` from the opencode monorepo earlier).

## What to do next (suggested)

Per ROADMAP build order, item #2: **workspace shell** (left rail + center tabs + right rail + Cmd+K palette).
Item #1 (streaming + tool-call cards) shipped on 2026-05-23.

Alternative starting points if user wants something else:
- Item #3 artifacts table + universal renderer (1 week) — the longest-leverage backbone.
- Item #4 per-user MCP server exposing `features/` (1–2 days).

## Agent log

- 2026-05-23 — streaming + tool-call cards landed. SSE proxy at `/api/opencode/session/[id]/stream` filters opencode `/event` to the requested sessionID and re-emits as SSE. Chat reducer maintains `messages: UiMessage[]` keyed by id; deltas accumulate into part fields. Login page now wraps `useSearchParams` in `<Suspense>` so `next build` passes (pre-existing issue surfaced when build was actually run).

Confirm with the user before diving in.

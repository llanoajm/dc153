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
- ~~**Workspace shell**~~ Done (2026-05-23): `components/shell/{WorkspaceShell,LeftRail,CenterTabs,RightRail,CommandPalette}.tsx` mounted in `app/app/layout.tsx`. Left rail has the default sections (Chats, Sources, Networks, Datasets, Runs, Reports, Skills/Features, Glossary); center pane is a tab bar with Chat as the default (closable=false) tab; right rail is contextual/placeholder, collapsed by default; Cmd/Ctrl+K opens an empty palette. Rail items don't route yet — they just track active state in-memory.
- ~~**Artifacts table + universal renderer**~~ Done (2026-05-23): `artifacts` table in `supabase/schema.sql` with RLS (own-rows + canonical-shared). `lib/artifacts.ts` exposes `createArtifact`/`getArtifact`/`listArtifacts`. `components/renderers/{markdown,table,chart,diff,code,file,log,dashboard}.tsx` exist; dispatch via `components/renderers/index.tsx`. `/api/artifacts` GET/POST + `/app/artifacts/[id]` view page. **User must paste updated `supabase/schema.sql` into the Supabase SQL editor** before the table is reachable.
- ~~**Streaming** — current chat polls every 2.5s during pending state.~~ Done (2026-05-23): SSE proxy at `app/api/opencode/session/[id]/stream/route.ts` filtered to the session, chat consumes via EventSource (no polling).
- **Per-user MCP server exposing `features/`** — agent re-reads its own code each session.
- ~~**Bundled reference networks**~~ Done (2026-05-23): `data/networks/{ieee-30,pypsa-usa,pypsa-eur-slice}/` ship as PyPSA CSV folders with per-network `card.md`. `scripts/smoke_dispatch.py <dir>` solves a 1-hour dispatch via zap (HIGHS → CLARABEL → SCS fallback) and `scripts/seed_networks.py` upserts canonical (`user_id=null`, `status='canonical'`) rows into `public.artifacts`. `scripts/build_networks.py` regenerates the folders from MATPOWER + `pypsa.examples.scigrid_de`.
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

Per ROADMAP build order, item #8: **agentic data acquisition (web-fetch a
named network)**. Items #1–#7 shipped on 2026-05-23.

Alternative starting points if user wants something else:
- Wire the rail sections to actual routes / panels before shipping more backbone work.
- Replace the ACTIVSg200 stand-in under `data/networks/pypsa-usa/` with a
  real PyPSA-USA snapshot once the upload pipeline lands.

## Agent log

- 2026-05-23 — streaming + tool-call cards landed. SSE proxy at `/api/opencode/session/[id]/stream` filters opencode `/event` to the requested sessionID and re-emits as SSE. Chat reducer maintains `messages: UiMessage[]` keyed by id; deltas accumulate into part fields. Login page now wraps `useSearchParams` in `<Suspense>` so `next build` passes (pre-existing issue surfaced when build was actually run).
- 2026-05-23 — workspace shell landed. `components/shell/WorkspaceShell.tsx` composes LeftRail (collapsible, default sections per ROADMAP §11.5), CenterTabs (chat as default non-closable tab; new tabs would be closable), RightRail (collapsed by default — placeholder copy), and CommandPalette (Cmd/Ctrl+K toggles a modal; empty state for now). AppLayout was switched from `<div flex-1>{children}</div>` to mounting `<WorkspaceShell>{children}</WorkspaceShell>`; added `min-h-0` so the chat's nested flex sizing keeps working. Rail nav is in-memory `active` only — no routing yet.
- 2026-05-23 — bundled reference networks landed. Three folders under `data/networks/`: `ieee-30` (30 buses, 6 generators — IEEE classic via MATPOWER case30), `pypsa-usa` (200 buses, 49 generators — Texas A&M ACTIVSg200 as US-Western stand-in until real PyPSA-USA snapshot is ingested), `pypsa-eur-slice` (585 buses, 1423 generators, 24-hour SciGRID-DE slice via `pypsa.examples.scigrid_de`). Each folder holds a PyPSA CSV export plus a `card.md` (source URL, license, scale, carrier mix, example zap solve, suggested first prompt). `scripts/build_networks.py` regenerates the folders from MATPOWER + scigrid_de; cached MATPOWER `.m` sources live in `data/_cache/`. `scripts/smoke_dispatch.py <net_dir>` loads the folder via pypsa, hands it to `zap.importers.load_pypsa_network`, and solves a 1-snapshot dispatch (HIGHS preferred, CLARABEL → SCS fallback). Smoke times: 0.13s / 0.26s / 0.64s. `scripts/seed_networks.py` runs the smoke per network and upserts canonical rows (`user_id=null`, `org_id=null`, `status='canonical'`) into `public.artifacts` using the service-role key from `.env.local`; supports `--dry-run`. Two-step check-then-insert is used instead of PostgREST `on_conflict` so we don't need a unique index on `slug`. **The seed will 404 until the user pastes the latest `supabase/schema.sql` into Supabase**, but the smoke acceptance check is fully decoupled and passes today. Workaround for a pandas-3.0 + zap clash: `scripts/_pypsa_compat.py` patches `DataFrame.values` / `Series.values` to return writable copies (zap mutates those arrays in-place with `+=` / `/=`, which Copy-on-Write rejects). Tiny MATPOWER `.m` parser at `scripts/_matpower.py`. Default solver is HIGHS because CLARABEL diverged on the SciGRID DE problem.
- 2026-05-23 — heterogeneous upload + custom-importer loop landed. `scripts/ingest_pypsa_folder.py` now runs a converter chain on upload: PyPSA CSV folder → MATPOWER `.m` (via `scripts/_matpower.py` round-tripped through PyPSA) → custom importers under `<workspace>/features/import_*.py` (each exposing `matches(folder) -> bool` and `convert(folder, dest) -> None`). If none match, the script writes `sources/<slug>/inspection.json` with a SHA-1 schema fingerprint + per-CSV column lists + sample rows and flips `pipeline_status='awaiting_importer'` (status stays `draft`, not `failed_validation` — the upload isn't broken, we just don't know how to read it). Hard parse failures still go to `failed_validation`. The per-user MCP server (`scripts/user-mcp-server.py`) now ships three built-in tools alongside feature-discovered ones: `steinmetz__list_pending_imports`, `steinmetz__inspect_upload(slug)`, `steinmetz__write_custom_importer(slug, python_source, skill_markdown)`. `lib/user-workspace.ts` passes `STEINMETZ_WORKSPACE_DIR` to the MCP server and the workspace AGENTS.md documents the importer convention end-to-end. New route `app/api/upload/reingest/[id]/route.ts` resets a `network` artifact to `queued` and re-spawns the detached ingester so the user (or agent) can re-trigger the pipeline after authoring an importer. Subsequent uploads of the same schema are handled automatically — `_try_custom_importers` iterates `features/import_*.py` and the first whose `matches()` returns True wins.
- 2026-05-23 — artifacts table + universal renderer landed. Schema: `public.artifacts(id, user_id, org_id, kind, name, slug, fs_path, storage_path, metadata jsonb, view_spec jsonb, parent_id, parent_session_id, status, created_at, updated_at)` with indexes on `(user_id, created_at desc)`, `kind`, `parent_id`. RLS: select-own + canonical-shared rows (user_id null + status='canonical') for ROADMAP §0 seeded networks; insert/update/delete restricted to `auth.uid() = user_id`. `lib/artifacts.ts` exposes `createArtifact`/`getArtifact`/`listArtifacts`. `components/renderers/{markdown,table,chart,diff,code,file,log,dashboard}.tsx` + a `types.ts` carrying `rendererFor()` (dispatch by `view_spec.renderer` → `kind` fallback → `file`). `components/renderers/index.tsx` is the universal `<ArtifactRenderer>`. Chart renderer ships a tiny inline bar preview + Vega-Lite spec inspector — Vega-Lite proper wasn't pulled in yet (no chart artifact to render through it). Diff is a simple line-by-line unified diff. Routes: `app/api/artifacts/route.ts` (GET list with `kind`/`status`/`session`/`limit` query params; POST create) and `app/app/artifacts/[id]/page.tsx` (uses `getArtifact` + `<ArtifactRenderer>`). Proxy gates `/api/artifacts` alongside `/api/opencode`. Public schema copy regenerated. The user must paste the updated `supabase/schema.sql` into the SQL editor before any insert/select succeeds against `public.artifacts`.

Confirm with the user before diving in.

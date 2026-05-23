# Steinmetz

Web client for Steinmetz — power-systems agent backed by the zap optimization library.

## Local stack

This app expects two backend services running locally:

1. **opencode server** (our fork) at `127.0.0.1:4096` — the agent harness.
   Start it from `/home/agent/opencode`:
   ```bash
   OPENROUTER_API_KEY=sk-or-... bun dev serve
   ```
2. **zap** (Python library) installed at `/home/agent/zap/.venv` — the
   compute layer. Already installed in editable mode.

This Next.js app runs on a separate port (default 3000) and proxies agent
calls to opencode via `/api/opencode/*`.

## Supabase setup (one-time)

1. Run `supabase/schema.sql` in your Supabase project's SQL editor to create
   the `profiles` and `features` tables with RLS.
2. In Supabase Auth settings, decide whether to require email confirmation.
   For local dev, disabling it makes signup → use a single-step flow.

## Environment

Configure `.env.local` (already created locally, never commit):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENCODE_SERVER_URL=http://127.0.0.1:4096
GRID_WORKSPACE_ROOT=/home/agent/grid-workspaces
```

## Run dev

```bash
npm run dev
```

Open http://localhost:3001 (we use 3001 to keep 3000 free for the legacy
opencode `packages/app` if running alongside).

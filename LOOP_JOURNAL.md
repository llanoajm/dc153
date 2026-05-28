# Loop journal — Workspaces redesign

Append-only notes per item. Visual/manual checks deferred to human review go here.

- 2026-05-28 — Item 1 (additive schema migration: workspaces table + artifacts.workspace_id) — DONE.
  - Added `supabase/migrations/0001_workspaces.sql`: `workspaces` table (verbatim from WORKSPACE_REDESIGN.md §4.1, incl. the `check ((user_id is null) <> (org_id is null))` one-owner constraint, `focus text[]`, FKs to `auth.users`/`public.orgs`/`public.artifacts`), the two `(user_id|org_id, created_at desc)` indexes, all 4 RLS policies (select/insert/update/delete, mirroring artifacts via `is_org_member`/`has_org_role`), plus `artifacts.workspace_id` nullable column (§4.2) + `artifacts_workspace_created_idx`. Every object guarded (`create table/index if not exists`, `add column if not exists`, `drop policy if exists` → `create policy`) so it re-pastes cleanly on top of `schema.sql`.
  - Folded the identical objects into `supabase/schema.sql` (appended after `tool_runs`, so the `public.orgs`/`public.artifacts`/`is_org_member`/`has_org_role` FK + helper dependencies already exist) — a fresh paste is now complete.
  - Parse-check: no local postgres server or `initdb`/`postgres` binary on this VM (only the `psql` client), so a `psql -f` against a throwaway pg wasn't possible. Used `pglast` 7.13 (libpg_query — the actual PostgreSQL C parser) installed to a throwaway dir `/tmp/sqlparse-check`. Both files parse (migration: 14 statements; schema.sql: 122). The schema.sql+migration concatenation parses (136 statements), confirming the migration is re-pasteable on top. NOT applied to the live Supabase DB.
  - Verification: `npx tsc --noEmit` exit 0; `npm run test:unit` 13/13 pass. No TS added this item.
  - Human follow-up: a person must paste the migration (or the updated `schema.sql`) into the Supabase SQL editor before the `workspaces` table / `artifacts.workspace_id` are live. No UI in this item, so no visual review pending.

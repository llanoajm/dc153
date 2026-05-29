-- Migration 0001 — workspaces table + artifacts.workspace_id  (REDESIGN_ROADMAP §1)
--
-- Additive and idempotent: every object uses `create table if not exists` /
-- `create index if not exists` / `add column if not exists` / `drop policy if
-- exists` so this re-pastes cleanly on top of `supabase/schema.sql` without
-- dropping or breaking anything. Apply in the Supabase SQL editor (a human
-- runs this — the autonomous loop never touches the live DB).
--
-- A Workspace = a Grid (data source) + an Intent (focus) + its Objectives,
-- Runs, Plans, and chat (see WORKSPACE_REDESIGN.md §3). It can be owned by a
-- single user (personal) or by an org. `artifacts.workspace_id` groups an
-- artifact under a workspace; it is nullable so canonical/template networks
-- (user_id NULL) stay shared with workspace_id NULL. RLS is unchanged and
-- still governs visibility — workspace_id is a grouping key, not a new
-- visibility axis.

-- ============================================================================
-- workspaces  (WORKSPACE_REDESIGN.md §4.1)
-- ============================================================================
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,   -- personal owner
  org_id  uuid references public.orgs(id) on delete cascade,  -- or org-owned
  name text not null,
  focus text[] not null default '{}',          -- intent tags (see §6)
  primary_network_id uuid references public.artifacts(id) on delete set null,
  cover_image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check ((user_id is null) <> (org_id is null)) -- exactly one owner kind
);

create index if not exists workspaces_user_created_idx on public.workspaces (user_id, created_at desc);
create index if not exists workspaces_org_created_idx  on public.workspaces (org_id, created_at desc);

alter table public.workspaces enable row level security;

-- RLS mirrors artifacts: own personal, or org you're a member of.
drop policy if exists "workspaces select scope" on public.workspaces;
create policy "workspaces select scope" on public.workspaces for select using (
  auth.uid() = user_id or (org_id is not null and public.is_org_member(org_id)));

drop policy if exists "workspaces insert scope" on public.workspaces;
create policy "workspaces insert scope" on public.workspaces for insert with check (
  (org_id is null and auth.uid() = user_id)
  or (org_id is not null and public.is_org_member(org_id)));

drop policy if exists "workspaces update scope" on public.workspaces;
create policy "workspaces update scope" on public.workspaces for update using (
  auth.uid() = user_id or (org_id is not null and public.has_org_role(org_id, array['owner','admin'])));

drop policy if exists "workspaces delete scope" on public.workspaces;
create policy "workspaces delete scope" on public.workspaces for delete using (
  auth.uid() = user_id or (org_id is not null and public.has_org_role(org_id, array['owner','admin'])));

-- ============================================================================
-- artifacts.workspace_id  (WORKSPACE_REDESIGN.md §4.2)
--
-- Nullable grouping key. Canonical/template networks keep workspace_id NULL
-- (shared, usable as any workspace's data source). RLS is unchanged.
-- ============================================================================
alter table public.artifacts add column if not exists workspace_id uuid
  references public.workspaces(id) on delete cascade;

create index if not exists artifacts_workspace_created_idx
  on public.artifacts (workspace_id, created_at desc);

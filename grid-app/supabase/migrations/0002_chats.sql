-- Migration 0002 — chats table  (REDESIGN_ROADMAP §4 / WORKSPACE_REDESIGN.md §10)
--
-- Additive and idempotent: every object uses `create table if not exists` /
-- `create index if not exists` / `drop policy if exists` so this re-pastes
-- cleanly on top of `supabase/schema.sql` (which already carries 0001's
-- workspaces table). Apply in the Supabase SQL editor — the autonomous loop
-- never touches the live DB.
--
-- Why a dedicated table (not a kind='chat' artifact): a chat is not a
-- renderable artifact — it's a durable handle that maps a workspace to an
-- opencode session id + a human title, ordered by recency for the sidebar
-- history list (§10). opencode sessions are otherwise ephemeral with no
-- durable list; this table is that list. Messages still live in opencode and
-- are reloaded by session id when a past chat is reopened, so we store the
-- mapping, not the transcript.
--
-- RLS mirrors workspaces/artifacts: own personal, or an org you're a member
-- of. Ownership tracks the chat's workspace (personal vs org-owned).

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,   -- personal owner
  org_id  uuid references public.orgs(id) on delete cascade,  -- or org-owned
  session_id text not null,                    -- opencode session id
  title text not null default 'New chat',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_message_at timestamptz default now(),
  check ((user_id is null) <> (org_id is null)) -- exactly one owner kind
);

create index if not exists chats_workspace_recent_idx
  on public.chats (workspace_id, last_message_at desc);
create index if not exists chats_user_recent_idx
  on public.chats (user_id, last_message_at desc);
create index if not exists chats_session_idx on public.chats (session_id);

alter table public.chats enable row level security;

drop policy if exists "chats select scope" on public.chats;
create policy "chats select scope" on public.chats for select using (
  auth.uid() = user_id or (org_id is not null and public.is_org_member(org_id)));

drop policy if exists "chats insert scope" on public.chats;
create policy "chats insert scope" on public.chats for insert with check (
  (org_id is null and auth.uid() = user_id)
  or (org_id is not null and public.is_org_member(org_id)));

drop policy if exists "chats update scope" on public.chats;
create policy "chats update scope" on public.chats for update using (
  auth.uid() = user_id or (org_id is not null and public.has_org_role(org_id, array['owner','admin'])));

drop policy if exists "chats delete scope" on public.chats;
create policy "chats delete scope" on public.chats for delete using (
  auth.uid() = user_id or (org_id is not null and public.has_org_role(org_id, array['owner','admin'])));

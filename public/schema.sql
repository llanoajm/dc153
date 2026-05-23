-- Steinmetz schema — run this once in your Supabase project's SQL editor.
-- This sets up profiles + features tables with row-level security so each user
-- only sees their own features.

-- ============================================================================
-- profiles
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- A user can read/update their own profile row.
drop policy if exists "profiles select own" on public.profiles;
create policy "profiles select own" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = id);

-- Auto-insert a profile row when a user signs up.
create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- features
-- ============================================================================
create table if not exists public.features (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  code text not null,
  skill_md text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, slug)
);

create index if not exists features_user_created_idx
  on public.features (user_id, created_at desc);

alter table public.features enable row level security;

drop policy if exists "features select own" on public.features;
create policy "features select own" on public.features
  for select using (auth.uid() = user_id);
drop policy if exists "features insert own" on public.features;
create policy "features insert own" on public.features
  for insert with check (auth.uid() = user_id);
drop policy if exists "features update own" on public.features;
create policy "features update own" on public.features
  for update using (auth.uid() = user_id);
drop policy if exists "features delete own" on public.features;
create policy "features delete own" on public.features
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- orgs + org_members  (ROADMAP §10)
--
-- Multi-user posture. An org groups users; artifacts may be personal
-- (`user_id` set, `org_id` null) or org-scoped (`org_id` set; `user_id` may
-- be null for canonical org-wide rows or set to the author of the
-- contribution). Roles: owner > admin > member.
-- ============================================================================
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz default now(),
  primary key (org_id, user_id)
);

create index if not exists org_members_user_idx
  on public.org_members (user_id);

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

-- Membership-lookup helper. SECURITY DEFINER so RLS policies referencing it
-- don't recurse into org_members's own policy chain.
create or replace function public.is_org_member(o uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where org_id = o and user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(o uuid, want_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where org_id = o and user_id = auth.uid() and role = any(want_roles)
  );
$$;

-- A member of an org can read it; owners/admins can edit. Creation goes
-- through a server route holding the service role (it also seeds the
-- creator's `owner` membership atomically).
drop policy if exists "orgs select if member" on public.orgs;
create policy "orgs select if member" on public.orgs
  for select using (public.is_org_member(id));

drop policy if exists "orgs update if owner_admin" on public.orgs;
create policy "orgs update if owner_admin" on public.orgs
  for update using (public.has_org_role(id, array['owner', 'admin']));

-- Members can see the membership list of orgs they belong to.
drop policy if exists "org_members select if member" on public.org_members;
create policy "org_members select if member" on public.org_members
  for select using (public.is_org_member(org_id));

-- Members can leave (delete their own row). Owners/admins can manage everyone
-- in the org.
drop policy if exists "org_members delete self or admin" on public.org_members;
create policy "org_members delete self or admin" on public.org_members
  for delete using (
    auth.uid() = user_id
    or public.has_org_role(org_id, array['owner', 'admin'])
  );

drop policy if exists "org_members insert if owner_admin" on public.org_members;
create policy "org_members insert if owner_admin" on public.org_members
  for insert with check (
    public.has_org_role(org_id, array['owner', 'admin'])
  );

drop policy if exists "org_members update if owner_admin" on public.org_members;
create policy "org_members update if owner_admin" on public.org_members
  for update using (
    public.has_org_role(org_id, array['owner', 'admin'])
  );

-- Atomic org creation: callable by any authenticated user. Creates an org +
-- inserts the caller as owner in a single transaction. Returns the new org.
create or replace function public.create_org(p_name text, p_slug text)
returns public.orgs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.orgs;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  insert into public.orgs (name, slug, created_by)
  values (p_name, p_slug, auth.uid())
  returning * into v_org;
  insert into public.org_members (org_id, user_id, role)
  values (v_org.id, auth.uid(), 'owner');
  return v_org;
end;
$$;

revoke all on function public.create_org(text, text) from public;
grant execute on function public.create_org(text, text) to authenticated;

-- ============================================================================
-- artifacts
--
-- The single first-class concept (ROADMAP §2). Every harness output —
-- documents, datasets, networks, runs, features, glossary entries, generated
-- views — lands here with a declared `view_spec` so the universal renderer
-- (components/renderers/*) can display it.
--
-- Scope rules:
--   personal:        user_id = auth.uid(), org_id = null
--   org canonical:   org_id set, user_id null, status='canonical'
--   org member work: org_id set, user_id = author
--   bundled:         user_id is null, org_id is null, status='canonical'
-- ============================================================================
create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  org_id uuid,
  kind text not null,
  name text not null,
  slug text,
  fs_path text,
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  view_spec jsonb not null default '{}'::jsonb,
  parent_id uuid references public.artifacts(id) on delete set null,
  parent_session_id text,
  status text not null default 'draft',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists artifacts_user_created_idx
  on public.artifacts (user_id, created_at desc);
create index if not exists artifacts_kind_idx
  on public.artifacts (kind);
create index if not exists artifacts_parent_idx
  on public.artifacts (parent_id);
create index if not exists artifacts_org_created_idx
  on public.artifacts (org_id, created_at desc);

alter table public.artifacts enable row level security;

-- Users see:
--   - their own personal rows
--   - bundled canonical rows (user_id null, org_id null, status='canonical')
--   - any row whose org_id is one of their memberships
drop policy if exists "artifacts select own or canonical" on public.artifacts;
drop policy if exists "artifacts select scope" on public.artifacts;
create policy "artifacts select scope" on public.artifacts
  for select using (
    auth.uid() = user_id
    or (user_id is null and org_id is null and status = 'canonical')
    or (org_id is not null and public.is_org_member(org_id))
  );

-- Personal inserts must be self-owned with no org_id; org inserts require
-- membership and the author is the current user.
drop policy if exists "artifacts insert own" on public.artifacts;
drop policy if exists "artifacts insert scope" on public.artifacts;
create policy "artifacts insert scope" on public.artifacts
  for insert with check (
    (org_id is null and auth.uid() = user_id)
    or (org_id is not null and public.is_org_member(org_id) and auth.uid() = user_id)
  );

-- Personal rows: author edits/deletes. Org rows: author edits their own work;
-- org owners/admins can edit/delete any row in their org.
drop policy if exists "artifacts update own" on public.artifacts;
drop policy if exists "artifacts update scope" on public.artifacts;
create policy "artifacts update scope" on public.artifacts
  for update using (
    auth.uid() = user_id
    or (org_id is not null and public.has_org_role(org_id, array['owner', 'admin']))
  );

drop policy if exists "artifacts delete own" on public.artifacts;
drop policy if exists "artifacts delete scope" on public.artifacts;
create policy "artifacts delete scope" on public.artifacts
  for delete using (
    auth.uid() = user_id
    or (org_id is not null and public.has_org_role(org_id, array['owner', 'admin']))
  );

-- ============================================================================
-- source_chunks
--
-- PDF + document ingestion (ROADMAP §1, §3). Each row is a contiguous chunk
-- of text extracted from a `source_document` artifact, with an embedding
-- stored as a JSON array (deterministic hashing-based bag-of-words for now
-- — upgradeable to semantic embeddings without a schema change).
-- ============================================================================
create table if not exists public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  ordinal int not null,
  page int,
  text text not null,
  embedding jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists source_chunks_artifact_idx
  on public.source_chunks (artifact_id, ordinal);
create index if not exists source_chunks_user_idx
  on public.source_chunks (user_id);

alter table public.source_chunks enable row level security;

drop policy if exists "source_chunks select own" on public.source_chunks;
create policy "source_chunks select own" on public.source_chunks
  for select using (auth.uid() = user_id);
drop policy if exists "source_chunks insert own" on public.source_chunks;
create policy "source_chunks insert own" on public.source_chunks
  for insert with check (auth.uid() = user_id);
drop policy if exists "source_chunks delete own" on public.source_chunks;
create policy "source_chunks delete own" on public.source_chunks
  for delete using (auth.uid() = user_id);

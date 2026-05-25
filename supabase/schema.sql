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

-- active_org_id: which org's context overlays load into the agent's session
-- (HARDENING §1.3). Null = personal mode, no org overlays. Membership is
-- re-validated at session-creation time; setting this to an org the caller
-- isn't in is rejected by the server route, not by the column. Declared here
-- (instead of inline on `profiles`) because `orgs` is defined after
-- `profiles` and the FK target must exist first.
alter table public.profiles
  add column if not exists active_org_id uuid references public.orgs(id) on delete set null;

-- ============================================================================
-- provider_keys  (HARDENING §1.4)
--
-- Per-user provider API credentials. Today every opencode session bills
-- against one shared OpenRouter key in opencode's env; a runaway loop bills
-- the whole org. With this table, each user can paste their own key in
-- /app/settings; grid-app writes it into their workspace's
-- .opencode/opencode.jsonc under `provider.<id>.options.apiKey`, and opencode
-- picks it up at request time (no fork modification required — opencode's
-- config loader merges workspace-local `provider:` over global / env).
--
-- `encrypted_key` is NOT plaintext. grid-app encrypts the value with
-- AES-256-GCM keyed off `STEINMETZ_PROVIDER_KEYS_SECRET` before insert; the
-- format is `<iv-hex>:<tag-hex>:<ciphertext-hex>`. This is the interim path
-- — Supabase Vault / pgsodium would let us drop the app-side secret, but
-- enabling those extensions is a separate vault-setup workflow and out of
-- scope for §1.4. RLS keeps the row pinned to the owning user; the
-- app-secret encryption is a defense-in-depth layer for the case where
-- someone exfiltrates a DB dump but doesn't have grid-app's .env.local.
-- `key_hint` is the masked tail (e.g. "sk-or-...3a2f") so the settings page
-- can show what's stored without round-tripping decryption to the browser.
-- ============================================================================
create table if not exists public.provider_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  encrypted_key text not null,
  key_hint text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists provider_keys_user_provider_idx
  on public.provider_keys (user_id, provider);

alter table public.provider_keys enable row level security;

drop policy if exists "provider_keys select own" on public.provider_keys;
create policy "provider_keys select own" on public.provider_keys
  for select using (auth.uid() = user_id);
drop policy if exists "provider_keys insert own" on public.provider_keys;
create policy "provider_keys insert own" on public.provider_keys
  for insert with check (auth.uid() = user_id);
drop policy if exists "provider_keys update own" on public.provider_keys;
create policy "provider_keys update own" on public.provider_keys
  for update using (auth.uid() = user_id);
drop policy if exists "provider_keys delete own" on public.provider_keys;
create policy "provider_keys delete own" on public.provider_keys
  for delete using (auth.uid() = user_id);

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

-- ============================================================================
-- review_policies + audit_log  (ROADMAP §9)
--
-- Validation + safety. A reviewer agent (scripts/review_feature.py) runs on
-- every new feature artifact, checks imports + signatures + a smoke call,
-- then either flips status to 'canonical' or 'failed_validation' depending on
-- the scope's policy:
--   - auto_promote = true   -> reviewer promotes passing drafts to canonical
--   - auto_promote = false  -> reviewer leaves passing drafts as 'draft'; the
--                              user (or an org admin) approves manually.
-- Failing reviews always flip to 'failed_validation' regardless of policy.
--
-- audit_log rows are written for every artifact mutation + every reviewer
-- decision. Service-role writes only; users can read their own rows.
-- ============================================================================
create table if not exists public.review_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  org_id uuid references public.orgs(id) on delete cascade,
  auto_promote boolean not null default false,
  updated_at timestamptz default now(),
  check ((user_id is null) <> (org_id is null))
);

-- Exactly one row per scope. Partial unique indexes let us keep both columns
-- nullable while still enforcing one personal row per user and one row per org.
create unique index if not exists review_policies_user_idx
  on public.review_policies (user_id) where org_id is null;
create unique index if not exists review_policies_org_idx
  on public.review_policies (org_id) where user_id is null;

alter table public.review_policies enable row level security;

drop policy if exists "review_policies select scope" on public.review_policies;
create policy "review_policies select scope" on public.review_policies
  for select using (
    auth.uid() = user_id
    or (org_id is not null and public.is_org_member(org_id))
  );

drop policy if exists "review_policies insert scope" on public.review_policies;
create policy "review_policies insert scope" on public.review_policies
  for insert with check (
    (org_id is null and auth.uid() = user_id)
    or (org_id is not null and public.has_org_role(org_id, array['owner', 'admin']))
  );

drop policy if exists "review_policies update scope" on public.review_policies;
create policy "review_policies update scope" on public.review_policies
  for update using (
    (org_id is null and auth.uid() = user_id)
    or (org_id is not null and public.has_org_role(org_id, array['owner', 'admin']))
  );

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  org_id uuid references public.orgs(id) on delete set null,
  artifact_id uuid references public.artifacts(id) on delete set null,
  action text not null,
  actor text not null default 'user',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists audit_log_user_created_idx
  on public.audit_log (user_id, created_at desc);
create index if not exists audit_log_artifact_idx
  on public.audit_log (artifact_id, created_at desc);
create index if not exists audit_log_org_created_idx
  on public.audit_log (org_id, created_at desc);

alter table public.audit_log enable row level security;

-- Users see audit rows tied to themselves or to artifacts in their visible
-- scope. Writes are service-role only (the reviewer script + server routes
-- use the service key); no user-facing insert policy on purpose.
drop policy if exists "audit_log select scope" on public.audit_log;
create policy "audit_log select scope" on public.audit_log
  for select using (
    auth.uid() = user_id
    or (org_id is not null and public.is_org_member(org_id))
  );

-- ============================================================================
-- tool_runs  (HARDENING §2.2)
--
-- One row per `may_I_proceed()`-gated tool call. The per-user MCP server (and
-- the detached-spawn upload routes) POST /api/internal/proceed before running
-- a tool and /api/internal/release when it finishes; grid-app inserts the row
-- on proceed and updates it on release. Powers the live-status view (which
-- tool is each user running right now?) + audit + a future "cancel" button.
--
-- `token` is the in-memory slot token returned by lib/concurrency.ts. Status
-- progresses running → ok | error | rejected | orphaned. Rejected rows are
-- inserted by the proceed route when a 429 is returned (so we still have a
-- record of attempted runs the bucket refused). Orphaned rows are written by
-- the in-memory sweep when no release arrives before `expected_deadline +
-- grace`.
--
-- All writes go through the service-role client; users get read-only access
-- to their own rows for the live-status view.
-- ============================================================================
create table if not exists public.tool_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  tool text not null,
  args_digest text,
  token text not null unique,
  started_at timestamptz not null default now(),
  expected_deadline timestamptz,
  ended_at timestamptz,
  runtime_ms integer,
  status text not null default 'running'
    check (status in ('running', 'ok', 'error', 'rejected', 'orphaned')),
  error text,
  created_at timestamptz default now()
);

create index if not exists tool_runs_user_started_idx
  on public.tool_runs (user_id, started_at desc);
create index if not exists tool_runs_status_idx
  on public.tool_runs (status);
create index if not exists tool_runs_deadline_idx
  on public.tool_runs (expected_deadline) where status = 'running';

alter table public.tool_runs enable row level security;

-- Users read their own runs (live-status panel). All writes (insert/update)
-- are service-role only — the proceed/release routes use the service client.
drop policy if exists "tool_runs select own" on public.tool_runs;
create policy "tool_runs select own" on public.tool_runs
  for select using (auth.uid() = user_id);

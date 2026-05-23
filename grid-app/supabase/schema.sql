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

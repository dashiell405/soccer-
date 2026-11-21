-- Usernames for Floodlight Kickoff.
-- Safe to run more than once.
-- A player signs in with a username and a password. The browser turns the
-- username into a non-routable address:
--   <lowercased username>@players.kickoff.invalid
-- No real email is stored for that kind of account.
-- A parent-email account leaves username empty.
-- The browser only has the publishable key. Nothing here needs a secret.

alter table public.profiles
  add column if not exists username text;

alter table public.profiles drop constraint if exists profiles_username_ok;
alter table public.profiles
  add constraint profiles_username_ok
  check (username is null or username ~ '^[A-Za-z0-9_]{3,16}$');

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;

comment on column public.profiles.username is
  'Kickoff username in the case the player typed. Unique ignoring case. Null for a parent-email account.';

-- The client upserts its own row. Grants on profiles are per column, so the
-- new column needs its own grant. anon still cannot read or write it.
grant select (username), insert (username), update (username)
  on table public.profiles to authenticated;

create table if not exists public.usernames (
  username_key text primary key,
  username text not null,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint usernames_key_ok check (username_key ~ '^[a-z0-9_]{3,16}$'),
  constraint usernames_name_ok check (username ~ '^[A-Za-z0-9_]{3,16}$'),
  constraint usernames_key_is_lower check (username_key = lower(username))
);

comment on table public.usernames is
  'Maps a Kickoff username to one account. The key is the lowercased name. No email.';

alter table public.usernames enable row level security;

revoke all on table public.usernames from public, anon, authenticated;
grant select, insert, update on table public.usernames to authenticated;

drop policy if exists usernames_select_own on public.usernames;
create policy usernames_select_own on public.usernames
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists usernames_insert_own on public.usernames;
create policy usernames_insert_own on public.usernames
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and username_key = lower(username)
    and username_key = split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 1)
    and split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 2) = 'players.kickoff.invalid'
  );

drop policy if exists usernames_update_own on public.usernames;
create policy usernames_update_own on public.usernames
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and username_key = lower(username)
    and username_key = split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 1)
    and split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 2) = 'players.kickoff.invalid'
  );

-- A signed-in player cannot put someone else's username on their profile row.
create or replace function public.profiles_keep_username()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
  local text := split_part(mail, '@', 1);
  domain text := split_part(mail, '@', 2);
begin
  if new.username is null then
    return new;
  end if;
  if domain <> 'players.kickoff.invalid' or lower(new.username) <> local then
    raise exception 'Username does not match this account.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_keep_username on public.profiles;
create trigger profiles_keep_username
  before insert or update of username on public.profiles
  for each row
  execute function public.profiles_keep_username();

-- True when a new player may take this username. Callable before sign-up,
-- while the browser is still anonymous. A bad shape counts as not available.
drop function if exists public.username_available(text);
create function public.username_available(p_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  key text := lower(btrim(coalesce(p_name, '')));
begin
  if key !~ '^[a-z0-9_]{3,16}$' then
    return false;
  end if;
  if exists (select 1 from public.usernames where username_key = key) then
    return false;
  end if;
  if exists (select 1 from public.profiles where lower(username) = key) then
    return false;
  end if;
  if exists (
    select 1 from auth.users
    where lower(email) = key || '@players.kickoff.invalid'
  ) then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.username_available(text) from public, anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;

comment on function public.username_available(text) is
  'True when the username is free. Checks the mapping, the profile column, and the synthetic sign-in address. Does not reveal any other email.';

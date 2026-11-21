-- Leaderboard and anonymous player count for Floodlight Kickoff.
-- Safe to run more than once.
-- The browser only has the publishable key. Nothing here needs a secret.
-- The public board shows a nickname and a favourite colour. It does not show an email.
-- "Show me on the leaderboard" stays off until a signed-in player turns it on.
-- Scores are capped. A later save cannot lower a score, so a second phone cannot wipe it.

create table if not exists public.devices (
  device_id uuid primary key,
  first_seen timestamptz not null default now()
);

comment on table public.devices is
  'Anonymous device ids for players who opened Kickoff. No name, email, or account.';

create index if not exists devices_first_seen_idx on public.devices (first_seen);

create table if not exists public.leaderboard (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player',
  favorite_color text not null default '#1f5fd6',
  wins integer not null default 0,
  cups integer not null default 0,
  coins_earned bigint not null default 0,
  show_on_board boolean not null default false,
  friend_code text not null,
  updated_at timestamptz not null default now(),
  constraint leaderboard_name_len check (char_length(display_name) between 1 and 16),
  constraint leaderboard_name_safe check (position('@' in display_name) = 0),
  constraint leaderboard_name_chars check (display_name ~ '^[A-Za-z0-9 ]+$'),
  constraint leaderboard_color_ok check (favorite_color in (
    '#e6b325', '#1f5fd6', '#d62828', '#0b6e4f', '#6b3e1e', '#7b2cbf', '#f4f4f4', '#111111'
  )),
  constraint leaderboard_wins_cap check (wins between 0 and 20000),
  constraint leaderboard_cups_cap check (cups between 0 and 5000),
  constraint leaderboard_coins_cap check (coins_earned between 0 and 20000000),
  constraint leaderboard_code_ok check (friend_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$')
);

comment on table public.leaderboard is
  'One row per signed-in player. Hidden until show_on_board is true. Nickname and colour only.';

create unique index if not exists leaderboard_friend_code_key on public.leaderboard (friend_code);
create index if not exists leaderboard_wins_idx on public.leaderboard (wins desc, display_name) where show_on_board;
create index if not exists leaderboard_cups_idx on public.leaderboard (cups desc, display_name) where show_on_board;
create index if not exists leaderboard_coins_idx on public.leaderboard (coins_earned desc, display_name) where show_on_board;

create table if not exists public.leaderboard_friends (
  user_id uuid not null references public.leaderboard (user_id) on delete cascade,
  friend_id uuid not null references public.leaderboard (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint leaderboard_friends_not_self check (user_id <> friend_id)
);

comment on table public.leaderboard_friends is
  'Friends a player added by code. One way: adding a code does not add you back.';

alter table public.devices enable row level security;
alter table public.leaderboard enable row level security;
alter table public.leaderboard_friends enable row level security;

revoke all on table public.devices from public, anon, authenticated;
revoke all on table public.leaderboard from public, anon, authenticated;
revoke all on table public.leaderboard_friends from public, anon, authenticated;

-- Opted-in rows only. Column grants hide the account id, the friend code, and the opt-in flag.
grant select (display_name, favorite_color, wins, cups, coins_earned)
  on table public.leaderboard to anon, authenticated;

drop policy if exists leaderboard_public_read on public.leaderboard;
create policy leaderboard_public_read on public.leaderboard
  for select to anon, authenticated
  using (show_on_board);

create or replace view public.leaderboard_public
with (security_invoker = true) as
select display_name, favorite_color, wins, cups, coins_earned
from public.leaderboard
where show_on_board;

comment on view public.leaderboard_public is
  'Nicknames and favourite colours for players who opted in. No email and no friend code.';

grant select on public.leaderboard_public to anon, authenticated;

-- Anonymous devices. Inserts go through record_device. Nobody can select the table.

drop function if exists public.record_device(uuid);
create function public.record_device(device_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if record_device.device_id is null
     or record_device.device_id = '00000000-0000-0000-0000-000000000000'::uuid then
    return;
  end if;
  execute 'insert into public.devices (device_id) values ($1) on conflict (device_id) do nothing'
    using record_device.device_id;
end;
$$;

drop function if exists public.players_ever();
create function public.players_ever()
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)::bigint from public.devices;
$$;

drop function if exists public.players_new_today();
create function public.players_new_today()
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)::bigint from public.devices
  where first_seen >= (date_trunc('day', (now() at time zone 'utc')) at time zone 'utc');
$$;

drop function if exists public.save_my_leaderboard(text, text, integer, integer, bigint, boolean);
create function public.save_my_leaderboard(
  p_name text,
  p_color text,
  p_wins integer,
  p_cups integer,
  p_coins bigint,
  p_show boolean
)
returns table (
  display_name text,
  favorite_color text,
  wins integer,
  cups integer,
  coins_earned bigint,
  show_on_board boolean,
  friend_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_name text;
  v_color text;
  v_wins integer;
  v_cups integer;
  v_coins bigint;
  v_code text;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i integer;
  guard integer;
begin
  if uid is null then
    raise exception 'Sign in to save a score.';
  end if;

  v_name := btrim(left(regexp_replace(coalesce(p_name, ''), '[<>]', '', 'g'), 16));
  if v_name = '' or position('@' in v_name) > 0 or v_name ~* 'https?://' or v_name !~ '^[A-Za-z0-9 ]+$' or v_name !~ '[A-Za-z]' then
    v_name := 'Player';
  end if;

  v_color := lower(btrim(coalesce(p_color, '')));
  if v_color not in ('#e6b325', '#1f5fd6', '#d62828', '#0b6e4f', '#6b3e1e', '#7b2cbf', '#f4f4f4', '#111111') then
    v_color := '#1f5fd6';
  end if;

  v_wins := least(greatest(coalesce(p_wins, 0), 0), 20000);
  v_cups := least(greatest(coalesce(p_cups, 0), 0), 5000);
  v_coins := least(greatest(coalesce(p_coins, 0), 0), 20000000);

  if exists (select 1 from public.leaderboard where user_id = uid) then
    update public.leaderboard as l set
      display_name = v_name,
      favorite_color = v_color,
      wins = greatest(l.wins, v_wins),
      cups = greatest(l.cups, v_cups),
      coins_earned = greatest(l.coins_earned, v_coins),
      show_on_board = case when p_show is null then l.show_on_board else p_show end,
      updated_at = now()
    where l.user_id = uid;
  else
    guard := 0;
    loop
      v_code := '';
      for i in 1..8 loop
        v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      end loop;
      begin
        insert into public.leaderboard (
          user_id, display_name, favorite_color, wins, cups, coins_earned, show_on_board, friend_code
        ) values (
          uid, v_name, v_color, v_wins, v_cups, v_coins, coalesce(p_show, false), v_code
        );
        exit;
      exception
        when unique_violation then
          if exists (select 1 from public.leaderboard where user_id = uid) then
            update public.leaderboard as l set
              display_name = v_name,
              favorite_color = v_color,
              wins = greatest(l.wins, v_wins),
              cups = greatest(l.cups, v_cups),
              coins_earned = greatest(l.coins_earned, v_coins),
              show_on_board = case when p_show is null then l.show_on_board else p_show end,
              updated_at = now()
            where l.user_id = uid;
            exit;
          end if;
          guard := guard + 1;
          if guard > 8 then
            raise exception 'Could not make a friend code.';
          end if;
      end;
    end loop;
  end if;

  return query
    select l.display_name, l.favorite_color, l.wins, l.cups, l.coins_earned, l.show_on_board, l.friend_code
    from public.leaderboard l
    where l.user_id = uid;
end;
$$;

drop function if exists public.my_leaderboard();
create function public.my_leaderboard()
returns table (
  display_name text,
  favorite_color text,
  wins integer,
  cups integer,
  coins_earned bigint,
  show_on_board boolean,
  friend_code text
)
language sql
security definer
set search_path = public
as $$
  select l.display_name, l.favorite_color, l.wins, l.cups, l.coins_earned, l.show_on_board, l.friend_code
  from public.leaderboard l
  where l.user_id = auth.uid();
$$;

drop function if exists public.leaderboard_top(text);
create function public.leaderboard_top(p_board text)
returns table (
  rank bigint,
  display_name text,
  favorite_color text,
  wins integer,
  cups integer,
  coins_earned bigint,
  is_me boolean
)
language sql
security definer
set search_path = public
as $$
  with ranked as (
    select
      row_number() over (
        order by
          case
            when p_board = 'cups' then l.cups::bigint
            when p_board = 'coins' then l.coins_earned
            else l.wins::bigint
          end desc,
          l.display_name asc
      ) as rank,
      l.user_id,
      l.display_name,
      l.favorite_color,
      l.wins,
      l.cups,
      l.coins_earned
    from public.leaderboard l
    where l.show_on_board
  )
  select
    r.rank,
    r.display_name,
    r.favorite_color,
    r.wins,
    r.cups,
    r.coins_earned,
    (r.user_id = auth.uid()) as is_me
  from ranked r
  where r.rank <= 50
     or (auth.uid() is not null and r.user_id = auth.uid())
  order by r.rank
  limit 51;
$$;

drop function if exists public.leaderboard_friends();
create function public.leaderboard_friends()
returns table (
  rank bigint,
  display_name text,
  favorite_color text,
  wins integer,
  cups integer,
  coins_earned bigint,
  is_me boolean,
  friend_code text
)
language sql
security definer
set search_path = public
as $$
  with pack as (
    select l.*
    from public.leaderboard l
    join public.leaderboard_friends f on f.friend_id = l.user_id
    where f.user_id = auth.uid()
    union
    select l.*
    from public.leaderboard l
    where l.user_id = auth.uid()
  )
  select
    row_number() over (order by p.wins desc, p.cups desc, p.coins_earned desc, p.display_name asc) as rank,
    p.display_name,
    p.favorite_color,
    p.wins,
    p.cups,
    p.coins_earned,
    (p.user_id = auth.uid()) as is_me,
    p.friend_code
  from pack p
  order by 1;
$$;

drop function if exists public.add_friend(text);
create function public.add_friend(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_code text;
  friend uuid;
  n integer;
begin
  if uid is null then
    return 'signed-out';
  end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_code) <> 8 or v_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    return 'bad';
  end if;
  if not exists (select 1 from public.leaderboard where user_id = uid) then
    return 'need-save';
  end if;
  select user_id into friend from public.leaderboard where friend_code = v_code;
  if friend is null then
    return 'missing';
  end if;
  if friend = uid then
    return 'self';
  end if;
  if exists (select 1 from public.leaderboard_friends where user_id = uid and friend_id = friend) then
    return 'already';
  end if;
  select count(*) into n from public.leaderboard_friends where user_id = uid;
  if n >= 40 then
    return 'full';
  end if;
  insert into public.leaderboard_friends (user_id, friend_id) values (uid, friend);
  return 'added';
end;
$$;

drop function if exists public.remove_friend(text);
create function public.remove_friend(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_code text;
  friend uuid;
begin
  if uid is null then
    return 'signed-out';
  end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_code) <> 8 or v_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    return 'bad';
  end if;
  select user_id into friend from public.leaderboard where friend_code = v_code;
  if friend is null then
    return 'missing';
  end if;
  delete from public.leaderboard_friends where user_id = uid and friend_id = friend;
  return 'removed';
end;
$$;

revoke all on function public.record_device(uuid) from public, anon, authenticated;
grant execute on function public.record_device(uuid) to anon, authenticated;

revoke all on function public.players_ever() from public, anon, authenticated;
grant execute on function public.players_ever() to anon, authenticated;

revoke all on function public.players_new_today() from public, anon, authenticated;
grant execute on function public.players_new_today() to anon, authenticated;

revoke all on function public.save_my_leaderboard(text, text, integer, integer, bigint, boolean) from public, anon, authenticated;
grant execute on function public.save_my_leaderboard(text, text, integer, integer, bigint, boolean) to authenticated;

revoke all on function public.my_leaderboard() from public, anon, authenticated;
grant execute on function public.my_leaderboard() to authenticated;

revoke all on function public.leaderboard_top(text) from public, anon, authenticated;
grant execute on function public.leaderboard_top(text) to authenticated;

revoke all on function public.leaderboard_friends() from public, anon, authenticated;
grant execute on function public.leaderboard_friends() to authenticated;

revoke all on function public.add_friend(text) from public, anon, authenticated;
grant execute on function public.add_friend(text) to authenticated;

revoke all on function public.remove_friend(text) from public, anon, authenticated;
grant execute on function public.remove_friend(text) to authenticated;

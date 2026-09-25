-- M3 stats: sessions, tap log, stat lines, attendance, injuries.
-- Spec: docs/superpowers/specs/2026-09-25-m3-stats-design.md
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  kind text not null check (kind in ('practice', 'tournament')),
  held_on date not null,
  counts boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index sessions_season_idx on public.sessions (season_id, held_on);

create table public.stat_taps (
  id uuid primary key,
  session_id uuid not null references public.sessions (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  stat text not null check (stat ~ '^[a-z_]{1,30}$'),
  keeper_id uuid not null references auth.users (id),
  tapped_at timestamptz not null,
  received_at timestamptz not null default now(),
  undoes uuid unique references public.stat_taps (id) on delete cascade
);
create index stat_taps_session_idx on public.stat_taps (session_id);

create table public.stat_lines (
  session_id uuid not null references public.sessions (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  stats jsonb not null check (jsonb_typeof(stats) = 'object'),
  points_played int not null default 0 check (points_played >= 0),
  primary key (session_id, athlete_id)
);

create table public.attendance (
  session_id uuid not null references public.sessions (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  status text not null check (status in ('present', 'absent')),
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (session_id, athlete_id)
);

create table public.injuries (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  reported_by uuid references auth.users (id) on delete set null,
  reported_at timestamptz not null default now(),
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  cleared_at timestamptz
);
create unique index injuries_one_open on public.injuries (athlete_id) where cleared_at is null;

-- A member account links to at most one athlete per season.
create unique index athletes_one_user_per_season on public.athletes (season_id, user_id) where user_id is not null;

alter table public.sessions enable row level security;
alter table public.stat_taps enable row level security;
alter table public.stat_lines enable row level security;
alter table public.attendance enable row level security;
alter table public.injuries enable row level security;
-- Default privileges are revoked (0002), so grant reads back explicitly. Writes stay RPC-only.
grant select on public.sessions, public.stat_taps, public.stat_lines, public.attendance, public.injuries to authenticated;

create function public.is_keeper() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin', 'stat_keeper'))
$$;

create function public.is_my_athlete(p_athlete uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.athletes where id = p_athlete and user_id = auth.uid())
$$;

create function public.is_season_athlete(p_season uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.athletes where season_id = p_season and user_id = auth.uid())
$$;

-- A linked player who isn't in a league still needs their own athlete row and the season's sessions.
drop policy athletes_read on public.athletes;
create policy athletes_read on public.athletes for select to authenticated
  using (public.can_read_league_data() or user_id = auth.uid());
create policy sessions_read on public.sessions for select to authenticated
  using (public.can_read_league_data() or public.is_season_athlete(season_id));
-- stat_lines only exist once a session is verified, so members see verified stats.
create policy stat_lines_read on public.stat_lines for select to authenticated using (public.can_read_league_data());
create policy stat_taps_read on public.stat_taps for select to authenticated using (public.is_keeper());
create policy attendance_read on public.attendance for select to authenticated
  using (public.can_read_league_data() or public.is_my_athlete(athlete_id));
create policy injuries_read on public.injuries for select to authenticated using (
  public.is_keeper() or reported_by = auth.uid() or public.is_my_athlete(athlete_id)
  or (confirmed_at is not null and cleared_at is null and public.can_read_league_data()));

create function private.require_keeper() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not exists (select 1 from public.user_roles where user_id = uid and role in ('admin', 'stat_keeper')) then
    raise exception 'FORBIDDEN';
  end if;
  return uid;
end $$;

-- ponytail: always false until M5 creates roster_slots. M5 must replace this body (gate).
create function private.owns_athlete(p_user uuid, p_athlete uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select false
$$;

-- Fallback mirrors DEFAULT_SETTINGS.stat_weights in src/core/settings.ts (seasons stored with {} settings).
create function private.stat_weights(p_season uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(settings -> 'stat_weights', '{"goal":3,"assist":3,"block":3,"callahan":8,"turnover":-2}'::jsonb)
  from public.seasons where id = p_season
$$;

create function private.is_locked(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    x.verified_at + coalesce((s.settings ->> 'stat_lock_hours')::numeric, 48) * interval '1 hour' <= now(), false)
  from public.sessions x join public.seasons s on s.id = x.season_id
  where x.id = p_session
$$;

-- Raises unless p_stats is {stat: whole number 0..999999} over the season's stat keys.
create function private.check_stats(p_season uuid, p_stats jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare w jsonb := private.stat_weights(p_season); kv record;
begin
  if p_stats is null or jsonb_typeof(p_stats) <> 'object' then raise exception 'INVALID_LINES'; end if;
  for kv in select * from jsonb_each(p_stats) loop
    if not (w ? kv.key) then raise exception 'UNKNOWN_STAT'; end if;
    if jsonb_typeof(kv.value) <> 'number' or kv.value::text !~ '^\d{1,6}$' then raise exception 'INVALID_LINES'; end if;
  end loop;
end $$;

revoke all on all functions in schema private from public, anon, authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

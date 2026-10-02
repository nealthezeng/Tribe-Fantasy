-- Tournament mode: one-on-one game matchups. Spec: docs/superpowers/specs/2026-10-02-tournament-mode-design.md
-- Additive: the weekly tables and RPCs stay until the weekly UI is retired (spec §8 T4). Scoring and Swiss pairing run
-- in the browser (src/core/tournament.ts); the database holds games, frozen pairings, sealed picks and bench state.

-- Games of a stage, created one at a time: game 1 by open_tournament, game N+1 by finish_game(N).
create table public.games (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages (id) on delete cascade,
  number int not null check (number >= 1),
  -- A deleted session leaves the game void (amendment 4).
  session_id uuid unique references public.sessions (id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (stage_id, number),
  check (finished_at is null or started_at is not null)
);

-- Frozen when the game is created. away null = bye.
create table public.game_pairings (
  game_id uuid not null references public.games (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  home uuid not null references public.memberships (id) on delete cascade,
  away uuid references public.memberships (id) on delete cascade,
  unique (game_id, home),
  unique (game_id, away)
);

-- Keyed by game number with no FK to games, so the next game's pick can be set before the game exists. Sealed until
-- that game starts; league_id copied so RLS needn't join (as picks/bids).
create table public.game_picks (
  stage_id uuid not null references public.stages (id) on delete cascade,
  game_number int not null check (game_number >= 1),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (stage_id, game_number, membership_id)
);
create index game_picks_league_idx on public.game_picks (league_id);

-- The manager's bench choice. Unset (or the wrong count) means the default: the cheapest (src/core/tournament.ts
-- lineup); start_game fixes the default into these flags when game 1 starts.
alter table public.roster_slots add column bench boolean not null default false;

-- One injury swap per manager per stage: in_athlete (bench) plays instead of out_athlete from game from_game on.
create table public.bench_swaps (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  out_athlete uuid not null references public.athletes (id) on delete cascade,
  in_athlete uuid not null references public.athletes (id) on delete cascade,
  from_game int not null check (from_game >= 1),
  created_at timestamptz not null default now(),
  unique (stage_id, membership_id)
);

alter table public.games enable row level security;
alter table public.game_pairings enable row level security;
alter table public.game_picks enable row level security;
alter table public.bench_swaps enable row level security;
grant select on public.games, public.game_pairings, public.game_picks, public.bench_swaps to authenticated;
create policy games_read on public.games for select to authenticated using (true);
create policy game_pairings_read on public.game_pairings for select to authenticated using (true);
create policy bench_swaps_read on public.bench_swaps for select to authenticated using (true);
create policy game_picks_read on public.game_picks for select to authenticated using (
  membership_id in (select id from public.memberships where user_id = auth.uid())
  or (exists (select 1 from public.games g where g.stage_id = game_picks.stage_id and g.number = game_picks.game_number
              and g.started_at is not null)
      and (league_id in (select league_id from public.memberships where user_id = auth.uid())
           or exists (select 1 from public.user_roles where user_id = auth.uid()))));

-- The next game a pick can be set for: one past the stage's highest started game.
create function private.next_game(p_stage uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(max(number), 0) + 1 from public.games where stage_id = p_stage and started_at is not null
$$;

-- Bench size for a roster of p_roster athletes: bench_size, but always leaving one active athlete (amendment 1).
create function private.bench_count(p_stage uuid, p_roster int) returns int
language sql stable security definer set search_path = '' as $$
  select least(private.setting_num(st.season_id, 'bench_size', 1)::int, greatest(0, p_roster - 1))
  from public.stages st where st.id = p_stage
$$;

-- PAIRINGS_INVALID unless p_pairings ([{league_id, home, away|null}]) has every membership of every league of the
-- stage's season that joined by now exactly once, in its own league, with at most one bye per league.
create function private.check_pairings(p_stage uuid, p_pairings jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare season uuid; bad boolean;
begin
  select season_id into season from public.stages where id = p_stage;
  if p_pairings is null or jsonb_typeof(p_pairings) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_pairings) e where jsonb_typeof(e) <> 'object') then
    raise exception 'PAIRINGS_INVALID';
  end if;
  begin
    with p as (
      select (e ->> 'league_id')::uuid as league_id, (e ->> 'home')::uuid as home, (e ->> 'away')::uuid as away
      from jsonb_array_elements(p_pairings) e
    ), ids as (
      select league_id, home as id from p union all select league_id, away from p where away is not null
    ), expected as (
      select m.id, m.league_id from public.memberships m join public.leagues l on l.id = m.league_id
      where l.season_id = season and m.created_at <= now()
    )
    select exists (select 1 from ids left join expected x on x.id = ids.id and x.league_id = ids.league_id where x.id is null)
        or exists (select id from ids group by id having count(*) > 1)
        or exists (select 1 from expected x where not exists (select 1 from ids where ids.id = x.id))
        or exists (select 1 from p where away is null group by league_id having count(*) > 1)
      into bad;
  exception when invalid_text_representation then
    raise exception 'PAIRINGS_INVALID';
  end;
  if bad then raise exception 'PAIRINGS_INVALID'; end if;
end $$;

create function private.insert_pairings(p_game uuid, p_pairings jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.game_pairings (game_id, league_id, home, away)
  select p_game, (e ->> 'league_id')::uuid, (e ->> 'home')::uuid, (e ->> 'away')::uuid
  from jsonb_array_elements(p_pairings) e
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- Admin, after the stage's auction: creates game 1 with pairings the admin's browser computed (nextPairings).
create function public.open_tournament(p_stage uuid, p_pairings jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  perform private.require_admin();
  perform 1 from public.stages where id = p_stage for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.games where stage_id = p_stage) then raise exception 'GAMES_EXIST'; end if;
  perform private.check_pairings(p_stage, p_pairings);
  insert into public.games (stage_id, number) values (p_stage, 1) returning id into gid;
  perform private.insert_pairings(gid, p_pairings);
  perform private.audit('open_tournament', 'stage', p_stage::text, jsonb_build_object('game_id', gid, 'pairings', p_pairings));
  return gid;
end $$;

-- Keeper taps Start: picks lock and a counted tournament session is created for the tally. Game 1 also fixes each
-- roster's bench: a manager who didn't choose the right count gets the default (cheapest, then lowest id).
create function public.start_game(p_game uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_keeper(); g public.games; season uuid; sid uuid;
begin
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.started_at is not null then raise exception 'GAME_STARTED'; end if;
  if exists (select 1 from public.games where stage_id = g.stage_id and number < g.number and finished_at is null) then
    raise exception 'PREVIOUS_GAME_LIVE';
  end if;
  select season_id into season from public.stages where id = g.stage_id;
  insert into public.sessions (season_id, kind, held_on, counts, created_by)
  values (season, 'tournament', (now() at time zone 'America/New_York')::date, true, uid) returning id into sid;
  update public.games set session_id = sid, started_at = now() where id = p_game;
  if g.number = 1 then
    with r as (
      select rs.id, rs.membership_id,
        row_number() over (partition by rs.membership_id order by rs.price, rs.athlete_id) as cheap,
        count(*) over (partition by rs.membership_id) as size,
        count(*) filter (where rs.bench) over (partition by rs.membership_id) as flagged
      from public.roster_slots rs where rs.stage_id = g.stage_id
    )
    update public.roster_slots rs set bench = (r.cheap <= private.bench_count(g.stage_id, r.size::int))
    from r where rs.id = r.id and r.flagged <> private.bench_count(g.stage_id, r.size::int);
  end if;
  perform private.audit('start_game', 'game', p_game::text, jsonb_build_object('session_id', sid, 'number', g.number));
  return sid;
end $$;

-- Keeper taps Finish: the keeper's browser sends the Swiss pairings for the next game, computed from provisional
-- standings (copied into the audit row with its inputs, so anyone can re-run it).
create function public.finish_game(p_game uuid, p_pairings jsonb, p_provisional jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare g public.games; gid uuid;
begin
  perform private.require_keeper();
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.started_at is null or g.finished_at is not null then raise exception 'GAME_NOT_LIVE'; end if;
  perform private.check_pairings(g.stage_id, p_pairings);
  update public.games set finished_at = now() where id = p_game;
  insert into public.games (stage_id, number) values (g.stage_id, g.number + 1) returning id into gid;
  perform private.insert_pairings(gid, p_pairings);
  perform private.audit('finish_game', 'game', p_game::text,
    jsonb_build_object('next_game_id', gid, 'pairings', p_pairings, 'provisional', p_provisional));
  return gid;
end $$;

-- The manager's pick for the next game only (amendment 2). Null clears it. Bench, tiredness and injuries are NOT
-- checked: src/core/tournament.ts replaces an invalid pick at the start, so those rules live in one place.
create function public.set_game_pick(p_membership uuid, p_stage uuid, p_number int, p_athlete uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); lid uuid; nxt int;
begin
  if not exists (select 1 from public.stages where id = p_stage) then raise exception 'NOT_FOUND'; end if;
  select league_id into lid from public.memberships where id = p_membership and user_id = uid;
  if not found then raise exception 'NOT_MEMBER'; end if;
  -- Waits for a concurrent start_game, so a pick can't slip in after its game starts.
  perform 1 from public.games where stage_id = p_stage for share;
  nxt := private.next_game(p_stage);
  if p_number is null or p_number < nxt then raise exception 'PICK_LOCKED'; end if;
  if p_number > nxt then raise exception 'NOT_NEXT_GAME'; end if;
  if p_athlete is null then
    delete from public.game_picks where stage_id = p_stage and game_number = p_number and membership_id = p_membership;
  else
    if not exists (select 1 from public.roster_slots
                   where stage_id = p_stage and membership_id = p_membership and athlete_id = p_athlete) then
      raise exception 'NOT_ON_ROSTER';
    end if;
    insert into public.game_picks (stage_id, game_number, membership_id, league_id, athlete_id)
    values (p_stage, p_number, p_membership, lid, p_athlete)
    on conflict (stage_id, game_number, membership_id) do update set athlete_id = excluded.athlete_id, updated_at = now();
  end if;
  -- No athlete here: admins read the audit log, and picks stay sealed until the game starts.
  perform private.audit('set_game_pick', 'stage', p_stage::text, jsonb_build_object('membership_id', p_membership, 'number', p_number));
end $$;

-- The manager's bench before game 1 starts: exactly the bench count of their roster.
create function public.set_bench(p_membership uuid, p_stage uuid, p_athletes uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); size int;
begin
  if not exists (select 1 from public.stages where id = p_stage) then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.memberships where id = p_membership and user_id = uid) then raise exception 'NOT_MEMBER'; end if;
  perform 1 from public.games where stage_id = p_stage for share;
  if exists (select 1 from public.games where stage_id = p_stage and started_at is not null) then
    raise exception 'TOURNAMENT_STARTED';
  end if;
  select count(*) into size from public.roster_slots where stage_id = p_stage and membership_id = p_membership;
  if exists (select 1 from unnest(coalesce(p_athletes, '{}')) a where not exists (
       select 1 from public.roster_slots where stage_id = p_stage and membership_id = p_membership and athlete_id = a)) then
    raise exception 'NOT_ON_ROSTER';
  end if;
  if (select count(distinct a) from unnest(coalesce(p_athletes, '{}')) a) <> private.bench_count(p_stage, size)
     or cardinality(coalesce(p_athletes, '{}')) <> private.bench_count(p_stage, size) then
    raise exception 'BENCH_SIZE';
  end if;
  update public.roster_slots set bench = coalesce(athlete_id = any (p_athletes), false)
  where stage_id = p_stage and membership_id = p_membership;
  perform private.audit('set_bench', 'stage', p_stage::text, jsonb_build_object('membership_id', p_membership, 'athletes', p_athletes));
end $$;

-- Once per stage, after game 1 has started: a bench athlete replaces an active athlete with a confirmed injury from
-- the next game that hasn't started. Flags stay as they are: the core applies the swap from from_game on.
create function public.swap_bench(p_membership uuid, p_stage uuid, p_out uuid, p_in uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); nxt int;
begin
  if not exists (select 1 from public.stages where id = p_stage) then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.memberships where id = p_membership and user_id = uid) then raise exception 'NOT_MEMBER'; end if;
  perform 1 from public.games where stage_id = p_stage for share;
  if not exists (select 1 from public.games where stage_id = p_stage and started_at is not null) then
    raise exception 'TOURNAMENT_NOT_STARTED';
  end if;
  if not exists (select 1 from public.roster_slots where stage_id = p_stage and membership_id = p_membership
                 and athlete_id = p_out and not bench) then
    raise exception 'NOT_ACTIVE';
  end if;
  if not exists (select 1 from public.roster_slots where stage_id = p_stage and membership_id = p_membership
                 and athlete_id = p_in and bench) then
    raise exception 'NOT_ON_BENCH';
  end if;
  if not exists (select 1 from public.injuries where athlete_id = p_out and confirmed_at is not null
                 and (cleared_at is null or cleared_at > now())) then
    raise exception 'NOT_INJURED';
  end if;
  nxt := private.next_game(p_stage);
  insert into public.bench_swaps (stage_id, membership_id, out_athlete, in_athlete, from_game)
  values (p_stage, p_membership, p_out, p_in, nxt)
  on conflict (stage_id, membership_id) do nothing;
  if not found then raise exception 'SWAP_USED'; end if;
  perform private.audit('swap_bench', 'stage', p_stage::text,
    jsonb_build_object('membership_id', p_membership, 'out', p_out, 'in', p_in, 'from_game', nxt));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

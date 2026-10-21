-- M15 P4 (spec §5.9) tournament game count. An admin picks how many games a tournament has; open_tournament now
-- creates all of them up front (only game 1 paired), finish_game pairs the next existing game instead of creating it
-- (a last game has none, so it pairs nothing and mails nothing), and set_game_count raises or lowers the count later.
-- A raised, already-over tournament pairs its first new game at once. reset_game now unpairs game N+1 instead of
-- deleting it. add_next_game and finish_game's p_last go: the count replaces the last-game tap.
-- Stage-wide locks on games are always taken in number order (finish_game, set_game_count, reset_game, and 0024's
-- set_game_pick and admin_set_share, re-created below), so none can deadlock another. Those two also lock the
-- membership row only FOR NO KEY UPDATE (0024 had FOR UPDATE): finish_game holds the games locks and its game_pairings
-- insert takes KEY SHARE on memberships, which FOR UPDATE would block (a deadlock) but NO KEY UPDATE does not.
-- start_game locks just its own game row, and open_tournament the stage row.
begin;

drop function public.finish_game(uuid, jsonb, jsonb, boolean);
drop function public.add_next_game(uuid, jsonb, jsonb);
drop function public.open_tournament(uuid, jsonb);

create function public.open_tournament(p_stage uuid, p_pairings jsonb, p_games int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  perform private.require_admin();
  if p_games is null or p_games not between 1 and 20 then raise exception 'GAME_COUNT_INVALID'; end if;
  perform 1 from public.stages where id = p_stage for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.games where stage_id = p_stage) then raise exception 'GAMES_EXIST'; end if;
  perform private.check_pairings(p_stage, p_pairings);
  insert into public.games (stage_id, number) select p_stage, n from generate_series(1, p_games) n;
  select id into gid from public.games where stage_id = p_stage and number = 1;
  perform private.insert_pairings(gid, p_pairings);
  perform private.audit('open_tournament', 'stage', p_stage::text,
    jsonb_build_object('game_id', gid, 'games', p_games, 'pairings', p_pairings));
  return gid;
end $$;

-- Pairs game N+1 if it exists (null return = that was the last game; p_pairings is then ignored).
create function public.finish_game(p_game uuid, p_pairings jsonb, p_provisional jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare g public.games; gid uuid;
begin
  perform private.require_keeper();
  select * into g from public.games where id = p_game;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.games where stage_id = g.stage_id order by number for update;
  select * into g from public.games where id = p_game; -- re-read under the lock
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.started_at is null or g.finished_at is not null then raise exception 'GAME_NOT_LIVE'; end if;
  select id into gid from public.games where stage_id = g.stage_id and number = g.number + 1;
  if gid is not null then
    if exists (select 1 from public.game_pairings where game_id = gid) then raise exception 'NEXT_GAME_EXISTS'; end if;
    perform private.check_pairings(g.stage_id, p_pairings);
  end if;
  update public.games set finished_at = now() where id = p_game;
  if gid is not null then perform private.insert_pairings(gid, p_pairings); end if;
  perform private.audit('finish_game', 'game', p_game::text, jsonb_build_object('next_game_id', gid,
    'last', gid is null, 'pairings', case when gid is null then null else p_pairings end, 'provisional', p_provisional));
  return gid;
end $$;

-- Lowering needs p_count >= the newest started game; the games above it go with their pairings. Raising an over
-- tournament (its last game finished) pairs the first new game now, within the stage's dates.
create function public.set_game_count(p_stage uuid, p_count int, p_pairings jsonb default null,
  p_provisional jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare cur int; over boolean; gid uuid;
begin
  perform private.require_admin();
  if p_count is null or p_count not between 1 and 20 then raise exception 'GAME_COUNT_INVALID'; end if;
  perform 1 from public.games where stage_id = p_stage order by number for update;
  if not found then raise exception 'NOT_OPEN'; end if;
  select max(number) into cur from public.games where stage_id = p_stage;
  if p_count = cur then return; end if;
  select finished_at is not null into over from public.games where stage_id = p_stage and number = cur;
  if p_count < cur then
    if exists (select 1 from public.games where stage_id = p_stage and number > p_count and started_at is not null) then
      raise exception 'GAME_COUNT_INVALID';
    end if;
    delete from public.games where stage_id = p_stage and number > p_count;
    over := false;
  else
    if over then
      if (select ends_on from public.stages where id = p_stage) < (now() at time zone 'America/New_York')::date then
        raise exception 'TOURNAMENT_ENDED';
      end if;
      perform private.check_pairings(p_stage, p_pairings);
    end if;
    insert into public.games (stage_id, number) select p_stage, n from generate_series(cur + 1, p_count) n;
    if over then
      select id into gid from public.games where stage_id = p_stage and number = cur + 1;
      perform private.insert_pairings(gid, p_pairings);
    end if;
  end if;
  perform private.audit('set_game_count', 'stage', p_stage::text, jsonb_build_object('from', cur, 'to', p_count,
    'pairings', case when over then p_pairings end, 'provisional', case when over then p_provisional end));
end $$;

-- As 0024, but game N+1 stays: its pairings and pick emails go instead, so the next Finish pairs and mails it afresh.
create or replace function public.reset_game(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.games; s public.sessions; nxt uuid; next_unpaired boolean; taps int; lines int;
begin
  perform private.require_admin();
  select * into g from public.games where id = p_game;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.games where stage_id = g.stage_id order by number for update; -- lock the siblings so start_game(N+1) can't commit mid-reset
  select * into g from public.games where id = p_game; -- re-read under the lock
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.started_at is null then raise exception 'GAME_NOT_STARTED'; end if;
  if exists (select 1 from public.games where stage_id = g.stage_id and number > g.number and started_at is not null) then
    raise exception 'NOT_LATEST_GAME';
  end if;
  select * into s from public.sessions where id = g.session_id;
  select count(*) into taps from public.stat_taps where session_id = g.session_id;
  select count(*) into lines from public.stat_lines where session_id = g.session_id;
  select id into nxt from public.games where stage_id = g.stage_id and number = g.number + 1;
  delete from public.game_pairings where game_id = nxt;
  next_unpaired := found;
  delete from private.outbox where kind = 'pick_next' and ref = nxt::text;
  update public.games set started_at = null, finished_at = null, session_id = null where id = p_game;
  delete from public.sessions where id = g.session_id;
  -- In this order, so until_game > from_game holds after every statement.
  delete from public.roster_slots where stage_id = g.stage_id and until_game > g.number and from_game >= g.number;
  update public.roster_slots set until_game = g.number where stage_id = g.stage_id and until_game > g.number;
  update public.roster_slots set from_game = g.number where stage_id = g.stage_id and from_game > g.number;
  perform private.audit('reset_game', 'game', p_game::text, jsonb_build_object(
    'stage_id', g.stage_id, 'number', g.number, 'session_id', g.session_id, 'verified', s.verified_at is not null,
    'taps', taps, 'lines', lines, 'next_game_unpaired', next_unpaired));
end $$;

-- As 0024, but the stage-wide share lock is taken in number order and the membership lock is FOR NO KEY UPDATE (see the header).
create or replace function public.set_game_pick(p_membership uuid, p_stage uuid, p_number int, p_athletes uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); season uuid; lid uuid; nxt int; picks uuid[];
begin
  select season_id into season from public.stages where id = p_stage;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- Locking the membership row serialises one team's calls, so two overlapping sets can't both delete-then-insert
  -- past picks_per_game (as place_bid).
  select league_id into lid from public.memberships where id = p_membership and user_id = uid for no key update;
  if not found then raise exception 'NOT_MEMBER'; end if;
  -- Waits for a concurrent start_game, so a pick can't slip in after its game starts.
  perform 1 from public.games where stage_id = p_stage order by number for share;
  nxt := private.next_game(p_stage);
  if p_number is null or p_number < nxt then raise exception 'PICK_LOCKED'; end if;
  if p_number > nxt then raise exception 'NOT_NEXT_GAME'; end if;
  select coalesce(array_agg(distinct a), '{}') into picks from unnest(coalesce(p_athletes, '{}')) a;
  if cardinality(picks) > private.setting_num(season, 'picks_per_game', 2) then raise exception 'TOO_MANY_PICKS'; end if;
  if exists (select 1 from unnest(picks) a where not exists (
       select 1 from public.roster_slots where stage_id = p_stage and membership_id = p_membership and athlete_id = a
         and from_game <= nxt and (until_game is null or nxt < until_game))) then
    raise exception 'NOT_ON_ROSTER';
  end if;
  delete from public.game_picks where stage_id = p_stage and game_number = p_number and membership_id = p_membership;
  insert into public.game_picks (stage_id, game_number, membership_id, league_id, athlete_id)
  select p_stage, p_number, p_membership, lid, a from unnest(picks) a;
  -- No athletes here: admins read the audit log, and picks stay sealed until the game starts.
  perform private.audit('set_game_pick', 'stage', p_stage::text, jsonb_build_object('membership_id', p_membership, 'number', p_number));
end $$;

create or replace function public.admin_set_share(p_stage uuid, p_membership uuid, p_athlete uuid, p_percent int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  st public.stages;
  n int;
  cur public.roster_slots;
  lid uuid;
  remove boolean := p_percent is null or p_percent = 0;
  old_percent int := 0;
begin
  perform private.require_admin();
  select * into st from public.stages where id = p_stage for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  if st.auction_run_at is null then raise exception 'SHARES_NOT_SETTLED'; end if;
  if not remove and p_percent not between 1 and 100 then raise exception 'INVALID_PERCENT'; end if;
  -- The membership row lock serialises edits to one team (as place_bid).
  select m.league_id into lid from public.memberships m join public.leagues l on l.id = m.league_id
  where m.id = p_membership and l.season_id = st.season_id for no key update of m;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select removed_at from public.memberships where id = p_membership) is not null then
    raise exception 'TEAM_REMOVED';
  end if;
  if not exists (select 1 from public.athletes where id = p_athlete and season_id = st.season_id) then
    raise exception 'NOT_FOUND';
  end if;
  -- Adding or changing needs an opted-in player; taking one off never does.
  if not remove and not exists (select 1 from public.athletes where id = p_athlete and opted_in) then
    raise exception 'NOT_OPTED_IN';
  end if;
  -- Waits for a concurrent start_game, so the next game can't move under us.
  perform 1 from public.games where stage_id = p_stage order by number for share;
  n := private.next_game(p_stage);
  select * into cur from public.roster_slots
  where stage_id = p_stage and membership_id = p_membership and athlete_id = p_athlete and until_game is null for update;
  if found then
    old_percent := round(cur.share * 100)::int;
    if cur.from_game >= n then
      if remove then delete from public.roster_slots where id = cur.id;
      else update public.roster_slots set share = p_percent / 100.0 where id = cur.id;
      end if;
    else
      update public.roster_slots set until_game = n where id = cur.id;
      if not remove then
        insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, share, via, from_game)
        values (p_stage, p_membership, lid, p_athlete, 0, p_percent / 100.0, 'admin', n);
      end if;
    end if;
  else
    if remove then raise exception 'NOT_FOUND'; end if;
    insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, share, via, from_game)
    values (p_stage, p_membership, lid, p_athlete, 0, p_percent / 100.0, 'admin', n);
  end if;
  if remove then
    delete from public.game_picks
    where stage_id = p_stage and membership_id = p_membership and athlete_id = p_athlete and game_number = n;
  end if;
  perform private.audit('admin_set_share', 'membership', p_membership::text, jsonb_build_object(
    'stage', p_stage, 'membership', p_membership, 'athlete', p_athlete,
    'old_percent', old_percent, 'new_percent', coalesce(p_percent, 0), 'from_game', n));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('open_tournament', 'finish_game', 'set_game_count', 'reset_game', 'set_game_pick', 'admin_set_share') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

commit;

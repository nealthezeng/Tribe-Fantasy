-- M15 P4 (spec §5.9) tournament game count. An admin picks how many games a tournament has; open_tournament now
-- creates all of them up front (only game 1 paired), finish_game pairs the next existing game instead of creating it
-- (a last game has none, so it pairs nothing and mails nothing), and set_game_count raises or lowers the count later.
-- A raised, already-over tournament pairs its first new game at once. reset_game now unpairs game N+1 instead of
-- deleting it. add_next_game and finish_game's p_last go: the count replaces the last-game tap.
-- Every function locks the stage's games in number order first, so these can't race each other or start_game.
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
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.started_at is null then raise exception 'GAME_NOT_STARTED'; end if;
  perform 1 from public.games where stage_id = g.stage_id order by number for update; -- lock the siblings so start_game(N+1) can't commit mid-reset
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

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('open_tournament', 'finish_game', 'set_game_count', 'reset_game') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

commit;

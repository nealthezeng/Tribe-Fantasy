-- Admin powers and opponent names. Spec: docs/superpowers/specs/2026-10-03-admin-powers-design.md
-- Additive or more permissive for admins only, so it is safe to paste before the new build deploys.

-- §1 Admins tally and verify everything: an admin never "owns" an athlete for the owner gates (taps, verify,
-- reopen, corrections, keeper attendance, injury auto-confirm). Checked by p_user, not auth.uid().
create or replace function private.owns_athlete(p_user uuid, p_athlete uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.user_roles where user_id = p_user and role = 'admin')
    and exists (
      select 1 from public.roster_slots r
      join public.memberships m on m.id = r.membership_id
      join public.stages s on s.id = r.stage_id
      where m.user_id = p_user and r.athlete_id = p_athlete and s.auction_run_at is not null
        and (s.ends_on >= current_date - 7 or s.id = (
          select s2.id from public.stages s2 join public.athletes a on a.season_id = s2.season_id
          where a.id = p_athlete and s2.auction_run_at is not null
          order by s2.starts_on desc limit 1)))
$$;

-- 0005's verify_session, except an admin may verify a session they tallied (VERIFIER_TAPPED is for keepers).
create or replace function public.verify_session(p_session uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_keeper(); s public.sessions; l jsonb; v_athlete uuid; bad boolean;
begin
  select * into s from public.sessions where id = p_session for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.verified_at is not null then raise exception 'SESSION_VERIFIED'; end if;
  if not public.is_admin() and exists (select 1 from public.stat_taps where session_id = p_session and keeper_id = uid) then
    raise exception 'VERIFIER_TAPPED';
  end if;
  if exists (select 1 from public.stat_taps where session_id = p_session and private.owns_athlete(uid, athlete_id)) then
    raise exception 'OWNS_ATHLETE';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'INVALID_LINES'; end if;

  for l in select value from jsonb_array_elements(p_lines) loop
    begin
      v_athlete := (l ->> 'athlete_id')::uuid;
    exception when invalid_text_representation then raise exception 'INVALID_LINES';
    end;
    if v_athlete is null then raise exception 'INVALID_LINES'; end if;
    if not exists (select 1 from public.athletes where id = v_athlete and season_id = s.season_id) then
      raise exception 'NOT_FOUND';
    end if;
    perform private.check_stats(s.season_id, l -> 'stats');
    begin
      insert into public.stat_lines (session_id, athlete_id, stats) values (p_session, v_athlete, l -> 'stats');
    exception when unique_violation then raise exception 'INVALID_LINES';
    end;
  end loop;

  with live as (
    select t.athlete_id, t.stat, t.keeper_id from public.stat_taps t
    where t.session_id = p_session and t.undoes is null
      and not exists (select 1 from public.stat_taps u where u.undoes = t.id)
  ), per_keeper as (
    select athlete_id, stat, keeper_id, count(*)::int as n from live group by 1, 2, 3
  ), bounds as (
    select athlete_id, stat, max(n) as lo, sum(n)::int as hi from per_keeper group by 1, 2
  ), claimed as (
    select sl.athlete_id, kv.key as stat, kv.value::text::int as c
    from public.stat_lines sl, jsonb_each(sl.stats) kv where sl.session_id = p_session
  )
  select exists (
    select 1 from bounds b full join claimed c on c.athlete_id = b.athlete_id and c.stat = b.stat
    where coalesce(c.c, 0) < coalesce(b.lo, 0) or coalesce(c.c, 0) > coalesce(b.hi, 0)
  ) into bad;
  if bad then raise exception 'LINES_MISMATCH'; end if;

  update public.sessions set verified_by = uid, verified_at = now() where id = p_session;
  perform private.audit('verify_session', 'session', p_session::text, jsonb_build_object('lines', p_lines));
end $$;

-- §2 Deleting a tournament keeps its credits: allowance, refund and adjustment rows lose their stage link instead.
alter table public.credit_ledger drop constraint credit_ledger_stage_id_fkey;
alter table public.credit_ledger add constraint credit_ledger_stage_id_fkey
  foreign key (stage_id) references public.stages (id) on delete set null;

-- Admin: a tournament and everything played in it (games and their stats sessions, picks, bench swaps, bids,
-- rosters). Ledger rows stay, so no balance moves.
create function public.delete_stage(p_stage uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare st public.stages; sids uuid[]; counts jsonb;
begin
  perform private.require_admin();
  select * into st from public.stages where id = p_stage for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(array_agg(session_id), '{}') into sids from public.games where stage_id = p_stage and session_id is not null;
  counts := jsonb_build_object(
    'games', (select count(*) from public.games where stage_id = p_stage),
    'sessions', cardinality(sids),
    'slots', (select count(*) from public.roster_slots where stage_id = p_stage),
    'bids', (select count(*) from public.bids where stage_id = p_stage),
    'ledger_rows_kept', (select count(*) from public.credit_ledger where stage_id = p_stage));
  delete from public.stages where id = p_stage;
  delete from public.sessions where id = any (sids);
  perform private.audit('delete_stage', 'stage', p_stage::text,
    jsonb_build_object('season_id', st.season_id, 'name', st.name) || counts);
end $$;

-- §3 Admin "delete game" = undo the newest started game of its tournament: its stats session and the unstarted
-- next game its Finish created go; the game is not started again, keeping its number, pairings and picks.
create function public.reset_game(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.games; s public.sessions; next_deleted boolean; taps int; lines int;
begin
  perform private.require_admin();
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.started_at is null then raise exception 'GAME_NOT_STARTED'; end if;
  if exists (select 1 from public.games where stage_id = g.stage_id and number > g.number and started_at is not null) then
    raise exception 'NOT_LATEST_GAME';
  end if;
  select * into s from public.sessions where id = g.session_id;
  select count(*) into taps from public.stat_taps where session_id = g.session_id;
  select count(*) into lines from public.stat_lines where session_id = g.session_id;
  delete from public.games where stage_id = g.stage_id and number = g.number + 1;
  next_deleted := found;
  update public.games set started_at = null, finished_at = null, session_id = null where id = p_game;
  delete from public.sessions where id = g.session_id;
  perform private.audit('reset_game', 'game', p_game::text, jsonb_build_object(
    'stage_id', g.stage_id, 'number', g.number, 'session_id', g.session_id, 'verified', s.verified_at is not null,
    'taps', taps, 'lines', lines, 'next_game_deleted', next_deleted));
end $$;

-- §4 Opponent names: "vs Duke" instead of "Game 3". Keepers and admins, any time; blank clears it.
alter table public.games add column opponent text check (length(opponent) between 1 and 40);

create function public.set_game_opponent(p_game uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_name, '')), '');
begin
  perform private.require_keeper();
  if not exists (select 1 from public.games where id = p_game) then raise exception 'NOT_FOUND'; end if;
  if length(v) > 40 then raise exception 'INVALID_NAME'; end if;
  update public.games set opponent = v where id = p_game;
  perform private.audit('set_game_opponent', 'game', p_game::text, jsonb_build_object('opponent', v));
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

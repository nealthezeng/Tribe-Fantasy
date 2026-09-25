-- M3 stats RPCs. Spec: docs/superpowers/specs/2026-09-25-m3-stats-design.md §5.

create function public.create_session(p_season uuid, p_kind text, p_held_on date, p_counts boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_keeper(); sid uuid;
begin
  if p_kind is null or p_kind not in ('practice', 'tournament') or p_held_on is null then
    raise exception 'INVALID_SESSION';
  end if;
  if not exists (select 1 from public.seasons where id = p_season) then raise exception 'NOT_FOUND'; end if;
  insert into public.sessions (season_id, kind, held_on, counts, created_by)
  values (p_season, p_kind, p_held_on, coalesce(p_counts, true), uid) returning id into sid;
  perform private.audit('create_session', 'session', sid::text,
    jsonb_build_object('season_id', p_season, 'kind', p_kind, 'held_on', p_held_on, 'counts', coalesce(p_counts, true)));
  return sid;
end $$;

-- p_taps: [{id, athlete_id, stat, tapped_at, undoes|null}], in the order they were tapped.
-- p_client_now: the phone's clock at send time; every tapped_at is shifted by (server now - client now).
create function public.save_taps(p_session uuid, p_client_now timestamptz, p_taps jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_keeper();
  s public.sessions;
  w jsonb;
  skew interval;
  t jsonb;
  v_id uuid; v_athlete uuid; v_at timestamptz; v_undoes uuid; v_stat text;
  target public.stat_taps;
  k int;
  n int := 0;
begin
  if p_taps is null or jsonb_typeof(p_taps) <> 'array' or jsonb_array_length(p_taps) > 500 then
    raise exception 'INVALID_TAPS';
  end if;
  -- Share lock: taps can't slip in while verify_session (which locks for update) is running.
  select * into s from public.sessions where id = p_session for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.verified_at is not null then raise exception 'SESSION_VERIFIED'; end if;
  w := private.stat_weights(s.season_id);
  skew := now() - coalesce(p_client_now, now());

  for t in select value from jsonb_array_elements(p_taps) loop
    begin
      v_id := (t ->> 'id')::uuid;
      v_athlete := (t ->> 'athlete_id')::uuid;
      v_at := (t ->> 'tapped_at')::timestamptz + skew;
      v_undoes := (t ->> 'undoes')::uuid;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'INVALID_TAPS';
    end;
    v_stat := t ->> 'stat';
    if v_id is null or v_athlete is null or v_at is null then raise exception 'INVALID_TAPS'; end if;
    if v_stat is null or not (w ? v_stat) then raise exception 'UNKNOWN_STAT'; end if;
    if not exists (select 1 from public.athletes where id = v_athlete and season_id = s.season_id) then
      raise exception 'NOT_FOUND';
    end if;
    if private.owns_athlete(uid, v_athlete) then raise exception 'OWNS_ATHLETE'; end if;
    if v_undoes is not null then
      select * into target from public.stat_taps where id = v_undoes;
      if not found or target.session_id <> p_session or target.keeper_id <> uid or target.undoes is not null
         or target.athlete_id <> v_athlete or target.stat <> v_stat then
        raise exception 'INVALID_TAPS';
      end if;
    end if;
    begin
      insert into public.stat_taps (id, session_id, athlete_id, stat, keeper_id, tapped_at, undoes)
      values (v_id, p_session, v_athlete, v_stat, uid, v_at, v_undoes)
      on conflict (id) do nothing;
    exception when unique_violation then
      raise exception 'INVALID_TAPS'; -- a second undo of the same tap
    end;
    get diagnostics k = row_count;
    n := n + k;
    if k = 1 and v_undoes is null then
      insert into public.attendance (session_id, athlete_id, status, set_by)
      values (p_session, v_athlete, 'present', uid) on conflict do nothing;
    end if;
  end loop;

  if n > 0 then
    perform private.audit('save_taps', 'session', p_session::text, jsonb_build_object('inserted', n, 'skew', skew::text));
  end if;
  return n;
end $$;

-- p_lines: [{athlete_id, stats: {stat: count}}], computed by mergeTaps in the verifier's browser.
-- Each count must sit between the biggest single keeper's live taps and the sum over keepers.
create function public.verify_session(p_session uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_keeper(); s public.sessions; l jsonb; v_athlete uuid; bad boolean;
begin
  select * into s from public.sessions where id = p_session for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.verified_at is not null then raise exception 'SESSION_VERIFIED'; end if;
  if exists (select 1 from public.stat_taps where session_id = p_session and keeper_id = uid) then
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

create function public.reopen_session(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare old jsonb;
begin
  perform private.require_keeper();
  perform 1 from public.sessions where id = p_session and verified_at is not null for update;
  if not found then
    if exists (select 1 from public.sessions where id = p_session) then raise exception 'SESSION_NOT_VERIFIED'; end if;
    raise exception 'NOT_FOUND';
  end if;
  if private.is_locked(p_session) then raise exception 'SESSION_LOCKED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('athlete_id', athlete_id, 'stats', stats)), '[]'::jsonb) into old
  from public.stat_lines where session_id = p_session;
  delete from public.stat_lines where session_id = p_session;
  update public.sessions set verified_by = null, verified_at = null where id = p_session;
  perform private.audit('reopen_session', 'session', p_session::text, jsonb_build_object('deleted_lines', old));
end $$;

-- After the lock only. The audit row is what M6's rescore reads (rescore_needed).
create function public.correct_stat_line(p_session uuid, p_athlete uuid, p_stats jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sessions; old jsonb;
begin
  perform private.require_admin();
  select * into s from public.sessions where id = p_session for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not private.is_locked(p_session) then raise exception 'SESSION_NOT_LOCKED'; end if;
  if not exists (select 1 from public.athletes where id = p_athlete and season_id = s.season_id) then
    raise exception 'NOT_FOUND';
  end if;
  perform private.check_stats(s.season_id, p_stats);
  select stats into old from public.stat_lines where session_id = p_session and athlete_id = p_athlete;
  insert into public.stat_lines (session_id, athlete_id, stats) values (p_session, p_athlete, p_stats)
  on conflict (session_id, athlete_id) do update set stats = excluded.stats;
  perform private.audit('correct_stat_line', 'session', p_session::text,
    jsonb_build_object('athlete_id', p_athlete, 'old', old, 'new', p_stats, 'rescore_needed', true));
end $$;

-- Keepers set anyone's attendance; a player sets only their own. Locked sessions are frozen.
create function public.set_attendance(p_session uuid, p_athlete uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); s public.sessions;
begin
  if p_status is null or p_status not in ('present', 'absent') then raise exception 'INVALID_STATUS'; end if;
  select * into s from public.sessions where id = p_session;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.athletes where id = p_athlete and season_id = s.season_id) then
    raise exception 'NOT_FOUND';
  end if;
  if not public.is_keeper() and not public.is_my_athlete(p_athlete) then raise exception 'NOT_YOUR_ATHLETE'; end if;
  if private.is_locked(p_session) then raise exception 'SESSION_LOCKED'; end if;
  insert into public.attendance (session_id, athlete_id, status, set_by) values (p_session, p_athlete, p_status, uid)
  on conflict (session_id, athlete_id) do update set status = excluded.status, set_by = excluded.set_by, set_at = now();
  perform private.audit('set_attendance', 'session', p_session::text,
    jsonb_build_object('athlete_id', p_athlete, 'status', p_status));
end $$;

-- Returns the open injury (existing or new). A keeper who doesn't own the athlete confirms it on the spot.
create function public.report_injury(p_athlete uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); iid uuid; auto boolean;
begin
  if not exists (select 1 from public.athletes where id = p_athlete) then raise exception 'NOT_FOUND'; end if;
  if not public.is_keeper() and not public.is_my_athlete(p_athlete) then raise exception 'NOT_YOUR_ATHLETE'; end if;
  perform 1 from public.athletes where id = p_athlete for update; -- serialize reports for one athlete
  select id into iid from public.injuries where athlete_id = p_athlete and cleared_at is null;
  if found then return iid; end if;
  auto := public.is_keeper() and not private.owns_athlete(uid, p_athlete);
  insert into public.injuries (athlete_id, reported_by, confirmed_by, confirmed_at)
  values (p_athlete, uid, case when auto then uid end, case when auto then now() end)
  returning id into iid;
  perform private.audit('report_injury', 'injury', iid::text, jsonb_build_object('athlete_id', p_athlete, 'confirmed', auto));
  return iid;
end $$;

create function public.confirm_injury(p_injury uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_keeper(); i public.injuries;
begin
  select * into i from public.injuries where id = p_injury and cleared_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if private.owns_athlete(uid, i.athlete_id) then raise exception 'OWNS_ATHLETE'; end if;
  if i.confirmed_at is not null then return; end if;
  update public.injuries set confirmed_by = uid, confirmed_at = now() where id = p_injury;
  perform private.audit('confirm_injury', 'injury', p_injury::text, jsonb_build_object('athlete_id', i.athlete_id));
end $$;

-- Clearing only removes protection, so the player may do it without confirmation.
create function public.clear_injury(p_athlete uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare iid uuid;
begin
  perform private.require_user();
  if not public.is_keeper() and not public.is_my_athlete(p_athlete) then raise exception 'NOT_YOUR_ATHLETE'; end if;
  update public.injuries set cleared_at = now() where athlete_id = p_athlete and cleared_at is null returning id into iid;
  if iid is null then raise exception 'NOT_FOUND'; end if;
  perform private.audit('clear_injury', 'injury', iid::text, jsonb_build_object('athlete_id', p_athlete));
end $$;

create function public.link_athlete_user(p_athlete uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare old uuid;
begin
  perform private.require_admin();
  if p_user is not null and not exists (select 1 from auth.users where id = p_user) then raise exception 'NOT_FOUND'; end if;
  select user_id into old from public.athletes where id = p_athlete for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  begin
    update public.athletes set user_id = p_user where id = p_athlete;
  exception when unique_violation then raise exception 'USER_ALREADY_LINKED';
  end;
  perform private.audit('link_athlete_user', 'athlete', p_athlete::text, jsonb_build_object('old', old, 'new', p_user));
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

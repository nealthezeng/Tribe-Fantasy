-- Rollback for 0027_out.sql. Run only AFTER reverting the code (the new bundle reads public.outs).
-- Drops set_out, clear_out and public.outs (every Out mark is lost), and re-creates the four player injury and
-- attendance RPCs verbatim from their latest versions (0005 clear_injury, 0007 set_attendance, 0009 report_injury and
-- confirm_injury). Injuries cleared by 0027 stay cleared; re-report any that should be open.
begin;

drop function public.set_out(uuid, uuid);
drop function public.clear_out(uuid, uuid);
drop table public.outs;

-- A keeper who is the injured player can't confirm their own injury (self-reports have no game effect until another
-- keeper confirms them).
create or replace function public.report_injury(p_athlete uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); iid uuid; auto boolean;
begin
  if not exists (select 1 from public.athletes where id = p_athlete) then raise exception 'NOT_FOUND'; end if;
  if not public.is_keeper() and not public.is_my_athlete(p_athlete) then raise exception 'NOT_YOUR_ATHLETE'; end if;
  perform 1 from public.athletes where id = p_athlete for update; -- serialize reports for one athlete
  select id into iid from public.injuries where athlete_id = p_athlete and cleared_at is null;
  if found then return iid; end if;
  auto := public.is_keeper() and not private.owns_athlete(uid, p_athlete) and not public.is_my_athlete(p_athlete);
  insert into public.injuries (athlete_id, reported_by, confirmed_by, confirmed_at)
  values (p_athlete, uid, case when auto then uid end, case when auto then now() end)
  returning id into iid;
  perform private.audit('report_injury', 'injury', iid::text, jsonb_build_object('athlete_id', p_athlete, 'confirmed', auto));
  return iid;
end $$;

create or replace function public.confirm_injury(p_injury uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_keeper(); i public.injuries;
begin
  select * into i from public.injuries where id = p_injury and cleared_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if private.owns_athlete(uid, i.athlete_id) or public.is_my_athlete(i.athlete_id) then raise exception 'OWNS_ATHLETE'; end if;
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

-- 0005's set_attendance plus the owner check for keepers. A player setting their own attendance is unaffected.
create or replace function public.set_attendance(p_session uuid, p_athlete uuid, p_status text) returns void
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
  if not public.is_my_athlete(p_athlete) and private.owns_athlete(uid, p_athlete) then
    raise exception 'OWNS_ATHLETE';
  end if;
  if private.is_locked(p_session) then raise exception 'SESSION_LOCKED'; end if;
  insert into public.attendance (session_id, athlete_id, status, set_by) values (p_session, p_athlete, p_status, uid)
  on conflict (session_id, athlete_id) do update set status = excluded.status, set_by = excluded.set_by, set_at = now();
  perform private.audit('set_attendance', 'session', p_session::text,
    jsonb_build_object('athlete_id', p_athlete, 'status', p_status));
end $$;


do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('report_injury', 'confirm_injury', 'clear_injury', 'set_attendance') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

commit;

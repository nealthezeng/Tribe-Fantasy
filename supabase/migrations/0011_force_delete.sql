-- Admin force-delete (t81). Spec: docs/superpowers/specs/2026-10-01-force-delete-design.md
-- Both RPCs gain a trailing p_force (default false), so the one-argument calls of the old build still resolve.
-- Without p_force they behave exactly as 0010. Drop first: create or replace with a new argument list would leave
-- the old signature behind as an overload.

drop function public.delete_athlete(uuid);
drop function public.delete_session(uuid);

-- Forced: every FK to athletes cascades, so taps, stat lines, attendance, injuries, bids, roster slots and picks go
-- with it. Auction credits paid for its roster slots are refunded first; the audit row counts what went.
create function public.delete_athlete(p_athlete uuid, p_force boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(); a public.athletes; f boolean := coalesce(p_force, false);
  removed jsonb := '{}'; refunded int;
begin
  select * into a from public.athletes where id = p_athlete for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not f then
    if exists (select 1 from public.stat_taps where athlete_id = p_athlete)
      or exists (select 1 from public.stat_lines where athlete_id = p_athlete)
      or exists (select 1 from public.attendance where athlete_id = p_athlete)
      or exists (select 1 from public.injuries where athlete_id = p_athlete)
      or exists (select 1 from public.bids where athlete_id = p_athlete)
      or exists (select 1 from public.roster_slots where athlete_id = p_athlete)
      or exists (select 1 from public.picks where athlete_id = p_athlete) then
      raise exception 'ATHLETE_IN_USE';
    end if;
  else
    select coalesce(sum(price), 0)::int into refunded from public.roster_slots where athlete_id = p_athlete and price > 0;
    insert into public.credit_ledger (membership_id, stage_id, kind, amount, note, created_by)
    select membership_id, stage_id, 'adjustment', price, 'Refund: ' || a.name || ' removed', uid
    from public.roster_slots where athlete_id = p_athlete and price > 0;
    removed := jsonb_build_object(
      'taps', (select count(*) from public.stat_taps where athlete_id = p_athlete),
      'lines', (select count(*) from public.stat_lines where athlete_id = p_athlete),
      'attendance', (select count(*) from public.attendance where athlete_id = p_athlete),
      'injuries', (select count(*) from public.injuries where athlete_id = p_athlete),
      'bids', (select count(*) from public.bids where athlete_id = p_athlete),
      'slots', (select count(*) from public.roster_slots where athlete_id = p_athlete),
      'picks', (select count(*) from public.picks where athlete_id = p_athlete),
      'refunded', refunded);
  end if;
  delete from public.athletes where id = p_athlete;
  perform private.audit('delete_athlete', 'athlete', p_athlete::text,
    jsonb_build_object('season_id', a.season_id, 'name', a.name, 'user_id', a.user_id, 'force', f) || removed);
end $$;

-- Not forced: sessions started by mistake, as 0010 (keeper who created it or an admin; unverified; no saved taps).
-- Forced: admin only, any session — verified, past its lock, with taps. Taps, stat lines and attendance cascade.
-- Serialisation comes from save_taps' `for share` lock on the session row (0005): a queued tap either lands first
-- or fails NOT_FOUND after the delete, and the phone's queue drops it.
create function public.delete_session(p_session uuid, p_force boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid; s public.sessions; f boolean := coalesce(p_force, false); removed jsonb := '{}';
begin
  if f then uid := private.require_admin(); else uid := private.require_keeper(); end if;
  select * into s from public.sessions where id = p_session for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not f then
    if s.created_by is distinct from uid and not public.is_admin() then raise exception 'FORBIDDEN'; end if;
    if s.verified_at is not null then raise exception 'SESSION_VERIFIED'; end if;
    if exists (select 1 from public.stat_taps where session_id = p_session) then raise exception 'SESSION_NOT_EMPTY'; end if;
  else
    removed := jsonb_build_object(
      'verified', s.verified_at is not null,
      'taps', (select count(*) from public.stat_taps where session_id = p_session),
      'lines', (select count(*) from public.stat_lines where session_id = p_session));
  end if;
  delete from public.sessions where id = p_session;
  perform private.audit('delete_session', 'session', p_session::text,
    jsonb_build_object('season_id', s.season_id, 'kind', s.kind, 'held_on', s.held_on, 'force', f) || removed);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('delete_athlete', 'delete_session') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

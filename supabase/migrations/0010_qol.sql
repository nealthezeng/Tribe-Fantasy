-- M8.5 quality-of-life fixes. Spec: docs/superpowers/specs/2026-09-28-m8.5-qol-design.md

-- Everything points at the athlete id, so a rename touches nothing else.
create function public.rename_athlete(p_athlete uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text; old text;
begin
  perform private.require_admin();
  v := private.clean_name(p_name, 60);
  select name into old from public.athletes where id = p_athlete for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  begin
    update public.athletes set name = v where id = p_athlete;
  exception when unique_violation then raise exception 'ATHLETE_EXISTS';
  end;
  perform private.audit('rename_athlete', 'athlete', p_athlete::text, jsonb_build_object('old', old, 'new', v));
end $$;

-- For athletes added by mistake. Every FK to athletes cascades, so refuse anything with history.
create function public.delete_athlete(p_athlete uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.athletes;
begin
  perform private.require_admin();
  select * into a from public.athletes where id = p_athlete for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.stat_taps where athlete_id = p_athlete)
    or exists (select 1 from public.stat_lines where athlete_id = p_athlete)
    or exists (select 1 from public.attendance where athlete_id = p_athlete)
    or exists (select 1 from public.injuries where athlete_id = p_athlete)
    or exists (select 1 from public.bids where athlete_id = p_athlete)
    or exists (select 1 from public.roster_slots where athlete_id = p_athlete)
    or exists (select 1 from public.picks where athlete_id = p_athlete) then
    raise exception 'ATHLETE_IN_USE';
  end if;
  delete from public.athletes where id = p_athlete;
  perform private.audit('delete_athlete', 'athlete', p_athlete::text,
    jsonb_build_object('season_id', a.season_id, 'name', a.name, 'user_id', a.user_id));
end $$;

-- For sessions started by mistake: unverified and no saved taps. Serialisation comes from save_taps' `for share`
-- lock on the session row (0005): a queued tap either lands first (SESSION_NOT_EMPTY) or fails NOT_FOUND after
-- the delete, and the phone's queue drops it.
create function public.delete_session(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_keeper(); s public.sessions;
begin
  select * into s from public.sessions where id = p_session for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.created_by is distinct from uid and not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if s.verified_at is not null then raise exception 'SESSION_VERIFIED'; end if;
  if exists (select 1 from public.stat_taps where session_id = p_session) then raise exception 'SESSION_NOT_EMPTY'; end if;
  delete from public.sessions where id = p_session;
  perform private.audit('delete_session', 'session', p_session::text,
    jsonb_build_object('season_id', s.season_id, 'kind', s.kind, 'held_on', s.held_on));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('rename_athlete', 'delete_athlete', 'delete_session') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- Your bids in a stage may not total more than your balance (M8.5 §4; replaces M5's uncapped total).
-- create or replace keeps place_bid's existing grants.
-- Locking the membership row makes two simultaneous bids from one manager check the total one after the other.
create or replace function public.place_bid(p_stage uuid, p_membership uuid, p_athlete uuid, p_amount int) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); st public.stages; lid uuid; a public.athletes; others int;
begin
  select * into st from public.stages where id = p_stage for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  select m.league_id into lid from public.memberships m join public.leagues l on l.id = m.league_id
  where m.id = p_membership and m.user_id = uid and l.season_id = st.season_id
  for update of m;
  if not found then raise exception 'NOT_MEMBER'; end if;
  perform private.check_bidding(st);
  select * into a from public.athletes where id = p_athlete and season_id = st.season_id and opted_in;
  if not found then raise exception 'NOT_OPTED_IN'; end if;
  if a.user_id = uid and not private.setting_bool(st.season_id, 'allow_self_ownership', false) then
    raise exception 'SELF_OWNERSHIP';
  end if;
  if p_amount is null or p_amount < private.setting_num(st.season_id, 'min_bid', 1) then
    raise exception 'INVALID_AMOUNT';
  end if;
  select coalesce(sum(amount), 0) into others from public.bids
  where stage_id = p_stage and membership_id = p_membership and athlete_id <> p_athlete;
  if p_amount > private.balance(p_membership) - others then raise exception 'INSUFFICIENT_CREDITS'; end if;
  insert into public.bids (stage_id, membership_id, league_id, athlete_id, amount)
  values (p_stage, p_membership, lid, p_athlete, p_amount)
  on conflict (stage_id, membership_id, athlete_id) do update set amount = excluded.amount, placed_at = now();
  -- No amounts AND athletes here: admins read the audit log, and bids stay sealed until close.
  perform private.audit('place_bid', 'stage', p_stage::text,
    jsonb_build_object('membership_id', p_membership));
end $$;

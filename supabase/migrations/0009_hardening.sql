-- M8 security pass. Spec: docs/superpowers/specs/2026-09-27-m8-hardening-design.md §1
-- Only create or replace of existing functions: their grants carry over, so no grant loop is needed.

-- A lock that has passed stays passed: moving it back would unseal picks and let managers pick after the results.
create or replace function public.set_week_lock(p_week uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare old timestamptz;
begin
  perform private.require_admin();
  if p_at is null then raise exception 'INVALID_LOCK_TIME'; end if;
  select pick_lock_at into old from public.weeks where id = p_week for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if old <= now() then raise exception 'PICK_LOCKED'; end if;
  update public.weeks set pick_lock_at = p_at where id = p_week;
  perform private.audit('set_week_lock', 'week', p_week::text, jsonb_build_object('old', old, 'new', p_at));
end $$;

-- Owning = a slot in the latest auctioned stage of the athlete's season, OR in any auctioned stage that ended in the
-- last 7 days. The latest stage alone missed a stage's closing tournament: that session is still being tallied and
-- verified after the next stage's auction runs, and it scores for the old stage's owner.
-- ponytail: a 7-day window, not each session's own date; pass held_on from the callers if late verifies ever matter.
create or replace function private.owns_athlete(p_user uuid, p_athlete uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.roster_slots r
    join public.memberships m on m.id = r.membership_id
    join public.stages s on s.id = r.stage_id
    where m.user_id = p_user and r.athlete_id = p_athlete and s.auction_run_at is not null
      and (s.ends_on >= current_date - 7 or s.id = (
        select s2.id from public.stages s2 join public.athletes a on a.season_id = s2.season_id
        where a.id = p_athlete and s2.auction_run_at is not null
        order by s2.starts_on desc limit 1)))
$$;

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

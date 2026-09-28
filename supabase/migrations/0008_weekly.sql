-- M6 weekly play. Spec: docs/superpowers/specs/2026-09-27-m6-weekly-design.md
-- Scoring runs in the browser (src/core/year.ts); the database only holds weeks, sealed picks and allowances.

-- Mon–Sun weeks inside a stage (the first and last may be shorter). *_at are the same days as instants in ET.
create table public.weeks (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  pick_lock_at timestamptz not null,
  unique (stage_id, starts_on),
  check (ends_on >= starts_on)
);

-- Sealed until the week's pick_lock_at. league_id is copied from the membership so RLS needn't join.
create table public.picks (
  week_id uuid not null references public.weeks (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (week_id, membership_id)
);
create index picks_league_idx on public.picks (league_id);

alter table public.weeks enable row level security;
alter table public.picks enable row level security;
grant select on public.weeks, public.picks to authenticated;
create policy weeks_read on public.weeks for select to authenticated using (true);
create policy picks_read on public.picks for select to authenticated using (
  membership_id in (select id from public.memberships where user_id = auth.uid())
  or ((select w.pick_lock_at from public.weeks w where w.id = picks.week_id) <= now()
      and (league_id in (select league_id from public.memberships where user_id = auth.uid())
           or exists (select 1 from public.user_roles where user_id = auth.uid()))));

-- Past weeks replay injuries, so the league also needs confirmed injuries that have since cleared.
drop policy injuries_read on public.injuries;
create policy injuries_read on public.injuries for select to authenticated using (
  public.is_keeper() or reported_by = auth.uid() or public.is_my_athlete(athlete_id)
  or (confirmed_at is not null and public.can_read_league_data()));

-- Settings retired by the stages revision §4/§7. The settings editor saves every key, so a stored value equal to
-- the OLD default was never chosen: drop it so the new default (0.9 / 0.6 / 2) applies.
update public.seasons set settings = settings
  - array['decay_grace_weeks', 'decay_return_window', 'trade_review_hours', 'trade_keeps_usage']
  - array_remove(array[
      case when settings -> 'decay_rate' = '0.95'::jsonb then 'decay_rate' end,
      case when settings -> 'decay_floor' = '0.5'::jsonb then 'decay_floor' end,
      case when settings -> 'upset_k' = '1'::jsonb then 'upset_k' end], null);

-- The allowance now takes ranks from the admin's browser (the M4 stub is gone).
drop function public.grant_stage_allowance(uuid);
drop function private.standings_points(uuid);

-- Every membership of the season with its league size and the rank sent for it (null when missing or not a number).
create function private.allowance_ranks(p_season uuid, p_ranks jsonb)
returns table (id uuid, n bigint, r numeric)
language sql stable security definer set search_path = '' as $$
  select m.id, count(*) over (partition by m.league_id),
    case when jsonb_typeof(p_ranks -> m.id::text) = 'number' then (p_ranks ->> m.id::text)::numeric end
  from public.memberships m join public.leagues l on l.id = m.league_id
  where l.season_id = p_season
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- (Re)builds a stage's weeks from its dates and the season's pick_lock_day / pick_lock_time (ET). The lock is the
-- first matching day in the week at that time; a week without that day locks at its start.
create function public.create_stage_weeks(p_stage uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare st public.stages; cfg jsonb; day_no int; lock_time time; ws date; we date; d date; n int := 0;
begin
  perform private.require_admin();
  select * into st from public.stages where id = p_stage for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.weeks where stage_id = p_stage for update;
  if exists (select 1 from public.picks p join public.weeks w on w.id = p.week_id where w.stage_id = p_stage) then
    raise exception 'WEEKS_HAVE_PICKS';
  end if;
  select settings into cfg from public.seasons where id = st.season_id;
  -- Fallbacks mirror DEFAULT_SETTINGS in src/core/settings.ts.
  day_no := coalesce(array_position(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], cfg ->> 'pick_lock_day'), 1);
  lock_time := coalesce(cfg ->> 'pick_lock_time', '21:00')::time;
  delete from public.weeks where stage_id = p_stage;
  ws := st.starts_on;
  while ws <= st.ends_on loop
    we := least(ws + (7 - extract(isodow from ws)::int), st.ends_on);
    d := ws + ((day_no - extract(isodow from ws)::int + 7) % 7);
    insert into public.weeks (stage_id, starts_on, ends_on, starts_at, ends_at, pick_lock_at)
    values (p_stage, ws, we,
      ws::timestamp at time zone 'America/New_York',
      (we + 1)::timestamp at time zone 'America/New_York',
      case when d <= we then (d + lock_time) at time zone 'America/New_York'
           else ws::timestamp at time zone 'America/New_York' end);
    n := n + 1;
    ws := we + 1;
  end loop;
  perform private.audit('create_stage_weeks', 'stage', p_stage::text, jsonb_build_object('weeks', n));
  return n;
end $$;

create function public.set_week_lock(p_week uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare old timestamptz;
begin
  perform private.require_admin();
  if p_at is null then raise exception 'INVALID_LOCK_TIME'; end if;
  select pick_lock_at into old from public.weeks where id = p_week for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.weeks set pick_lock_at = p_at where id = p_week;
  perform private.audit('set_week_lock', 'week', p_week::text, jsonb_build_object('old', old, 'new', p_at));
end $$;

-- Null clears the pick. No-repeat and injuries are NOT checked here: src/core/year.ts replaces an invalid pick at
-- the lock, so those rules live in one place.
create function public.set_pick(p_membership uuid, p_week uuid, p_athlete uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); w public.weeks; lid uuid;
begin
  select * into w from public.weeks where id = p_week;
  if not found then raise exception 'NOT_FOUND'; end if;
  select league_id into lid from public.memberships where id = p_membership and user_id = uid;
  if not found then raise exception 'NOT_MEMBER'; end if;
  if now() >= w.pick_lock_at then raise exception 'PICK_LOCKED'; end if;
  if p_athlete is null then
    delete from public.picks where week_id = p_week and membership_id = p_membership;
  else
    if not exists (select 1 from public.roster_slots
                   where stage_id = w.stage_id and membership_id = p_membership and athlete_id = p_athlete) then
      raise exception 'NOT_ON_ROSTER';
    end if;
    insert into public.picks (week_id, membership_id, league_id, athlete_id) values (p_week, p_membership, lid, p_athlete)
    on conflict (week_id, membership_id) do update set athlete_id = excluded.athlete_id, updated_at = now();
  end if;
  -- No athlete here: admins read the audit log, and picks stay sealed until the lock.
  perform private.audit('set_pick', 'week', p_week::text, jsonb_build_object('membership_id', p_membership));
end $$;

-- Credits every membership of the stage's season that has no allowance for this stage yet (re-runs pick up late
-- joiners). p_ranks = {membership_id: rank} from the standings (1 = best, ties share the average). Every membership
-- needs a rank in [1, league size], so a missing one can't sort as best (M6 gate).
create function public.grant_stage_allowance(p_stage uuid, p_ranks jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(); st public.stages; base numeric; gap numeric; credited int;
begin
  select * into st from public.stages where id = p_stage;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_ranks is null or jsonb_typeof(p_ranks) <> 'object'
     or exists (select 1 from private.allowance_ranks(st.season_id, p_ranks) x where x.r is null or x.r < 1 or x.r > x.n) then
    raise exception 'STANDINGS_MISSING';
  end if;
  base := private.setting_num(st.season_id, 'allowance_base', 100);
  gap := private.setting_num(st.season_id, 'allowance_gap', 30);
  with ins as (
    insert into public.credit_ledger (membership_id, stage_id, kind, amount, created_by)
    select id, p_stage, 'allowance', a, uid
    from (select x.id, round(case when x.n < 2 then base else base + gap * (x.r - 1) / (x.n - 1) end)::int as a
          from private.allowance_ranks(st.season_id, p_ranks) x) y
    where a <> 0
    on conflict (membership_id, stage_id) where kind = 'allowance' do nothing
    returning 1
  )
  select count(*) into credited from ins;
  perform private.audit('grant_stage_allowance', 'stage', p_stage::text,
    jsonb_build_object('credited', credited, 'ranks', p_ranks));
  return credited;
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

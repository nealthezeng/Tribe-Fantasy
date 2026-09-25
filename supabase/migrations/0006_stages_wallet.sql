-- M4 stages and wallet. Spec: docs/superpowers/specs/2026-09-25-m4-stages-wallet-design.md
create table public.stages (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  starts_on date not null,
  ends_on date not null,
  tournament text check (length(tournament) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (season_id, name),
  check (ends_on >= starts_on)
);

-- Append-only. Balance = sum(amount). Every donation is a donation to the team fund; the app never holds money.
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  -- Cascade: no RPC deletes a stage, so this only fires when its whole season is deleted.
  stage_id uuid references public.stages (id) on delete cascade,
  kind text not null check (kind in ('allowance', 'donation', 'adjustment')),
  amount int not null check (amount <> 0),
  dollars numeric(10, 2) check (dollars > 0),
  note text check (length(note) between 1 and 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'donation') = (dollars is not null))
);
create index credit_ledger_membership_idx on public.credit_ledger (membership_id);
create unique index credit_ledger_one_allowance on public.credit_ledger (membership_id, stage_id) where kind = 'allowance';

alter table public.stages enable row level security;
alter table public.credit_ledger enable row level security;
grant select on public.stages, public.credit_ledger to authenticated;
create policy stages_read on public.stages for select to authenticated using (true);
create policy credit_ledger_read on public.credit_ledger for select to authenticated using (
  membership_id in (select id from public.memberships where user_id = auth.uid())
  or public.has_role('treasurer') or public.is_admin());

-- Retired settings (stages revision §6).
update public.seasons set settings = settings - 'min_credits_to_play' - 'free_entry' - 'extra_credit_cap';

-- Fallbacks mirror DEFAULT_SETTINGS in src/core/settings.ts (seasons stored with {} settings).
create function private.setting_num(p_season uuid, p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((settings ->> p_key)::numeric, p_default) from public.seasons where id = p_season
$$;

-- ponytail: 0 for everyone until M6 builds standings, so every allowance is base + gap/2. M6 must replace this body (gate).
create function private.standings_points(p_membership uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select 0::numeric
$$;

create function private.require_treasurer() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not exists (select 1 from public.user_roles where user_id = uid and role in ('admin', 'treasurer')) then
    raise exception 'FORBIDDEN';
  end if;
  return uid;
end $$;

-- Raises unless the dates are valid and don't overlap another stage of the season. Callers lock the season row.
create function private.check_stage(p_season uuid, p_stage uuid, p_starts date, p_ends date) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_starts is null or p_ends is null or p_ends < p_starts then raise exception 'INVALID_DATES'; end if;
  if exists (select 1 from public.stages where season_id = p_season and id is distinct from p_stage
             and starts_on <= p_ends and ends_on >= p_starts) then
    raise exception 'STAGE_OVERLAP';
  end if;
end $$;

-- Blank or null → null; otherwise the same 1..p_max rule as names.
create function private.clean_optional(p_text text, p_max int) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_text, '')), '');
begin
  return case when v is null then null else private.clean_name(v, p_max) end;
end $$;

revoke all on all functions in schema private from public, anon, authenticated;

create function public.create_stage(p_season uuid, p_name text, p_starts_on date, p_ends_on date, p_tournament text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare sid uuid; v text; t text;
begin
  perform private.require_admin();
  v := private.clean_name(p_name, 60);
  t := private.clean_optional(p_tournament, 60);
  perform 1 from public.seasons where id = p_season for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform private.check_stage(p_season, null, p_starts_on, p_ends_on);
  begin
    insert into public.stages (season_id, name, starts_on, ends_on, tournament)
    values (p_season, v, p_starts_on, p_ends_on, t) returning id into sid;
  exception when unique_violation then raise exception 'STAGE_EXISTS';
  end;
  perform private.audit('create_stage', 'stage', sid::text, jsonb_build_object(
    'season_id', p_season, 'name', v, 'starts_on', p_starts_on, 'ends_on', p_ends_on, 'tournament', t));
  return sid;
end $$;

create function public.update_stage(p_stage uuid, p_name text, p_starts_on date, p_ends_on date, p_tournament text)
returns void language plpgsql security definer set search_path = '' as $$
declare old public.stages; v text; t text;
begin
  perform private.require_admin();
  v := private.clean_name(p_name, 60);
  t := private.clean_optional(p_tournament, 60);
  select * into old from public.stages where id = p_stage;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.seasons where id = old.season_id for update;
  perform private.check_stage(old.season_id, p_stage, p_starts_on, p_ends_on);
  begin
    update public.stages set name = v, starts_on = p_starts_on, ends_on = p_ends_on, tournament = t where id = p_stage;
  exception when unique_violation then raise exception 'STAGE_EXISTS';
  end;
  perform private.audit('update_stage', 'stage', p_stage::text, jsonb_build_object(
    'old', to_jsonb(old) - 'id' - 'season_id' - 'created_at',
    'new', jsonb_build_object('name', v, 'starts_on', p_starts_on, 'ends_on', p_ends_on, 'tournament', t)));
end $$;

-- Credits every membership of the stage's season that has no allowance for this stage yet (re-runs pick up
-- late joiners). Amount = round(base + gap × (r − 1) / (n − 1)), r = average rank among ties, 1 = best.
create function public.grant_stage_allowance(p_stage uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(); st public.stages; base numeric; gap numeric; credited int;
begin
  select * into st from public.stages where id = p_stage;
  if not found then raise exception 'NOT_FOUND'; end if;
  base := private.setting_num(st.season_id, 'allowance_base', 100);
  gap := private.setting_num(st.season_id, 'allowance_gap', 30);
  with pts as (
    select m.id, m.league_id, private.standings_points(m.id) as p
    from public.memberships m join public.leagues l on l.id = m.league_id
    where l.season_id = st.season_id
  ), ranked as (
    select id,
      count(*) over (partition by league_id) as n,
      rank() over (partition by league_id order by p desc)
        + (count(*) over (partition by league_id, p) - 1) / 2.0 as r
    from pts
  ), ins as (
    insert into public.credit_ledger (membership_id, stage_id, kind, amount, created_by)
    select id, p_stage, 'allowance', a, uid
    from (select id, round(case when n < 2 then base else base + gap * (r - 1) / (n - 1) end)::int as a from ranked) x
    where a <> 0
    on conflict (membership_id, stage_id) where kind = 'allowance' do nothing
    returning 1
  )
  select count(*) into credited from ins;
  perform private.audit('grant_stage_allowance', 'stage', p_stage::text, jsonb_build_object('credited', credited));
  return credited;
end $$;

-- The treasurer has already received the money through the official team channel; this only records it.
create function public.record_donation(p_membership uuid, p_dollars numeric, p_note text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_treasurer(); sid uuid; n text; credits int; eid bigint;
begin
  select l.season_id into sid from public.memberships m join public.leagues l on l.id = m.league_id where m.id = p_membership;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not coalesce((select (settings ->> 'donations_enabled')::boolean from public.seasons where id = sid), false) then
    raise exception 'DONATIONS_DISABLED';
  end if;
  if p_dollars is null or p_dollars <= 0 or p_dollars > 10000 or p_dollars <> round(p_dollars, 2) then
    raise exception 'INVALID_AMOUNT';
  end if;
  n := nullif(btrim(coalesce(p_note, '')), '');
  if length(n) > 200 then raise exception 'INVALID_NOTE'; end if;
  credits := round(p_dollars * private.setting_num(sid, 'credits_per_dollar', 20));
  if credits < 1 then raise exception 'INVALID_AMOUNT'; end if;
  insert into public.credit_ledger (membership_id, kind, amount, dollars, note, created_by)
  values (p_membership, 'donation', credits, p_dollars, n, uid) returning id into eid;
  perform private.audit('record_donation', 'membership', p_membership::text,
    jsonb_build_object('ledger_id', eid, 'dollars', p_dollars, 'credits', credits));
  return eid;
end $$;

-- The only way to fix a mistake: the ledger is append-only.
create function public.adjust_credits(p_membership uuid, p_amount int, p_note text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(); n text := nullif(btrim(coalesce(p_note, '')), ''); eid bigint;
begin
  if not exists (select 1 from public.memberships where id = p_membership) then raise exception 'NOT_FOUND'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then raise exception 'INVALID_AMOUNT'; end if;
  if n is null then raise exception 'NOTE_REQUIRED'; end if;
  if length(n) > 200 then raise exception 'INVALID_NOTE'; end if;
  insert into public.credit_ledger (membership_id, kind, amount, note, created_by)
  values (p_membership, 'adjustment', p_amount, n, uid) returning id into eid;
  perform private.audit('adjust_credits', 'membership', p_membership::text,
    jsonb_build_object('ledger_id', eid, 'amount', p_amount, 'note', n));
  return eid;
end $$;

-- 0003's join_league plus the max_members cap (LEAGUE_FULL).
create or replace function public.join_league(p_code text, p_team_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  inv public.invites;
  sid uuid;
  mid uuid;
  t text := btrim(coalesce(p_team_name, ''));
begin
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'NO_PROFILE'; end if;
  if length(t) < 1 or length(t) > 40 then raise exception 'INVALID_TEAM_NAME'; end if;
  select * into inv from public.invites where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or (inv.expires_at is not null and inv.expires_at <= now()) or inv.uses >= inv.max_uses then
    raise exception 'INVALID_INVITE';
  end if;
  -- Lock the league, not just the invite: two invites to one league mustn't both take the last spot.
  select season_id into sid from public.leagues where id = inv.league_id for update;
  if exists (select 1 from public.memberships where league_id = inv.league_id and user_id = uid) then
    raise exception 'ALREADY_MEMBER';
  end if;
  if (select count(*) from public.memberships where league_id = inv.league_id)
     >= private.setting_num(sid, 'max_members', 6) then
    raise exception 'LEAGUE_FULL';
  end if;
  begin
    insert into public.memberships (league_id, user_id, team_name) values (inv.league_id, uid, t) returning id into mid;
  exception when unique_violation then raise exception 'TEAM_NAME_TAKEN';
  end;
  update public.invites set uses = uses + 1 where code = inv.code;
  perform private.audit('join_league', 'membership', mid::text, jsonb_build_object('league_id', inv.league_id, 'team_name', t, 'code', inv.code));
  return mid;
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

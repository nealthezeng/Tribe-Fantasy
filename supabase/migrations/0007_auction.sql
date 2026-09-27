-- M5 stage auction. Spec: docs/superpowers/specs/2026-09-26-m5-auction-design.md
alter table public.stages
  add column bid_close_at timestamptz,
  add column auction_seed text, -- set by run_auction (not at open) so fill order can't be worked out while bids are sealed
  add column auction_run_at timestamptz;

alter table public.credit_ledger drop constraint credit_ledger_kind_check;
alter table public.credit_ledger add constraint credit_ledger_kind_check
  check (kind in ('allowance', 'donation', 'adjustment', 'bid'));

-- Sealed until the stage's bid_close_at. league_id is copied from the membership so RLS needn't join.
create table public.bids (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  amount int not null check (amount >= 0),
  placed_at timestamptz not null default now(),
  unique (stage_id, membership_id, athlete_id)
);
create index bids_stage_league_idx on public.bids (stage_id, league_id);

-- One owner per athlete per league per stage (exclusive ownership).
create table public.roster_slots (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  price int not null check (price >= 0),
  via text not null check (via in ('bid', 'fill')),
  created_at timestamptz not null default now(),
  unique (stage_id, league_id, athlete_id)
);
create index roster_slots_membership_idx on public.roster_slots (membership_id);

alter table public.bids enable row level security;
alter table public.roster_slots enable row level security;
grant select on public.bids, public.roster_slots to authenticated;
-- memberships/user_roles RLS let a user see their own rows, which is all these subqueries need.
create policy bids_read on public.bids for select to authenticated using (
  membership_id in (select id from public.memberships where user_id = auth.uid())
  or ((select s.bid_close_at from public.stages s where s.id = bids.stage_id) <= now()
      and (league_id in (select league_id from public.memberships where user_id = auth.uid())
           or exists (select 1 from public.user_roles where user_id = auth.uid()))));
create policy roster_slots_read on public.roster_slots for select to authenticated using (
  league_id in (select league_id from public.memberships where user_id = auth.uid())
  or exists (select 1 from public.user_roles where user_id = auth.uid()));

create function private.balance(p_membership uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0)::int from public.credit_ledger where membership_id = p_membership
$$;

-- Keeper-confirmed and not cleared. An unconfirmed report doesn't count.
create function private.is_injured(p_athlete uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.injuries
                 where athlete_id = p_athlete and confirmed_at is not null and cleared_at is null)
$$;

-- Fallbacks mirror DEFAULT_SETTINGS in src/core/settings.ts.
create function private.setting_bool(p_season uuid, p_key text, p_default boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((settings ->> p_key)::boolean, p_default) from public.seasons where id = p_season
$$;

-- Replaces the 0004 stub (M5 gate): a slot in the latest stage of the athlete's season whose auction has run.
create or replace function private.owns_athlete(p_user uuid, p_athlete uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.roster_slots r join public.memberships m on m.id = r.membership_id
    where m.user_id = p_user and r.athlete_id = p_athlete and r.stage_id = (
      select s.id from public.stages s join public.athletes a on a.season_id = s.season_id
      where a.id = p_athlete and s.auction_run_at is not null
      order by s.starts_on desc limit 1))
$$;

create function private.check_bidding(p_stage public.stages) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_stage.bid_close_at is null then raise exception 'AUCTION_NOT_OPEN'; end if;
  if p_stage.auction_run_at is not null or now() >= p_stage.bid_close_at then raise exception 'BID_CLOSED'; end if;
end $$;

revoke all on all functions in schema private from public, anon, authenticated;

-- Sets or moves the close time (before close only) and runs the supply check: every league of the season needs
-- members × roster_size healthy opted-in athletes.
create function public.open_auction(p_stage uuid, p_close_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare st public.stages; roster int; healthy int; short text;
begin
  perform private.require_admin();
  select * into st from public.stages where id = p_stage for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if st.auction_run_at is not null then raise exception 'AUCTION_ALREADY_RUN'; end if;
  if st.bid_close_at <= now() then raise exception 'BID_CLOSED'; end if;
  if p_close_at is null or p_close_at <= now() then raise exception 'INVALID_CLOSE_TIME'; end if;
  roster := private.setting_num(st.season_id, 'roster_size', 4);
  select count(*) into healthy from public.athletes a
  where a.season_id = st.season_id and a.opted_in and not private.is_injured(a.id);
  select l.name into short from public.leagues l
  where l.season_id = st.season_id
    and (select count(*) from public.memberships m where m.league_id = l.id) * roster > healthy
  order by l.name limit 1;
  if short is not null then raise exception 'NOT_ENOUGH_ATHLETES' using detail = short; end if;
  update public.stages set bid_close_at = p_close_at where id = p_stage;
  perform private.audit('open_auction', 'stage', p_stage::text,
    jsonb_build_object('old_close_at', st.bid_close_at, 'close_at', p_close_at));
end $$;

-- Upsert; an edit resets placed_at. The total across a manager's bids isn't capped.
create function public.place_bid(p_stage uuid, p_membership uuid, p_athlete uuid, p_amount int) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); st public.stages; lid uuid; a public.athletes;
begin
  select * into st from public.stages where id = p_stage for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  select m.league_id into lid from public.memberships m join public.leagues l on l.id = m.league_id
  where m.id = p_membership and m.user_id = uid and l.season_id = st.season_id;
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
  if p_amount > private.balance(p_membership) then raise exception 'INSUFFICIENT_CREDITS'; end if;
  insert into public.bids (stage_id, membership_id, league_id, athlete_id, amount)
  values (p_stage, p_membership, lid, p_athlete, p_amount)
  on conflict (stage_id, membership_id, athlete_id) do update set amount = excluded.amount, placed_at = now();
  -- No amounts AND athletes here: admins read the audit log, and bids stay sealed until close.
  perform private.audit('place_bid', 'stage', p_stage::text,
    jsonb_build_object('membership_id', p_membership));
end $$;

create function public.delete_bid(p_stage uuid, p_membership uuid, p_athlete uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); st public.stages;
begin
  select * into st from public.stages where id = p_stage for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.memberships where id = p_membership and user_id = uid) then
    raise exception 'NOT_MEMBER';
  end if;
  perform private.check_bidding(st);
  delete from public.bids where stage_id = p_stage and membership_id = p_membership and athlete_id = p_athlete;
  perform private.audit('delete_bid', 'stage', p_stage::text,
    jsonb_build_object('membership_id', p_membership));
end $$;

-- Once per stage, after close, every league of the season in one transaction. Returns {by_bid, by_fill, empty}.
create function public.run_auction(p_stage uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_admin();
  st public.stages;
  roster int;
  allow_self boolean;
  b record; lg record; m record;
  aid uuid;
  by_bid int := 0;
  by_fill int := 0;
  empty int;
  progressed boolean;
begin
  select * into st from public.stages where id = p_stage for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if st.bid_close_at is null then raise exception 'AUCTION_NOT_OPEN'; end if;
  if st.auction_run_at is not null then raise exception 'AUCTION_ALREADY_RUN'; end if;
  if now() < st.bid_close_at then raise exception 'AUCTION_NOT_CLOSED'; end if;
  -- Create seed at run time so fill order can't be predicted while bids are sealed.
  st.auction_seed := coalesce(st.auction_seed, gen_random_uuid()::text);
  roster := private.setting_num(st.season_id, 'roster_size', 4);
  allow_self := private.setting_bool(st.season_id, 'allow_self_ownership', false);

  -- 1. Bids: highest first, then earliest, then id — the same order as allocate() in src/core/allocation.ts.
  -- Leagues are independent, so one pass over all of them is fine. The ledger is the running budget.
  for b in
    select bd.membership_id, bd.league_id, bd.athlete_id, bd.amount
    from public.bids bd
    join public.memberships mb on mb.id = bd.membership_id
    join public.athletes a on a.id = bd.athlete_id
    where bd.stage_id = p_stage and a.opted_in and (allow_self or a.user_id is distinct from mb.user_id)
    order by bd.amount desc, bd.placed_at, bd.id
  loop
    continue when exists (select 1 from public.roster_slots
                          where stage_id = p_stage and league_id = b.league_id and athlete_id = b.athlete_id);
    continue when (select count(*) from public.roster_slots
                   where stage_id = p_stage and membership_id = b.membership_id) >= roster;
    continue when private.balance(b.membership_id) < b.amount;
    insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
    values (p_stage, b.membership_id, b.league_id, b.athlete_id, b.amount, 'bid');
    if b.amount > 0 then
      insert into public.credit_ledger (membership_id, stage_id, kind, amount, created_by)
      values (b.membership_id, p_stage, 'bid', -b.amount, uid);
    end if;
    by_bid := by_bid + 1;
  end loop;

  -- 2. Fill at 0 credits: one athlete per manager per pass, both in seed order. Never an injured athlete.
  for lg in select id from public.leagues where season_id = st.season_id loop
    loop
      progressed := false;
      for m in select mb.id, mb.user_id from public.memberships mb where mb.league_id = lg.id
               order by md5(st.auction_seed || ':m:' || mb.id::text) loop
        continue when (select count(*) from public.roster_slots
                       where stage_id = p_stage and membership_id = m.id) >= roster;
        select a.id into aid from public.athletes a
        where a.season_id = st.season_id and a.opted_in and not private.is_injured(a.id)
          and (allow_self or a.user_id is distinct from m.user_id)
          and not exists (select 1 from public.roster_slots r
                          where r.stage_id = p_stage and r.league_id = lg.id and r.athlete_id = a.id)
        order by md5(st.auction_seed || ':a:' || a.id::text) limit 1;
        continue when not found;
        insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
        values (p_stage, m.id, lg.id, aid, 0, 'fill');
        by_fill := by_fill + 1;
        progressed := true;
      end loop;
      exit when not progressed;
    end loop;
  end loop;

  -- 3. Spots nobody could fill stay empty for the stage.
  select coalesce(sum(greatest(roster - (select count(*) from public.roster_slots r
                                         where r.stage_id = p_stage and r.membership_id = mb.id), 0)), 0)::int
  into empty
  from public.memberships mb join public.leagues l on l.id = mb.league_id
  where l.season_id = st.season_id;

  update public.stages set auction_run_at = now(), auction_seed = st.auction_seed where id = p_stage;
  perform private.audit('run_auction', 'stage', p_stage::text, jsonb_build_object(
    'seed', st.auction_seed, 'by_bid', by_bid, 'by_fill', by_fill, 'empty', empty));
  return jsonb_build_object('by_bid', by_bid, 'by_fill', by_fill, 'empty', empty);
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

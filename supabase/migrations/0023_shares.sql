-- M13 shares: fractional ownership, 6-player rosters with no bench, 2-pick games.
-- Spec: docs/superpowers/specs/2026-10-16-shares-design.md §4 (calls C3, C5, C9, C10).
-- Paste right before the push (drops the 4-arg set_game_pick the old bundle calls; the old League tab also reads
-- roster_slots.bench, which goes). Safe on top of 0001–0022 with bench-era rows still in place: bench flags and swaps
-- are dropped, old slots become whole shares (share 1).

-- One transaction: a failure part-way leaves nothing half-applied.
begin;

-- parseSettings rejects unknown keys, and the settings editor saved every key, so these are in stored settings (C8).
update public.seasons set settings = settings - 'bench_size' - 'exclusive_ownership';

-- Many teams may own one player in a league now; one row per (team, player).
alter table public.roster_slots drop constraint roster_slots_stage_id_league_id_athlete_id_key;
alter table public.roster_slots add constraint roster_slots_stage_id_membership_id_athlete_id_key
  unique (stage_id, membership_id, athlete_id);
-- The part of the player this team owns: credits / max(min_shares, credits put on him in the league).
alter table public.roster_slots add column share numeric not null default 1 check (share > 0 and share <= 1);

-- Up to picks_per_game rows per team per game.
alter table public.game_picks drop constraint game_picks_pkey;
alter table public.game_picks add primary key (stage_id, game_number, membership_id, athlete_id);

-- As 0012 without the game-1 bench default (C3). Redefined before the bench column goes.
create or replace function public.start_game(p_game uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_keeper(); g public.games; season uuid; sid uuid;
begin
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.started_at is not null then raise exception 'GAME_STARTED'; end if;
  if exists (select 1 from public.games where stage_id = g.stage_id and number < g.number and finished_at is null) then
    raise exception 'PREVIOUS_GAME_LIVE';
  end if;
  select season_id into season from public.stages where id = g.stage_id;
  insert into public.sessions (season_id, kind, held_on, counts, created_by)
  values (season, 'tournament', (now() at time zone 'America/New_York')::date, true, uid) returning id into sid;
  update public.games set session_id = sid, started_at = now() where id = p_game;
  perform private.audit('start_game', 'game', p_game::text, jsonb_build_object('session_id', sid, 'number', g.number));
  return sid;
end $$;

alter table public.roster_slots drop column bench;

-- How many picks a team owes for a game (C9): picks_per_game, or its whole roster if that is shorter.
create function private.picks_wanted(p_stage uuid, p_membership uuid) returns int
language sql stable security definer set search_path = '' as $$
  select least(private.setting_num(st.season_id, 'picks_per_game', 2)::int,
    (select count(*)::int from public.roster_slots where stage_id = p_stage and membership_id = p_membership))
  from public.stages st where st.id = p_stage
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- As 0007 with the supply check reduced to C10: shares aren't exclusive, so only zero healthy opted-in players
-- is refused.
create or replace function public.open_auction(p_stage uuid, p_close_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare st public.stages;
begin
  perform private.require_admin();
  select * into st from public.stages where id = p_stage for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if st.auction_run_at is not null then raise exception 'AUCTION_ALREADY_RUN'; end if;
  if st.bid_close_at <= now() then raise exception 'BID_CLOSED'; end if;
  if p_close_at is null or p_close_at <= now() then raise exception 'INVALID_CLOSE_TIME'; end if;
  if not exists (select 1 from public.athletes a
                 where a.season_id = st.season_id and a.opted_in and not private.is_injured(a.id)) then
    raise exception 'NOT_ENOUGH_ATHLETES';
  end if;
  update public.stages set bid_close_at = p_close_at where id = p_stage;
  perform private.audit('open_auction', 'stage', p_stage::text,
    jsonb_build_object('old_close_at', st.bid_close_at, 'close_at', p_close_at));
end $$;

-- As 0010 plus TOO_MANY_PLAYERS: buys on at most roster_size players per tournament. The membership row lock
-- serialises one manager's bids, so the count can't race.
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
  if (select count(*) from public.bids where stage_id = p_stage and membership_id = p_membership and athlete_id <> p_athlete)
     >= private.setting_num(st.season_id, 'roster_size', 6) then
    raise exception 'TOO_MANY_PLAYERS';
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

-- Share settlement (§4), mirroring settleShares in src/core/allocation.ts. No fill, so no seed.
create or replace function public.run_auction(p_stage uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_admin();
  st public.stages;
  min_shares numeric;
  roster int;
  allow_self boolean;
  b record;
  cur uuid;
  budget int;
  n int;
  kept uuid[] := '{}';
  by_bid int;
  empty int;
begin
  select * into st from public.stages where id = p_stage for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if st.bid_close_at is null then raise exception 'AUCTION_NOT_OPEN'; end if;
  if st.auction_run_at is not null then raise exception 'AUCTION_ALREADY_RUN'; end if;
  if now() < st.bid_close_at then raise exception 'AUCTION_NOT_CLOSED'; end if;
  min_shares := private.setting_num(st.season_id, 'min_shares', 200);
  roster := private.setting_num(st.season_id, 'roster_size', 6);
  allow_self := private.setting_bool(st.season_id, 'allow_self_ownership', false);

  -- 1. Kept buys (C5): per team, eligible buys largest first (then earliest, then id); keep one while it fits the
  -- remaining balance and the roster has room, else drop it and try the smaller ones.
  for b in
    select bd.id, bd.membership_id, bd.amount
    from public.bids bd
    join public.memberships mb on mb.id = bd.membership_id
    join public.athletes a on a.id = bd.athlete_id
    where bd.stage_id = p_stage and bd.amount > 0 and a.opted_in and (allow_self or a.user_id is distinct from mb.user_id)
    order by bd.membership_id, bd.amount desc, bd.placed_at, bd.id
  loop
    if cur is distinct from b.membership_id then
      cur := b.membership_id;
      budget := private.balance(cur);
      n := 0;
    end if;
    continue when n >= roster or b.amount > budget;
    budget := budget - b.amount;
    n := n + 1;
    kept := kept || b.id;
  end loop;

  -- 2–3. Pool per (league, player) = max(min_shares, kept credits on him); one slot and one charge per kept buy.
  with k as (
    select bd.membership_id, bd.league_id, bd.athlete_id, bd.amount,
      greatest(min_shares, sum(bd.amount) over (partition by bd.league_id, bd.athlete_id)) as pool
    from public.bids bd where bd.id = any (kept)
  ), s as (
    insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, share, via)
    select p_stage, k.membership_id, k.league_id, k.athlete_id, k.amount, k.amount / k.pool, 'bid' from k
    returning membership_id, price
  )
  insert into public.credit_ledger (membership_id, stage_id, kind, amount, created_by)
  select s.membership_id, p_stage, 'bid', -s.price, uid from s;
  get diagnostics by_bid = row_count;

  -- 4. No fill: open spots summed over teams.
  select coalesce(sum(greatest(roster - (select count(*) from public.roster_slots r
                                         where r.stage_id = p_stage and r.membership_id = mb.id), 0)), 0)::int
  into empty
  from public.memberships mb join public.leagues l on l.id = mb.league_id
  where l.season_id = st.season_id;

  update public.stages set auction_run_at = now() where id = p_stage;
  perform private.audit('run_auction', 'stage', p_stage::text, jsonb_build_object('by_bid', by_bid, 'empty', empty));
  return jsonb_build_object('by_bid', by_bid, 'empty', empty);
end $$;

-- The team's whole pick set for the next game: 0 to picks_per_game players on its roster (a repeat counts once);
-- NULL or {} clears it. Tiredness and injuries are NOT checked: src/core/tournament.ts replaces an invalid pick at the
-- start, so those rules live in one place.
drop function public.set_game_pick(uuid, uuid, int, uuid);
create function public.set_game_pick(p_membership uuid, p_stage uuid, p_number int, p_athletes uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); season uuid; lid uuid; nxt int; picks uuid[];
begin
  select season_id into season from public.stages where id = p_stage;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- Locking the membership row serialises one team's calls, so two overlapping sets can't both delete-then-insert
  -- past picks_per_game (as place_bid).
  select league_id into lid from public.memberships where id = p_membership and user_id = uid for update;
  if not found then raise exception 'NOT_MEMBER'; end if;
  -- Waits for a concurrent start_game, so a pick can't slip in after its game starts.
  perform 1 from public.games where stage_id = p_stage for share;
  nxt := private.next_game(p_stage);
  if p_number is null or p_number < nxt then raise exception 'PICK_LOCKED'; end if;
  if p_number > nxt then raise exception 'NOT_NEXT_GAME'; end if;
  select coalesce(array_agg(distinct a), '{}') into picks from unnest(coalesce(p_athletes, '{}')) a;
  if cardinality(picks) > private.setting_num(season, 'picks_per_game', 2) then raise exception 'TOO_MANY_PICKS'; end if;
  if exists (select 1 from unnest(picks) a where not exists (
       select 1 from public.roster_slots where stage_id = p_stage and membership_id = p_membership and athlete_id = a)) then
    raise exception 'NOT_ON_ROSTER';
  end if;
  delete from public.game_picks where stage_id = p_stage and game_number = p_number and membership_id = p_membership;
  insert into public.game_picks (stage_id, game_number, membership_id, league_id, athlete_id)
  select p_stage, p_number, p_membership, lid, a from unnest(picks) a;
  -- No athletes here: admins read the audit log, and picks stay sealed until the game starts.
  perform private.audit('set_game_pick', 'stage', p_stage::text, jsonb_build_object('membership_id', p_membership, 'number', p_number));
end $$;

-- As 0013 without bench swaps.
create or replace function public.delete_athlete(p_athlete uuid, p_force boolean default false) returns void
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
      or exists (select 1 from public.game_picks where athlete_id = p_athlete) then
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
      'picks', (select count(*) from public.game_picks where athlete_id = p_athlete),
      'refunded', refunded);
  end if;
  delete from public.athletes where id = p_athlete;
  perform private.audit('delete_athlete', 'athlete', p_athlete::text,
    jsonb_build_object('season_id', a.season_id, 'name', a.name, 'user_id', a.user_id, 'force', f) || removed);
end $$;

-- As 0016 with share-buying words ("bid" and "auction" are gone from player-facing copy).
create or replace function private.queue_bid_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into private.outbox (membership_id, kind, ref, subject, body)
  select m.id, k.kind, private.bid_ref(s.id, s.bid_close_at),
    format('Buying shares for %s closes in %s', s.name, k.label),
    format('%s: buying shares for %s closes %s ET. %s', m.team_name, s.name,
      to_char(s.bid_close_at at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM'),
      case b.n when 0 then 'You haven''t bought any shares yet.' when 1 then 'You''re buying shares in 1 player.'
        else format('You''re buying shares in %s players.', b.n) end)
      || private.email_footer()
  from public.stages s
  cross join lateral (
    select case when s.bid_close_at - now() <= interval '2 hours' then 'bid_2h' else 'bid_24h' end as kind,
           case when s.bid_close_at - now() <= interval '2 hours' then '2 hours' else '24 hours' end as label
  ) k
  join public.leagues l on l.season_id = s.season_id
  join public.memberships m on m.league_id = l.id
  cross join lateral (select count(*)::int as n from public.bids bd where bd.stage_id = s.id and bd.membership_id = m.id) b
  where s.bid_close_at > now() and s.bid_close_at <= now() + interval '24 hours' and s.auction_run_at is null
    and private.wants_email(m.id)
  on conflict (membership_id, kind, ref) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- As 0017, with C9: a side is told while its picks number fewer than private.picks_wanted.
create or replace function private.queue_pick_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  if new.away is null then return null; end if;
  select gm.id, gm.number, gm.stage_id, st.name as stage into g
  from public.games gm join public.stages st on st.id = gm.stage_id where gm.id = new.game_id;
  insert into private.outbox (membership_id, kind, ref, subject, body)
  select me.id, 'pick_next', g.id::text,
    format('Pick your players for game %s', g.number),
    format('%s: game %s of %s is next. You play %s. Pick your %s on the League page, or we''ll start your '
      || 'most rested healthy players for you.', me.team_name, g.number, g.stage, opp.team_name,
      case w.n when 1 then 'player' else w.n || ' players' end)
      || private.email_footer()
  from (values (new.home, new.away), (new.away, new.home)) v (me_id, opp_id)
  join public.memberships me on me.id = v.me_id
  join public.memberships opp on opp.id = v.opp_id
  cross join lateral (select private.picks_wanted(g.stage_id, me.id) as n) w
  where private.wants_email(me.id)
    and (select count(*) from public.game_picks p
         where p.stage_id = g.stage_id and p.game_number = g.number and p.membership_id = me.id) < w.n
  on conflict (membership_id, kind, ref) do nothing;
  return null;
end $$;

-- As 0016, with the same C9 re-check for a pick notice.
create or replace function private.claim_outbox(p_limit int)
returns table (id bigint, email text, subject text, body text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with c as (
    select o.id from private.outbox o
    where o.sent_at is null and o.tries < 3
      and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
      and o.created_at > now() - interval '30 minutes'
      and (o.kind not in ('bid_24h', 'bid_2h') or exists (
        select 1 from public.stages s
        where o.ref = private.bid_ref(s.id, s.bid_close_at) and s.bid_close_at > now() and s.auction_run_at is null))
      and (o.kind <> 'pick_next' or exists (
        select 1 from public.games g where g.id::text = o.ref and g.started_at is null
          and (select count(*) from public.game_picks p
               where p.stage_id = g.stage_id and p.game_number = g.number and p.membership_id = o.membership_id)
              < private.picks_wanted(g.stage_id, o.membership_id)))
    order by o.id
    limit p_limit
    for update of o skip locked
  ), u as (
    update private.outbox o set claimed_at = now(), tries = o.tries + 1
    from c where o.id = c.id
    returning o.id, o.membership_id, o.subject, o.body
  )
  select u.id, au.email::text, u.subject, u.body
  from u
  join public.memberships m on m.id = u.membership_id
  join auth.users au on au.id = m.user_id
  where au.email is not null
  order by u.id;
end $$;

-- max_members' fallback follows DEFAULT_SETTINGS (6 → 12, C8). Otherwise as 0006 / 0019.
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
     >= private.setting_num(sid, 'max_members', 12) then
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

create or replace function public.list_leagues()
returns table (id uuid, name text, teams int, max_teams int, has_password boolean, is_member boolean, is_creator boolean)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user(); sid uuid := private.current_season();
begin
  return query
    select l.id, l.name,
      (select count(*)::int from public.memberships m where m.league_id = l.id),
      private.setting_num(sid, 'max_members', 12)::int,
      exists (select 1 from private.league_passwords p where p.league_id = l.id),
      exists (select 1 from public.memberships m where m.league_id = l.id and m.user_id = uid),
      l.created_by is not distinct from uid
    from public.leagues l where l.season_id = sid order by l.name;
end $$;

create or replace function public.join_open_league(p_league uuid, p_password text, p_team_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  l public.leagues;
  h text;
  mid uuid;
  t text := btrim(coalesce(p_team_name, ''));
begin
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'NO_PROFILE'; end if;
  if length(t) < 1 or length(t) > 40 then raise exception 'INVALID_TEAM_NAME'; end if;
  -- The league row lock stops two joins from both taking the last spot.
  select * into l from public.leagues where id = p_league for update;
  if not found or l.season_id <> private.current_season() then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.memberships where league_id = l.id and user_id = uid) then
    raise exception 'ALREADY_MEMBER';
  end if;
  if (select count(*) from public.memberships where league_id = l.id) >= private.setting_num(l.season_id, 'max_members', 12) then
    raise exception 'LEAGUE_FULL';
  end if;
  select hash into h from private.league_passwords where league_id = l.id;
  if h is not null and extensions.crypt(btrim(coalesce(p_password, '')), h) <> h then
    raise exception 'WRONG_PASSWORD';
  end if;
  begin
    insert into public.memberships (league_id, user_id, team_name) values (l.id, uid, t) returning id into mid;
  exception when unique_violation then raise exception 'TEAM_NAME_TAKEN';
  end;
  perform private.audit('join_open_league', 'membership', mid::text, jsonb_build_object('league_id', l.id, 'team_name', t));
  return mid;
end $$;

-- The bench (C3).
drop function public.set_bench(uuid, uuid, uuid[]);
drop function public.swap_bench(uuid, uuid, uuid, uuid);
drop function private.bench_count(uuid, int);
drop table public.bench_swaps;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

commit;

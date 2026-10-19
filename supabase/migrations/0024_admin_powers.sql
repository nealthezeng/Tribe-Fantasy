-- M14 admin powers: free share edits on any team, account removal that keeps the team, team renames, display-name
-- fixes, the user list, and admin reads of sealed bids and picks.
-- Spec: docs/superpowers/specs/2026-10-19-m14-admin-design.md §5.3, §5.4, §6.
-- Paste right before the push (the new bundle calls the new RPCs). Safe on top of 0001–0023: every change is a new
-- column or function, a looser constraint, or a function redefined with one extra condition.

-- One transaction: a failure part-way leaves nothing half-applied.
begin;

-- A slot counts for game n when from_game <= n and (until_game is null or n < until_game). Games already started keep
-- the roster they started with: ending a played slot sets until_game, and a new slot starts at the next game.
alter table public.roster_slots add column from_game int not null default 1 check (from_game >= 1);
alter table public.roster_slots add column until_game int check (until_game > from_game);
alter table public.roster_slots drop constraint roster_slots_stage_id_membership_id_athlete_id_key;
alter table public.roster_slots add constraint roster_slots_stage_id_membership_id_athlete_id_from_game_key
  unique (stage_id, membership_id, athlete_id, from_game);
alter table public.roster_slots drop constraint roster_slots_via_check;
alter table public.roster_slots add constraint roster_slots_via_check check (via in ('bid', 'fill', 'admin'));

-- A removed account keeps its team: user_id goes null when the auth user is deleted, removed_at marks the team.
alter table public.memberships add column removed_at timestamptz;
alter table public.memberships alter column user_id drop not null;
alter table public.memberships drop constraint memberships_user_id_fkey;
alter table public.memberships add constraint memberships_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

-- A keeper who is removed leaves their taps behind.
alter table public.stat_taps alter column keeper_id drop not null;
alter table public.stat_taps drop constraint stat_taps_keeper_id_fkey;
alter table public.stat_taps add constraint stat_taps_keeper_id_fkey
  foreign key (keeper_id) references auth.users (id) on delete set null;

-- As 0012, but a removed team is not expected in the pairings.
create or replace function private.check_pairings(p_stage uuid, p_pairings jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare season uuid; bad boolean;
begin
  select season_id into season from public.stages where id = p_stage;
  if p_pairings is null or jsonb_typeof(p_pairings) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_pairings) e where jsonb_typeof(e) <> 'object') then
    raise exception 'PAIRINGS_INVALID';
  end if;
  begin
    with p as (
      select (e ->> 'league_id')::uuid as league_id, (e ->> 'home')::uuid as home, (e ->> 'away')::uuid as away
      from jsonb_array_elements(p_pairings) e
    ), ids as (
      select league_id, home as id from p union all select league_id, away from p where away is not null
    ), expected as (
      select m.id, m.league_id from public.memberships m join public.leagues l on l.id = m.league_id
      where l.season_id = season and m.created_at <= now() and m.removed_at is null
    )
    select exists (select 1 from ids left join expected x on x.id = ids.id and x.league_id = ids.league_id where x.id is null)
        or exists (select id from ids group by id having count(*) > 1)
        or exists (select 1 from expected x where not exists (select 1 from ids where ids.id = x.id))
        or exists (select 1 from p where away is null group by league_id having count(*) > 1)
      into bad;
  exception when invalid_text_representation then
    raise exception 'PAIRINGS_INVALID';
  end;
  if bad then raise exception 'PAIRINGS_INVALID'; end if;
end $$;

-- As 0023, but only slots live at the next game count.
create or replace function private.picks_wanted(p_stage uuid, p_membership uuid) returns int
language sql stable security definer set search_path = '' as $$
  select least(private.setting_num(st.season_id, 'picks_per_game', 2)::int,
    (select count(*)::int from public.roster_slots
     where stage_id = p_stage and membership_id = p_membership
       and from_game <= private.next_game(p_stage)
       and (until_game is null or private.next_game(p_stage) < until_game)))
  from public.stages st where st.id = p_stage
$$;

-- As 0023, but only slots live at the next game can be picked.
create or replace function public.set_game_pick(p_membership uuid, p_stage uuid, p_number int, p_athletes uuid[]) returns void
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
       select 1 from public.roster_slots where stage_id = p_stage and membership_id = p_membership and athlete_id = a
         and from_game <= nxt and (until_game is null or nxt < until_game))) then
    raise exception 'NOT_ON_ROSTER';
  end if;
  delete from public.game_picks where stage_id = p_stage and game_number = p_number and membership_id = p_membership;
  insert into public.game_picks (stage_id, game_number, membership_id, league_id, athlete_id)
  select p_stage, p_number, p_membership, lid, a from unnest(picks) a;
  -- No athletes here: admins read the audit log, and picks stay sealed until the game starts.
  perform private.audit('set_game_pick', 'stage', p_stage::text, jsonb_build_object('membership_id', p_membership, 'number', p_number));
end $$;

-- As 0023, but a removed team no longer takes a spot.
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
  if (select count(*) from public.memberships where league_id = inv.league_id and removed_at is null)
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

-- As 0023, but only live teams are counted.
create or replace function public.list_leagues()
returns table (id uuid, name text, teams int, max_teams int, has_password boolean, is_member boolean, is_creator boolean)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user(); sid uuid := private.current_season();
begin
  return query
    select l.id, l.name,
      (select count(*)::int from public.memberships m where m.league_id = l.id and m.removed_at is null),
      private.setting_num(sid, 'max_members', 12)::int,
      exists (select 1 from private.league_passwords p where p.league_id = l.id),
      exists (select 1 from public.memberships m where m.league_id = l.id and m.user_id = uid),
      l.created_by is not distinct from uid
    from public.leagues l where l.season_id = sid order by l.name;
end $$;

-- As 0023, but a removed team no longer takes a spot.
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
  if (select count(*) from public.memberships where league_id = l.id and removed_at is null)
     >= private.setting_num(l.season_id, 'max_members', 12) then
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

-- As 0022, but a removed donor (user_id null) shows as "Removed user"; the join to profiles becomes a left join.
create or replace function public.donation_leaderboard(p_season uuid)
returns table (name text, dollars numeric, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not public.can_read_league_data() then raise exception 'FORBIDDEN'; end if;
  return query
    select case when m.user_id is null then 'Removed user' when coalesce(d.anonymous, false) then null
                else p.display_name end,
      sum(c.dollars), coalesce(m.user_id = uid, false)
    from public.credit_ledger c
    join public.memberships m on m.id = c.membership_id
    join public.leagues l on l.id = m.league_id
    left join public.profiles p on p.id = m.user_id
    left join private.donor_prefs d on d.user_id = m.user_id
    where c.kind = 'donation' and l.season_id = p_season
    group by m.user_id, d.anonymous, p.display_name
    order by 2 desc, 1 nulls last, 3 desc;
end $$;

-- Give, change or take a share of a player on any team, for free (§5.4). Never touches credits. percent null or 0
-- removes. Started games keep their roster: a played slot is ended at the next game instead of deleted, and its
-- replacement starts there. An unplayed slot (from_game >= next game) is edited or deleted in place.
create function public.admin_set_share(p_stage uuid, p_membership uuid, p_athlete uuid, p_percent int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  st public.stages;
  n int;
  cur public.roster_slots;
  lid uuid;
  remove boolean := p_percent is null or p_percent = 0;
  old_percent int := 0;
begin
  perform private.require_admin();
  select * into st from public.stages where id = p_stage for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  if st.auction_run_at is null then raise exception 'SHARES_NOT_SETTLED'; end if;
  if not remove and p_percent not between 1 and 100 then raise exception 'INVALID_PERCENT'; end if;
  -- The membership row lock serialises edits to one team (as place_bid).
  select m.league_id into lid from public.memberships m join public.leagues l on l.id = m.league_id
  where m.id = p_membership and l.season_id = st.season_id for update of m;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (select removed_at from public.memberships where id = p_membership) is not null then
    raise exception 'TEAM_REMOVED';
  end if;
  if not exists (select 1 from public.athletes where id = p_athlete and season_id = st.season_id) then
    raise exception 'NOT_FOUND';
  end if;
  -- Adding or changing needs an opted-in player; taking one off never does.
  if not remove and not exists (select 1 from public.athletes where id = p_athlete and opted_in) then
    raise exception 'NOT_OPTED_IN';
  end if;
  -- Waits for a concurrent start_game, so the next game can't move under us.
  perform 1 from public.games where stage_id = p_stage for share;
  n := private.next_game(p_stage);
  select * into cur from public.roster_slots
  where stage_id = p_stage and membership_id = p_membership and athlete_id = p_athlete and until_game is null for update;
  if found then
    old_percent := round(cur.share * 100)::int;
    if cur.from_game >= n then
      if remove then delete from public.roster_slots where id = cur.id;
      else update public.roster_slots set share = p_percent / 100.0 where id = cur.id;
      end if;
    else
      update public.roster_slots set until_game = n where id = cur.id;
      if not remove then
        insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, share, via, from_game)
        values (p_stage, p_membership, lid, p_athlete, 0, p_percent / 100.0, 'admin', n);
      end if;
    end if;
  else
    if remove then raise exception 'NOT_FOUND'; end if;
    insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, share, via, from_game)
    values (p_stage, p_membership, lid, p_athlete, 0, p_percent / 100.0, 'admin', n);
  end if;
  if remove then
    delete from public.game_picks
    where stage_id = p_stage and membership_id = p_membership and athlete_id = p_athlete and game_number = n;
  end if;
  perform private.audit('admin_set_share', 'membership', p_membership::text, jsonb_build_object(
    'stage', p_stage, 'membership', p_membership, 'athlete', p_athlete,
    'old_percent', old_percent, 'new_percent', coalesce(p_percent, 0), 'from_game', n));
end $$;

create function public.admin_rename_team(p_membership uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; t text := btrim(coalesce(p_name, ''));
begin
  perform private.require_admin();
  if length(t) < 1 or length(t) > 40 then raise exception 'INVALID_TEAM_NAME'; end if;
  select * into m from public.memberships where id = p_membership for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  begin
    update public.memberships set team_name = t where id = p_membership;
  exception when unique_violation then raise exception 'TEAM_NAME_TAKEN';
  end;
  perform private.audit('admin_rename_team', 'membership', p_membership::text, jsonb_build_object('old', m.team_name, 'new', t));
end $$;

create function public.admin_set_display_name(p_user uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text; old text;
begin
  perform private.require_admin();
  v := private.clean_name(p_name, 60);
  select display_name into old from public.profiles where id = p_user for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.profiles set display_name = v where id = p_user;
  perform private.audit('admin_set_display_name', 'profile', p_user::text, jsonb_build_object('user', p_user, 'old', old, 'new', v));
end $$;

-- Every account (§5.3). The Users tab filters it in the browser.
create function public.list_users() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare sid uuid;
begin
  perform private.require_admin();
  -- Same pick as private.current_season(), but no error before the first season exists.
  select id into sid from public.seasons order by created_at desc, id desc limit 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'display_name', p.display_name,
      'roles', coalesce((select jsonb_agg(r.role order by r.role) from public.user_roles r where r.user_id = u.id), '[]'),
      'teams', coalesce((select jsonb_agg(jsonb_build_object(
          'membership_id', m.id, 'league', l.name, 'team', m.team_name, 'season', s.name) order by s.created_at, l.name)
        from public.memberships m join public.leagues l on l.id = m.league_id join public.seasons s on s.id = l.season_id
        where m.user_id = u.id), '[]'),
      'athlete', (select jsonb_build_object('id', a.id, 'name', a.name) from public.athletes a
                  where a.user_id = u.id and a.season_id = sid limit 1),
      'donations', jsonb_build_object(
        'count', (select count(*)::int from public.credit_ledger c join public.memberships m on m.id = c.membership_id
                  where m.user_id = u.id and c.kind = 'donation'),
        'dollars', (select coalesce(sum(c.dollars), 0) from public.credit_ledger c join public.memberships m on m.id = c.membership_id
                    where m.user_id = u.id and c.kind = 'donation'))
    ) order by p.display_name nulls last, u.email)
    from auth.users u left join public.profiles p on p.id = u.id), '[]');
end $$;

-- Remove an account but keep its team, donations and games (§5.3). No undo.
create function public.admin_remove_user(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_admin();
  u auth.users;
  p public.profiles;
  teams text[];
  mids uuid[];
  donations int;
begin
  if p_user = uid then raise exception 'CANNOT_REMOVE_SELF'; end if;
  -- ponytail: same order as leave_league (see its comment): the ledger first, then the league rows, so a donation
  -- can't slip in after the count below and a concurrent run_auction can't deadlock with league-first.
  lock table public.credit_ledger in share mode;
  select * into u from auth.users where id = p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into p from public.profiles where id = p_user;
  perform 1 from public.leagues where id in (select league_id from public.memberships where user_id = p_user)
  order by id for update;
  select coalesce(array_agg(id), '{}'), coalesce(array_agg(team_name order by team_name), '{}') into mids, teams
  from public.memberships where user_id = p_user;
  select count(*)::int into donations from public.credit_ledger where membership_id = any (mids) and kind = 'donation';
  update public.memberships set removed_at = now() where id = any (mids);
  delete from public.bids where membership_id = any (mids)
    and stage_id in (select id from public.stages where auction_run_at is null);
  delete from private.outbox where membership_id = any (mids) and sent_at is null;
  update public.athletes set user_id = null where user_id = p_user;
  -- user_id on the memberships and keeper_id on taps go null; profile, roles and donor prefs cascade.
  delete from auth.users where id = p_user;
  perform private.audit('admin_remove_user', 'profile', p_user::text, jsonb_build_object(
    'user', p_user, 'email', u.email, 'display_name', p.display_name, 'teams', to_jsonb(teams), 'donations', donations));
  return jsonb_build_object('teams', cardinality(mids), 'donations', donations);
end $$;

-- Admins read sealed rows: share buys before buying closes, picks before the game starts. The existing "any role"
-- clause (keepers, treasurers) stays limited to after close / after start.
drop policy bids_read on public.bids;
create policy bids_read on public.bids for select to authenticated using (
  membership_id in (select id from public.memberships where user_id = auth.uid())
  or ((select s.bid_close_at from public.stages s where s.id = bids.stage_id) <= now()
      and (league_id in (select league_id from public.memberships where user_id = auth.uid())
           or exists (select 1 from public.user_roles where user_id = auth.uid())))
  or public.is_admin());
drop policy game_picks_read on public.game_picks;
create policy game_picks_read on public.game_picks for select to authenticated using (
  membership_id in (select id from public.memberships where user_id = auth.uid())
  or (exists (select 1 from public.games g where g.stage_id = game_picks.stage_id and g.number = game_picks.game_number
              and g.started_at is not null)
      and (league_id in (select league_id from public.memberships where user_id = auth.uid())
           or exists (select 1 from public.user_roles where user_id = auth.uid())))
  or public.is_admin());

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

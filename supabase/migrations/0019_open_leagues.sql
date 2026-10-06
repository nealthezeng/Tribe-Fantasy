-- Open leagues (t215): anyone signed in creates or joins a league of the current season; a league is public or has a
-- password. Seasons stay admin-only. Spec: docs/superpowers/specs/2026-10-06-open-leagues-design.md.
-- Additive: the old create_league / create_invite / join_league stay (admin-made codes still work, the app no longer
-- offers them), so this is safe to paste before the new build deploys.

create extension if not exists pgcrypto with schema extensions;

alter table public.leagues add column created_by uuid references auth.users (id) on delete set null;

-- Not on public.leagues: leagues_read is `using (true)`, so a column there would be readable by everyone.
create table private.league_passwords (
  league_id uuid primary key references public.leagues (id) on delete cascade,
  hash text not null
);

-- The newest season, as the app's loadCurrentSeason picks it.
create function private.current_season() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare sid uuid;
begin
  select id into sid from public.seasons order by created_at desc, id desc limit 1;
  if sid is null then raise exception 'NO_SEASON'; end if;
  return sid;
end $$;

-- Blank = no password (public league); otherwise 4-40 characters after trimming.
create function private.clean_password(p_password text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_password, '')), '');
begin
  if v is not null and length(v) not between 4 and 40 then raise exception 'INVALID_PASSWORD'; end if;
  return v;
end $$;

-- The league, locked, if the caller made it or is an admin. Old leagues (created_by null) are admin-only.
create function private.owned_league(p_league uuid) returns public.leagues
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); l public.leagues;
begin
  select * into l from public.leagues where id = p_league for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if l.created_by is distinct from uid and not public.is_admin() then raise exception 'NOT_LEAGUE_OWNER'; end if;
  return l;
end $$;

revoke all on all functions in schema private from public, anon, authenticated;

-- Membership rows are hidden from non-members, so the "N of M teams" count comes from here.
create function public.list_leagues()
returns table (id uuid, name text, teams int, max_teams int, has_password boolean, is_member boolean, is_creator boolean)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user(); sid uuid := private.current_season();
begin
  return query
    select l.id, l.name,
      (select count(*)::int from public.memberships m where m.league_id = l.id),
      private.setting_num(sid, 'max_members', 6)::int,
      exists (select 1 from private.league_passwords p where p.league_id = l.id),
      exists (select 1 from public.memberships m where m.league_id = l.id and m.user_id = uid),
      l.created_by is not distinct from uid
    from public.leagues l where l.season_id = sid order by l.name;
end $$;

create function public.create_my_league(p_name text, p_password text, p_team_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  sid uuid;
  v text;
  pw text;
  t text := btrim(coalesce(p_team_name, ''));
  lid uuid;
begin
  -- Locking the profile row serialises one user's creates, so two at once can't both pass CREATE_LIMIT.
  perform 1 from public.profiles where id = uid for update;
  if not found then raise exception 'NO_PROFILE'; end if;
  v := private.clean_name(p_name, 60);
  pw := private.clean_password(p_password);
  if length(t) < 1 or length(t) > 40 then raise exception 'INVALID_TEAM_NAME'; end if;
  sid := private.current_season();
  if not public.is_admin() and exists (select 1 from public.leagues where season_id = sid and created_by = uid) then
    raise exception 'CREATE_LIMIT';
  end if;
  begin
    insert into public.leagues (season_id, name, created_by) values (sid, v, uid) returning id into lid;
  exception when unique_violation then raise exception 'LEAGUE_EXISTS';
  end;
  if pw is not null then
    insert into private.league_passwords (league_id, hash) values (lid, extensions.crypt(pw, extensions.gen_salt('bf')));
  end if;
  insert into public.memberships (league_id, user_id, team_name) values (lid, uid, t);
  perform private.audit('create_my_league', 'league', lid::text,
    jsonb_build_object('season_id', sid, 'name', v, 'team_name', t, 'has_password', pw is not null));
  return lid;
end $$;

-- join_league's checks and locking (0006), with a league id and password instead of an invite code.
create function public.join_open_league(p_league uuid, p_password text, p_team_name text) returns uuid
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
  if (select count(*) from public.memberships where league_id = l.id) >= private.setting_num(l.season_id, 'max_members', 6) then
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

create function public.rename_league(p_league uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leagues := private.owned_league(p_league); v text := private.clean_name(p_name, 60);
begin
  begin
    update public.leagues set name = v where id = l.id;
  exception when unique_violation then raise exception 'LEAGUE_EXISTS';
  end;
  perform private.audit('rename_league', 'league', l.id::text, jsonb_build_object('old', l.name, 'new', v));
end $$;

-- Blank = make the league public. The audit row never holds the password.
create function public.set_league_password(p_league uuid, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leagues := private.owned_league(p_league); pw text := private.clean_password(p_password);
begin
  if pw is null then
    delete from private.league_passwords where league_id = l.id;
  else
    insert into private.league_passwords (league_id, hash) values (l.id, extensions.crypt(pw, extensions.gen_salt('bf')))
    on conflict (league_id) do update set hash = excluded.hash;
  end if;
  perform private.audit('set_league_password', 'league', l.id::text, jsonb_build_object('has_password', pw is not null));
end $$;

-- Admins delete any league; its creator only while they're its only team. Never one with donation records:
-- memberships cascade into the ledger (same ruling as delete_season).
create function public.delete_league(p_league uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leagues; counts jsonb;
begin
  -- ponytail: as delete_season, blocks ledger inserts while the delete runs so a donation can't slip in.
  lock table public.credit_ledger in share mode;
  l := private.owned_league(p_league);
  if not public.is_admin()
     and exists (select 1 from public.memberships where league_id = l.id and user_id is distinct from auth.uid()) then
    raise exception 'LEAGUE_HAS_TEAMS';
  end if;
  if exists (select 1 from public.credit_ledger c join public.memberships m on m.id = c.membership_id
             where m.league_id = l.id and c.kind = 'donation') then
    raise exception 'LEAGUE_HAS_DONATIONS';
  end if;
  counts := jsonb_build_object(
    'memberships', (select count(*) from public.memberships where league_id = l.id),
    'ledger_rows', (select count(*) from public.credit_ledger c join public.memberships m on m.id = c.membership_id
                    where m.league_id = l.id));
  delete from public.leagues where id = l.id;
  perform private.audit('delete_league', 'league', l.id::text, jsonb_build_object('name', l.name) || counts);
end $$;

-- Functions: authenticated only (same block as 0002).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

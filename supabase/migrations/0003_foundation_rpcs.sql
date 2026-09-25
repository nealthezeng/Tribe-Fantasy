-- Helpers (private schema is not exposed through the Data API).
create function private.audit(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

create function private.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NOT_SIGNED_IN'; end if;
  return uid;
end $$;

create function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not exists (select 1 from public.user_roles where user_id = uid and role = 'admin') then
    raise exception 'FORBIDDEN';
  end if;
  return uid;
end $$;

create function private.clean_name(p_name text, p_max int) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p_name, ''));
begin
  if length(v) < 1 or length(v) > p_max then raise exception 'INVALID_NAME'; end if;
  return v;
end $$;

revoke all on all functions in schema private from public, anon, authenticated;

create function public.set_display_name(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); v text := private.clean_name(p_name, 60);
begin
  insert into public.profiles (id, display_name) values (uid, v)
  on conflict (id) do update set display_name = excluded.display_name;
  perform private.audit('set_display_name', 'profile', uid::text, jsonb_build_object('display_name', v));
end $$;

create function public.create_season(p_name text, p_settings jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid; v text;
begin
  perform private.require_admin();
  v := private.clean_name(p_name, 60);
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'INVALID_SETTINGS'; end if;
  insert into public.seasons (name, settings) values (v, p_settings) returning id into sid;
  perform private.audit('create_season', 'season', sid::text, jsonb_build_object('name', v, 'settings', p_settings));
  return sid;
end $$;

create function public.update_season_settings(p_season uuid, p_settings jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare old jsonb;
begin
  perform private.require_admin();
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'INVALID_SETTINGS'; end if;
  select settings into old from public.seasons where id = p_season for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.seasons set settings = p_settings where id = p_season;
  perform private.audit('update_season_settings', 'season', p_season::text, jsonb_build_object('old', old, 'new', p_settings));
end $$;

create function public.create_league(p_season uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare lid uuid; v text;
begin
  perform private.require_admin();
  v := private.clean_name(p_name, 60);
  if not exists (select 1 from public.seasons where id = p_season) then raise exception 'NOT_FOUND'; end if;
  begin
    insert into public.leagues (season_id, name) values (p_season, v) returning id into lid;
  exception when unique_violation then raise exception 'LEAGUE_EXISTS';
  end;
  perform private.audit('create_league', 'league', lid::text, jsonb_build_object('season_id', p_season, 'name', v));
  return lid;
end $$;

create function public.create_invite(p_league uuid, p_code text, p_max_uses int, p_expires_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(); c text := upper(btrim(coalesce(p_code, '')));
begin
  if c !~ '^[A-Z0-9]{6,20}$' then raise exception 'INVALID_CODE'; end if;
  if coalesce(p_max_uses, 50) < 1 then raise exception 'INVALID_INVITE_SETTINGS'; end if;
  if not exists (select 1 from public.leagues where id = p_league) then raise exception 'NOT_FOUND'; end if;
  begin
    insert into public.invites (code, league_id, max_uses, expires_at, created_by)
    values (c, p_league, coalesce(p_max_uses, 50), p_expires_at, uid);
  exception when unique_violation then raise exception 'CODE_TAKEN';
  end;
  perform private.audit('create_invite', 'invite', c, jsonb_build_object('league_id', p_league, 'max_uses', p_max_uses, 'expires_at', p_expires_at));
  return c;
end $$;

create function public.add_athlete(p_season uuid, p_name text, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare aid uuid; v text;
begin
  perform private.require_admin();
  v := private.clean_name(p_name, 60);
  if not exists (select 1 from public.seasons where id = p_season) then raise exception 'NOT_FOUND'; end if;
  if p_user is not null and not exists (select 1 from auth.users where id = p_user) then raise exception 'NOT_FOUND'; end if;
  begin
    insert into public.athletes (season_id, name, user_id) values (p_season, v, p_user) returning id into aid;
  exception when unique_violation then raise exception 'ATHLETE_EXISTS';
  end;
  perform private.audit('add_athlete', 'athlete', aid::text, jsonb_build_object('season_id', p_season, 'name', v, 'user_id', p_user));
  return aid;
end $$;

create function public.set_athlete_opt_in(p_athlete uuid, p_opted_in boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.athletes set opted_in = p_opted_in where id = p_athlete;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform private.audit('set_athlete_opt_in', 'athlete', p_athlete::text, jsonb_build_object('opted_in', p_opted_in));
end $$;

create function public.join_league(p_code text, p_team_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  inv public.invites;
  mid uuid;
  t text := btrim(coalesce(p_team_name, ''));
begin
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'NO_PROFILE'; end if;
  if length(t) < 1 or length(t) > 40 then raise exception 'INVALID_TEAM_NAME'; end if;
  select * into inv from public.invites where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or (inv.expires_at is not null and inv.expires_at <= now()) or inv.uses >= inv.max_uses then
    raise exception 'INVALID_INVITE';
  end if;
  begin
    insert into public.memberships (league_id, user_id, team_name) values (inv.league_id, uid, t) returning id into mid;
  exception when unique_violation then
    if exists (select 1 from public.memberships where league_id = inv.league_id and user_id = uid) then
      raise exception 'ALREADY_MEMBER';
    end if;
    raise exception 'TEAM_NAME_TAKEN';
  end;
  update public.invites set uses = uses + 1 where code = inv.code;
  perform private.audit('join_league', 'membership', mid::text, jsonb_build_object('league_id', inv.league_id, 'team_name', t, 'code', inv.code));
  return mid;
end $$;

create function public.grant_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_role is null or p_role not in ('admin', 'stat_keeper', 'treasurer') then raise exception 'INVALID_ROLE'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'NOT_FOUND'; end if;
  insert into public.user_roles (user_id, role) values (p_user, p_role) on conflict do nothing;
  perform private.audit('grant_role', 'user', p_user::text, jsonb_build_object('role', p_role));
end $$;

create function public.revoke_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  -- Lock the admin rows so two admins revoking each other can't both see a survivor.
  if p_role = 'admin' then
    perform 1 from public.user_roles where role = 'admin' for update;
  end if;
  if p_role = 'admin' and (select count(*) from public.user_roles where role = 'admin' and user_id <> p_user) = 0 then
    raise exception 'LAST_ADMIN';
  end if;
  delete from public.user_roles where user_id = p_user and role = p_role;
  perform private.audit('revoke_role', 'user', p_user::text, jsonb_build_object('role', p_role));
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

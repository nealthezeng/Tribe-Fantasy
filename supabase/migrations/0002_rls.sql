alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.seasons enable row level security;
alter table public.leagues enable row level security;
alter table public.invites enable row level security;
alter table public.memberships enable row level security;
alter table public.athletes enable row level security;
alter table public.audit_log enable row level security;

-- Clients only ever read; every write goes through an RPC.
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

-- Supabase's default privileges for objects the `postgres` role creates grant
-- anon/authenticated ALL on new tables/views, EXECUTE on new functions, and
-- USAGE/SELECT/UPDATE on new sequences (mirrored by the shim). Without
-- overriding those defaults here, every table/sequence/function a later
-- migration creates would be client-writable (or anon-executable) again by
-- default. From this point on, later migrations must grant access back
-- explicitly (the function-grant loop below is the pattern for functions).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges revoke execute on functions from public;
revoke all on all sequences in schema public from anon, authenticated;

create function public.has_role(p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = p_role)
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('admin')
$$;

create policy profiles_read on public.profiles for select to authenticated using (true);
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy seasons_read on public.seasons for select to authenticated using (true);
create policy leagues_read on public.leagues for select to authenticated using (true);
create policy invites_read on public.invites for select to authenticated using (public.is_admin());
create policy memberships_read on public.memberships for select to authenticated using (true);
create policy athletes_read on public.athletes for select to authenticated using (true);
create policy audit_log_read on public.audit_log for select to authenticated using (public.is_admin());

-- Functions: authenticated only. Re-run this block at the end of every migration that adds functions.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

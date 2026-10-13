-- Additive. Donation leaderboard on the Credits page: every donor this season by profile name and dollar total,
-- summed across their teams. A donor can tick "anonymous" to show as Anonymous (amount still listed).
alter table public.profiles add column donate_anonymously boolean not null default false;

create function public.set_donate_anonymously(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if p_on is null then raise exception 'INVALID_INPUT'; end if;
  update public.profiles set donate_anonymously = p_on where id = uid;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform private.audit('set_donate_anonymously', 'profile', uid::text, jsonb_build_object('on', p_on));
end $$;

-- name is null for an anonymous donor; is_me lets you find yourself either way.
create function public.donation_leaderboard(p_season uuid)
returns table (name text, dollars numeric, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  return query
    select case when p.donate_anonymously then null else p.display_name end, sum(c.dollars), m.user_id = uid
    from public.credit_ledger c
    join public.memberships m on m.id = c.membership_id
    join public.leagues l on l.id = m.league_id
    join public.profiles p on p.id = m.user_id
    where c.kind = 'donation' and l.season_id = p_season
    group by m.user_id, p.donate_anonymously, p.display_name
    order by sum(c.dollars) desc, min(c.id);
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

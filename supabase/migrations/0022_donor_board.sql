-- Additive. Donation leaderboard on the Credits page: every donor this season by profile name and dollar total,
-- summed across their teams. A donor can tick "anonymous" to show as Anonymous (amount still listed).
-- Totals only ever grow: donation rows are never deleted or reversed (a treasurer fix is a credits-only adjustment),
-- so a mistyped donation stays on the board at its typed amount.

-- Private, not a profiles column: profiles are readable by every league member, and who ticked the box would
-- name the anonymous donors. Only the owner reads it, through my_donate_anonymously().
create table private.donor_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  anonymous boolean not null
);

create function public.set_donate_anonymously(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if p_on is null then raise exception 'INVALID_INPUT'; end if;
  insert into private.donor_prefs (user_id, anonymous) values (uid, p_on)
  on conflict (user_id) do update set anonymous = excluded.anonymous;
  perform private.audit('set_donate_anonymously', 'profile', uid::text, jsonb_build_object('on', p_on));
end $$;

create function public.my_donate_anonymously() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  return coalesce((select anonymous from private.donor_prefs where user_id = uid), false);
end $$;

-- name is null for an anonymous donor; is_me lets you find yourself either way. Members and staff only, like names
-- everywhere else (profiles_read). Ties order by name, not by who gave first.
create function public.donation_leaderboard(p_season uuid)
returns table (name text, dollars numeric, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not public.can_read_league_data() then raise exception 'FORBIDDEN'; end if;
  return query
    select case when coalesce(d.anonymous, false) then null else p.display_name end, sum(c.dollars), m.user_id = uid
    from public.credit_ledger c
    join public.memberships m on m.id = c.membership_id
    join public.leagues l on l.id = m.league_id
    join public.profiles p on p.id = m.user_id
    left join private.donor_prefs d on d.user_id = m.user_id
    where c.kind = 'donation' and l.season_id = p_season
    group by m.user_id, d.anonymous, p.display_name
    order by 2 desc, 1 nulls last, 3 desc;
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

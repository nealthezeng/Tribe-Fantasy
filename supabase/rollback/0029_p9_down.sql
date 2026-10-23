-- Rollback for 0029_p9.sql. Run only AFTER reverting the code and pushing: the new bundle reads the members column
-- and calls close_share_buying, while the old one ignores the extra column, so 0029 can stay until then.
-- Drops close_share_buying and re-creates list_leagues verbatim from 0024 (no members column) with its grants.
-- No data is lost.
begin;

drop function public.close_share_buying(uuid);
drop function public.list_leagues();

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

revoke execute on function public.list_leagues() from public, anon;
grant execute on function public.list_leagues() to authenticated;

commit;

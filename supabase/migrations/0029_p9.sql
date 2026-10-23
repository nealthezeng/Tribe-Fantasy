-- Additive. M15 P9 (plan rulings 19 and "Join a league shows members' first names"):
-- * list_leagues gains a members column: the first word of each live team's display name, oldest team first. Removed
--   teams and accounts without a profile are skipped. Privacy: any signed-in user now sees the first names of every
--   league's members in the current season. The user chose this so people can see who they would join.
-- * close_share_buying (admin) closes a tournament's share buying now instead of at its close time, so the shares can
--   be settled at once. No reopening: open_auction refuses a closed stage.
-- The return type of list_leagues changes, so it is dropped and re-created (and its grants re-applied). The old bundle
-- ignores the extra column, so the paste can come any time before the push.
-- Rollback: supabase/rollback/0029_p9_down.sql.
begin;

drop function public.list_leagues();

-- As 0024 plus members.
create function public.list_leagues()
returns table (id uuid, name text, teams int, max_teams int, has_password boolean, is_member boolean, is_creator boolean,
  members text[])
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user(); sid uuid := private.current_season();
begin
  return query
    select l.id, l.name,
      (select count(*)::int from public.memberships m where m.league_id = l.id and m.removed_at is null),
      private.setting_num(sid, 'max_members', 12)::int,
      exists (select 1 from private.league_passwords p where p.league_id = l.id),
      exists (select 1 from public.memberships m where m.league_id = l.id and m.user_id = uid),
      l.created_by is not distinct from uid,
      array(select split_part(btrim(p.display_name), ' ', 1)
            from public.memberships m join public.profiles p on p.id = m.user_id
            where m.league_id = l.id and m.removed_at is null order by m.created_at, m.id)
    from public.leagues l where l.season_id = sid order by l.name;
end $$;

-- Ends a stage's open share buying now. The stage row lock serialises it with open_auction, place_bid and run_auction.
create function public.close_share_buying(p_stage uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare st public.stages;
begin
  perform private.require_admin();
  select * into st from public.stages where id = p_stage for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if st.auction_run_at is not null then raise exception 'AUCTION_ALREADY_RUN'; end if;
  if st.bid_close_at is null then raise exception 'AUCTION_NOT_OPEN'; end if;
  if st.bid_close_at <= now() then raise exception 'BID_CLOSED'; end if;
  update public.stages set bid_close_at = now() where id = p_stage;
  perform private.audit('close_share_buying', 'stage', p_stage::text,
    jsonb_build_object('old_close_at', st.bid_close_at, 'close_at', now()));
end $$;

do $$
declare f record;
begin
  for f in select unnest(array['public.list_leagues()', 'public.close_share_buying(uuid)']::regprocedure[]) as sig loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

commit;

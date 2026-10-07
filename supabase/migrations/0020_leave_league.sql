-- Leave a league (t217): a manager removes their own team, unless it has donated, bid, or been paired in a game.
-- Additive (one new function), so it's safe to paste before the new build deploys.

create function public.leave_league(p_membership uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  m public.memberships;
  l public.leagues;
  gone boolean := false;
begin
  -- ponytail: as delete_league, blocks ledger inserts while this runs so a donation can't slip in after the check.
  lock table public.credit_ledger in share mode;
  select * into m from public.memberships where id = p_membership and user_id = uid;
  -- Someone else's team and an unknown id read the same, so ids can't be probed.
  if not found then raise exception 'NOT_MEMBER'; end if;
  -- Same lock as joins and delete_league: no join or delete can interleave with the last-team check below.
  select * into l from public.leagues where id = m.league_id for update;
  -- An admin deleted the league (and this team with it) while we waited for the lock.
  if not found then raise exception 'NOT_MEMBER'; end if;
  if exists (select 1 from public.credit_ledger where membership_id = m.id and kind = 'donation') then
    raise exception 'TEAM_HAS_DONATIONS';
  end if;
  if exists (select 1 from public.bids where membership_id = m.id)
     or exists (select 1 from public.roster_slots where membership_id = m.id and via = 'bid') then
    raise exception 'TEAM_HAS_BIDS';
  end if;
  -- Deleting a team cascades to its pairing rows, which hold the opponent's side of the game too.
  if exists (select 1 from public.game_pairings where home = m.id or away = m.id) then
    raise exception 'TEAM_HAS_GAMES';
  end if;
  delete from public.memberships where id = m.id;
  if not exists (select 1 from public.memberships where league_id = l.id) then
    delete from public.leagues where id = l.id;
    gone := true;
  elsif l.created_by = uid then
    -- The league stays for the others and becomes admin-managed; the creator's one-per-season slot frees up.
    update public.leagues set created_by = null where id = l.id;
  end if;
  perform private.audit('leave_league', 'membership', m.id::text,
    jsonb_build_object('league_id', l.id, 'team_name', m.team_name, 'league_deleted', gone));
end $$;

revoke execute on function public.leave_league(uuid) from public, anon;
grant execute on function public.leave_league(uuid) to authenticated;

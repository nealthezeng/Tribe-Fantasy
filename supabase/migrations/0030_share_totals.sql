-- Additive. Live share totals on the buy list: share_totals returns, for each player with buys in one league's
-- tournament, max(min_shares, credits put on him). Who bought and how much stay sealed (bids_read is unchanged); the
-- min_shares floor hides small buys. Privacy: with one other buyer, his amount is the total less your own. The user
-- chose this ("a sense of what other people are buying, not the whole picture").
-- Rollback: drop function public.share_totals(uuid, uuid). The old bundle never calls it.
begin;

create function public.share_totals(p_stage uuid, p_league uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare floor_ numeric;
begin
  perform private.require_user();
  if not (public.is_admin() or exists (select 1 from public.memberships
      where league_id = p_league and user_id = auth.uid() and removed_at is null)) then
    raise exception 'FORBIDDEN';
  end if;
  select private.setting_num(s.season_id, 'min_shares', 200) into floor_ from public.stages s where s.id = p_stage;
  if not found then raise exception 'NOT_FOUND'; end if;
  return coalesce((select jsonb_object_agg(athlete_id, greatest(floor_, total)) from (
    select athlete_id, sum(amount) as total from public.bids
    where stage_id = p_stage and league_id = p_league group by athlete_id) t), '{}'::jsonb);
end $$;

revoke execute on function public.share_totals(uuid, uuid) from public, anon;
grant execute on function public.share_totals(uuid, uuid) to authenticated;

commit;

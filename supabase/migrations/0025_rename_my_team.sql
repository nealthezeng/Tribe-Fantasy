-- Owners rename their own team (t311). Additive (one new function), so it's safe to paste before the new build deploys.
-- Same name rules as join_league and admin_rename_team; the owner check is leave_league's. Admins get no bypass here
-- (they have admin_rename_team), and someone else's team, a removed team and an unknown id all read NOT_MEMBER.

create function public.rename_my_team(p_membership uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  m public.memberships;
  t text := btrim(coalesce(p_name, ''));
begin
  if length(t) < 1 or length(t) > 40 then raise exception 'INVALID_TEAM_NAME'; end if;
  select * into m from public.memberships where id = p_membership and user_id = uid and removed_at is null for update;
  if not found then raise exception 'NOT_MEMBER'; end if;
  begin
    update public.memberships set team_name = t where id = m.id;
  exception when unique_violation then raise exception 'TEAM_NAME_TAKEN';
  end;
  perform private.audit('rename_my_team', 'membership', m.id::text, jsonb_build_object('old', m.team_name, 'new', t));
end $$;

revoke execute on function public.rename_my_team(uuid, text) from public, anon;
grant execute on function public.rename_my_team(uuid, text) to authenticated;

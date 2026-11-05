-- Additive. Avatars: profiles.avatar holds a person's chosen parts, null meaning "use the generated figure". SQL doesn't
-- know the part lists, so adding a hat needs no migration: the browser treats every stored value as a lookup key and
-- falls back part by part, so a hand-crafted set_avatar call can still only draw a valid figure.
-- Rollback: drop function public.admin_reset_avatar(uuid); drop function public.set_avatar(jsonb);
-- alter table public.profiles drop column avatar; after the code is reverted (the new bundle selects the column).
begin;

alter table public.profiles add column avatar jsonb;

create function public.set_avatar(p_avatar jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if p_avatar is null or jsonb_typeof(p_avatar) <> 'object'
     or (select count(*) from jsonb_each(p_avatar)) > 12
     or exists (select 1 from jsonb_each(p_avatar) e
                where jsonb_typeof(e.value) <> 'string' or length(e.key) > 24 or length(e.value #>> '{}') > 24) then
    raise exception 'BAD_AVATAR';
  end if;
  update public.profiles set avatar = p_avatar where id = uid;
  if not found then raise exception 'NO_PROFILE'; end if;
  perform private.audit('set_avatar', 'profile', uid::text, '{}'::jsonb);
end $$;

create function public.admin_reset_avatar(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare old jsonb;
begin
  perform private.require_admin();
  select avatar into old from public.profiles where id = p_user for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.profiles set avatar = null where id = p_user;
  perform private.audit('admin_reset_avatar', 'profile', p_user::text, jsonb_build_object('user', p_user, 'old', old));
end $$;

revoke execute on function public.set_avatar(jsonb) from public, anon;
revoke execute on function public.admin_reset_avatar(uuid) from public, anon;
grant execute on function public.set_avatar(jsonb) to authenticated;
grant execute on function public.admin_reset_avatar(uuid) to authenticated;

commit;

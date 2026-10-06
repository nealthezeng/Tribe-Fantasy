-- Board t213 (user, 2026-10-06): admins rename a season, or delete one with everything in it. New functions only,
-- so it is safe to paste any time.
--
-- Every table under a season cascades from it (leagues → memberships → ledger, bids, rosters, picks, outbox;
-- stages → games; athletes → stats; sessions → taps), so one delete removes the lot. The audit log has no FK and
-- keeps a summary. A season with any donation receipt is refused (user ruling): those rows are the treasurer's
-- record of real money.

create function public.rename_season(p_season uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text; old text;
begin
  perform private.require_admin();
  v := private.clean_name(p_name, 60);
  select name into old from public.seasons where id = p_season for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.seasons set name = v where id = p_season;
  perform private.audit('rename_season', 'season', p_season::text, jsonb_build_object('old', old, 'new', v));
end $$;

create function public.delete_season(p_season uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.seasons; counts jsonb;
begin
  perform private.require_admin();
  select * into s from public.seasons where id = p_season for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.credit_ledger c join public.memberships m on m.id = c.membership_id
             join public.leagues l on l.id = m.league_id where l.season_id = p_season and c.kind = 'donation') then
    raise exception 'SEASON_HAS_DONATIONS';
  end if;
  counts := jsonb_build_object(
    'stages', (select count(*) from public.stages where season_id = p_season),
    'leagues', (select count(*) from public.leagues where season_id = p_season),
    'memberships', (select count(*) from public.memberships m join public.leagues l on l.id = m.league_id where l.season_id = p_season),
    'athletes', (select count(*) from public.athletes where season_id = p_season),
    'games', (select count(*) from public.games g join public.stages st on st.id = g.stage_id where st.season_id = p_season),
    'sessions', (select count(*) from public.sessions where season_id = p_season),
    'ledger_rows', (select count(*) from public.credit_ledger c join public.memberships m on m.id = c.membership_id
                    join public.leagues l on l.id = m.league_id where l.season_id = p_season));
  delete from public.seasons where id = p_season;
  perform private.audit('delete_season', 'season', p_season::text, jsonb_build_object('name', s.name) || counts);
end $$;

revoke execute on function public.rename_season(uuid, text) from public, anon;
revoke execute on function public.delete_season(uuid) from public, anon;
grant execute on function public.rename_season(uuid, text) to authenticated;
grant execute on function public.delete_season(uuid) to authenticated;

-- Additive. Live scores (M15 P6, spec 5.3): the taps of a started game that no keeper has verified yet, for anyone who
-- can read league data. Managers cannot read stat_taps (keeper/admin RLS) and stat lines exist only after Verify, so
-- without this the League tab could not show unofficial scores while a game is on.
-- No keeper ids leave the database: each keeper is a number (1, 2, ...) by first tap in the game, and taps whose
-- keeper_id is null (removed accounts, M14) share one number, as rowToTap/verify_session treat them. A read: no audit row.
-- Rows only for a game that has started and whose session exists and is unverified (live or finished-but-unverified);
-- unknown, null, unstarted, void and verified games return nothing, not an error.
begin;

create function public.live_game_taps(p_game uuid)
returns table (id uuid, athlete_id uuid, stat text, tapped_at timestamptz, undoes uuid, keeper int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not public.can_read_league_data() then raise exception 'FORBIDDEN'; end if;
  return query
    with t as (
      select st.* from public.stat_taps st
      join public.games g on g.session_id = st.session_id
      join public.sessions s on s.id = g.session_id
      where g.id = p_game and g.started_at is not null and s.verified_at is null
    ), k as (
      select keeper_id, dense_rank() over (order by min(t.tapped_at), keeper_id)::int as n from t group by keeper_id
    )
    select t.id, t.athlete_id, t.stat, t.tapped_at, t.undoes, k.n
    from t join k on k.keeper_id is not distinct from t.keeper_id
    order by t.tapped_at, t.id;
end $$;

do $$
declare f record;
begin
  for f in select 'public.live_game_taps(uuid)'::regprocedure as sig loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

commit;

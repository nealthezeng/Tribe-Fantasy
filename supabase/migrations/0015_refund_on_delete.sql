-- Board t125 (user, 2026-10-05): deleting a tournament gives managers back what they spent in its auction. Reverses
-- the 0014 ruling "spending is not refunded". Replaces delete_stage only, so it is safe to paste any time.
--
-- The refund is the price of every priced roster slot still in the tournament, one 'adjustment' row per team.
-- Not the 'bid' ledger rows: a force-deleted athlete's slot was already refunded ("Refund: <name> removed", 0011)
-- and is gone, so summing slots can't pay it twice. Fill slots cost 0 and refund nothing; allowances stay.

create or replace function public.delete_stage(p_stage uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(); st public.stages; sids uuid[]; counts jsonb; refunded int;
begin
  select * into st from public.stages where id = p_stage for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.games where stage_id = p_stage order by number for update; -- a concurrent start_game can't slip a session in after sids
  select coalesce(array_agg(session_id), '{}') into sids from public.games where stage_id = p_stage and session_id is not null;
  counts := jsonb_build_object(
    'games', (select count(*) from public.games where stage_id = p_stage),
    'sessions', cardinality(sids),
    'slots', (select count(*) from public.roster_slots where stage_id = p_stage),
    'bids', (select count(*) from public.bids where stage_id = p_stage),
    'ledger_rows_kept', (select count(*) from public.credit_ledger where stage_id = p_stage));
  -- stage_id null: the row outlives the tournament (the FK would null it on delete anyway).
  insert into public.credit_ledger (membership_id, stage_id, kind, amount, note, created_by)
  select membership_id, null, 'adjustment', sum(price)::int, 'Refund: ' || st.name || ' deleted', uid
  from public.roster_slots where stage_id = p_stage and price > 0
  group by membership_id;
  select coalesce(sum(price), 0)::int into refunded from public.roster_slots where stage_id = p_stage and price > 0;
  delete from public.stages where id = p_stage;
  delete from public.sessions where id = any (sids);
  perform private.audit('delete_stage', 'stage', p_stage::text,
    jsonb_build_object('season_id', st.season_id, 'name', st.name, 'refunded', refunded) || counts);
end $$;

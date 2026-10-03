-- Tournament mode T4: weekly play retired. Spec: docs/superpowers/specs/2026-10-02-tournament-mode-design.md §8
-- (amendments 9 and 15). The user OK'd dropping the weekly test data (2026-10-03).
-- Paste BEFORE deploying the T4 build: it rejects the retired settings keys this strips.

drop function public.create_stage_weeks(uuid);
drop function public.set_week_lock(uuid, timestamptz);
drop function public.set_pick(uuid, uuid, uuid);
drop table public.picks;
drop table public.weeks;

-- parseSettings rejects unknown keys, and the settings editor saved every key, so these are in stored settings.
update public.seasons set settings = settings - array['pick_lock_day', 'pick_lock_time', 'usage_reset'];

-- As 0011, with tournament picks and bench swaps in place of weekly picks. A swap's athlete in use blocks a plain
-- delete; forced, the swap cascades away (that manager's lineup falls back to before the swap).
create or replace function public.delete_athlete(p_athlete uuid, p_force boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(); a public.athletes; f boolean := coalesce(p_force, false);
  removed jsonb := '{}'; refunded int;
begin
  select * into a from public.athletes where id = p_athlete for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not f then
    if exists (select 1 from public.stat_taps where athlete_id = p_athlete)
      or exists (select 1 from public.stat_lines where athlete_id = p_athlete)
      or exists (select 1 from public.attendance where athlete_id = p_athlete)
      or exists (select 1 from public.injuries where athlete_id = p_athlete)
      or exists (select 1 from public.bids where athlete_id = p_athlete)
      or exists (select 1 from public.roster_slots where athlete_id = p_athlete)
      or exists (select 1 from public.game_picks where athlete_id = p_athlete)
      or exists (select 1 from public.bench_swaps where p_athlete in (out_athlete, in_athlete)) then
      raise exception 'ATHLETE_IN_USE';
    end if;
  else
    select coalesce(sum(price), 0)::int into refunded from public.roster_slots where athlete_id = p_athlete and price > 0;
    insert into public.credit_ledger (membership_id, stage_id, kind, amount, note, created_by)
    select membership_id, stage_id, 'adjustment', price, 'Refund: ' || a.name || ' removed', uid
    from public.roster_slots where athlete_id = p_athlete and price > 0;
    removed := jsonb_build_object(
      'taps', (select count(*) from public.stat_taps where athlete_id = p_athlete),
      'lines', (select count(*) from public.stat_lines where athlete_id = p_athlete),
      'attendance', (select count(*) from public.attendance where athlete_id = p_athlete),
      'injuries', (select count(*) from public.injuries where athlete_id = p_athlete),
      'bids', (select count(*) from public.bids where athlete_id = p_athlete),
      'slots', (select count(*) from public.roster_slots where athlete_id = p_athlete),
      'picks', (select count(*) from public.game_picks where athlete_id = p_athlete),
      'swaps', (select count(*) from public.bench_swaps where p_athlete in (out_athlete, in_athlete)),
      'refunded', refunded);
  end if;
  delete from public.athletes where id = p_athlete;
  perform private.audit('delete_athlete', 'athlete', p_athlete::text,
    jsonb_build_object('season_id', a.season_id, 'name', a.name, 'user_id', a.user_id, 'force', f) || removed);
end $$;

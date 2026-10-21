-- M15 P5 (spec §5.6) Out marking. Keepers mark a player Out for a tournament (stage): from the next game on, the
-- scorer swaps him out of every pick. public.outs holds the intervals: a row covers game n when
-- from_game <= n and (until_game is null or n < until_game), the same rule as roster slots. set_out starts a row at
-- the next unstarted game; clear_out deletes a row that never covered a game, else ends it at the next game (the games
-- it covered keep their swap). Both lock the stage's games in number order FOR SHARE, so they wait for a concurrent
-- start_game (which locks only its own game row FOR UPDATE) and never deadlock with the other number-ordered lockers.
-- This replaces the player-facing injury and attendance RPCs, which are dropped; the injuries and attendance tables
-- stay as read-only history. Every open injury is cleared (not converted to Out): games that already started keep
-- their injury swap, nothing after the paste is affected. Rollback: supabase/rollback/0027_out_down.sql.
begin;

create table public.outs (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  from_game int not null check (from_game >= 1),
  until_game int check (until_game > from_game),
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  cleared_by uuid references auth.users (id) on delete set null,
  cleared_at timestamptz
);
-- One open mark per player per tournament; ended marks pile up (out, back, out again).
create unique index outs_one_open on public.outs (stage_id, athlete_id) where until_game is null;
create index outs_athlete_idx on public.outs (athlete_id);
alter table public.outs enable row level security;
grant select on public.outs to authenticated;
create policy outs_read on public.outs for select to authenticated using (public.can_read_league_data());

-- Returns the mark's from_game: the next unstarted game. Already out = that row's from_game, nothing written.
create function public.set_out(p_stage uuid, p_athlete uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_keeper(); n int;
begin
  if not exists (select 1 from public.stages s join public.athletes a on a.season_id = s.season_id
                 where s.id = p_stage and a.id = p_athlete) then
    raise exception 'NOT_FOUND';
  end if;
  perform 1 from public.games where stage_id = p_stage order by number for share;
  insert into public.outs (stage_id, athlete_id, from_game, set_by)
  values (p_stage, p_athlete, private.next_game(p_stage), uid)
  on conflict (stage_id, athlete_id) where until_game is null do nothing
  returning from_game into n;
  if not found then
    -- Marked already (or a concurrent call just did): the same mark, no second audit row.
    select from_game into n from public.outs where stage_id = p_stage and athlete_id = p_athlete and until_game is null;
    return n;
  end if;
  perform private.audit('set_out', 'stage', p_stage::text, jsonb_build_object('athlete', p_athlete, 'from_game', n));
  return n;
end $$;

create function public.clear_out(p_stage uuid, p_athlete uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_keeper(); o public.outs; nxt int; ended int;
begin
  if not exists (select 1 from public.stages s join public.athletes a on a.season_id = s.season_id
                 where s.id = p_stage and a.id = p_athlete) then
    raise exception 'NOT_FOUND';
  end if;
  perform 1 from public.games where stage_id = p_stage order by number for share;
  select * into o from public.outs where stage_id = p_stage and athlete_id = p_athlete and until_game is null for update;
  if not found then return; end if;
  nxt := private.next_game(p_stage);
  if o.from_game >= nxt then
    delete from public.outs where id = o.id; -- it never covered a game
  else
    update public.outs set until_game = nxt, cleared_by = uid, cleared_at = now() where id = o.id;
    ended := nxt;
  end if;
  perform private.audit('clear_out', 'stage', p_stage::text,
    jsonb_build_object('athlete', p_athlete, 'from_game', o.from_game, 'until_game', ended));
end $$;

drop function public.report_injury(uuid);
drop function public.confirm_injury(uuid);
drop function public.clear_injury(uuid);
drop function public.set_attendance(uuid, uuid, text);

-- Games that already started keep their injury swap (the scorer checks the interval); later ones aren't affected.
update public.injuries set cleared_at = now() where cleared_at is null;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('set_out', 'clear_out') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

commit;

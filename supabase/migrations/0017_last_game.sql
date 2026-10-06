-- t202 "That was the last game": Finish can end a tournament without pairing game N+1, so no pick email goes out for
-- a game that won't be played. The tournament is over when every one of its games is finished (the app works that
-- out; no new column). add_next_game undoes a wrong last-game tap by pairing game N+1 after all.

-- p_last defaults to false and PostgREST calls by argument name, so the old site's 3-argument calls keep working.
-- Dropped first: an added argument would otherwise make a second, ambiguous overload.
drop function public.finish_game(uuid, jsonb, jsonb);
create function public.finish_game(p_game uuid, p_pairings jsonb, p_provisional jsonb, p_last boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare g public.games; gid uuid;
begin
  perform private.require_keeper();
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.started_at is null or g.finished_at is not null then raise exception 'GAME_NOT_LIVE'; end if;
  if not coalesce(p_last, false) then perform private.check_pairings(g.stage_id, p_pairings); end if;
  update public.games set finished_at = now() where id = p_game;
  if not coalesce(p_last, false) then
    insert into public.games (stage_id, number) values (g.stage_id, g.number + 1) returning id into gid;
    perform private.insert_pairings(gid, p_pairings);
  end if;
  perform private.audit('finish_game', 'game', p_game::text, jsonb_build_object('next_game_id', gid,
    'last', coalesce(p_last, false), 'pairings', case when p_last then null else p_pairings end, 'provisional', p_provisional));
  return gid;
end $$;

-- After a last-game finish: pair game N+1 after all (keepers, like Finish). The pairing trigger sends its pick emails.
create function public.add_next_game(p_game uuid, p_pairings jsonb, p_provisional jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare g public.games; gid uuid;
begin
  perform private.require_keeper();
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.finished_at is null then raise exception 'GAME_NOT_FINISHED'; end if;
  if exists (select 1 from public.games where stage_id = g.stage_id and number > g.number) then
    raise exception 'NEXT_GAME_EXISTS';
  end if;
  perform private.check_pairings(g.stage_id, p_pairings);
  insert into public.games (stage_id, number) values (g.stage_id, g.number + 1) returning id into gid;
  perform private.insert_pairings(gid, p_pairings);
  perform private.audit('add_next_game', 'game', p_game::text, jsonb_build_object('number', g.number + 1,
    'next_game_id', gid, 'pairings', p_pairings, 'provisional', p_provisional));
  return gid;
end $$;

-- The pick email loses "If that was the tournament's last game, ignore this email." (0016): a last game pairs
-- nothing now, so no notice goes out for it.
create or replace function private.queue_pick_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  if new.away is null then return null; end if;
  select gm.id, gm.number, gm.stage_id, st.name as stage into g
  from public.games gm join public.stages st on st.id = gm.stage_id where gm.id = new.game_id;
  insert into private.outbox (membership_id, kind, ref, subject, body)
  select me.id, 'pick_next', g.id::text,
    format('Pick your player for game %s', g.number),
    format('%s: game %s of %s is next. You play %s. Pick your player on the League page, or we''ll start your '
      || 'most rested healthy player for you.', me.team_name, g.number, g.stage, opp.team_name)
      || private.email_footer()
  from (values (new.home, new.away), (new.away, new.home)) v (me_id, opp_id)
  join public.memberships me on me.id = v.me_id
  join public.memberships opp on opp.id = v.opp_id
  where private.wants_email(me.id)
    and not exists (select 1 from public.game_picks p
                    where p.stage_id = g.stage_id and p.game_number = g.number and p.membership_id = me.id)
  on conflict (membership_id, kind, ref) do nothing;
  return null;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('finish_game', 'add_next_game') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

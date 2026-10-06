-- M10 email notifications. Spec: docs/superpowers/specs/2026-10-05-m10-notifications-design.md
-- Additive. SQL decides who gets which email and queues it in private.outbox; the Edge Function `notify`
-- (supabase/functions/notify, run every minute by pg_cron) only sends what claim_outbox hands it.

alter table public.profiles add column notify_email boolean not null default true;

create table private.outbox (
  id bigint generated always as identity primary key,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  -- 'test' is the go-live smoke test (docs/setup-supabase.md).
  kind text not null check (kind in ('bid_24h', 'bid_2h', 'pick_next', 'test')),
  -- bid: private.bid_ref(stage, bid_close_at); pick_next: the game id. Unique with kind: queuing is idempotent.
  ref text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  tries int not null default 0,
  sent_at timestamptz,
  error text,
  unique (membership_id, kind, ref)
);

-- Moving the close time changes the ref, so the new time gets its own reminders.
create function private.bid_ref(p_stage uuid, p_close_at timestamptz) returns text
language sql immutable set search_path = '' as $$
  select p_stage::text || '@' || extract(epoch from p_close_at)::text
$$;

-- On unless the member's user turned it off; no profile row counts as on.
create function private.wants_email(p_membership uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.notify_email from public.memberships m join public.profiles p on p.id = m.user_id
                   where m.id = p_membership), true)
$$;

create function private.email_footer() returns text
language sql immutable set search_path = '' as $$
  select E'\n\nOpen Tribe Fantasy: https://nealthezeng.github.io/Tribe-Fantasy/'
      || E'\nTurn these emails off: https://nealthezeng.github.io/Tribe-Fantasy/#/me'
$$;

-- Called by the sender on every run. A stage whose bids close within 24 h queues bid_24h, within 2 h bid_2h, for
-- every member of every league in its season. A close already past (or an auction already run) queues nothing.
create function private.queue_bid_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into private.outbox (membership_id, kind, ref, subject, body)
  select m.id, k.kind, private.bid_ref(s.id, s.bid_close_at),
    format('Bidding for %s closes within %s', s.name, k.label),
    format('%s: bidding for %s closes %s ET. %s', m.team_name, s.name,
      to_char(s.bid_close_at at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM'),
      case b.n when 0 then 'You haven''t placed any bids yet.' when 1 then 'You have placed 1 bid.'
        else format('You have placed %s bids.', b.n) end)
      || private.email_footer()
  from public.stages s
  cross join lateral (
    select case when s.bid_close_at - now() <= interval '2 hours' then 'bid_2h' else 'bid_24h' end as kind,
           case when s.bid_close_at - now() <= interval '2 hours' then '2 hours' else '24 hours' end as label
  ) k
  join public.leagues l on l.season_id = s.season_id
  join public.memberships m on m.league_id = l.id
  cross join lateral (select count(*)::int as n from public.bids bd where bd.stage_id = s.id and bd.membership_id = m.id) b
  where s.bid_close_at > now() and s.bid_close_at <= now() + interval '24 hours' and s.auction_run_at is null
    and private.wants_email(m.id)
  on conflict (membership_id, kind, ref) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- open_tournament (game 1) and finish_game (game N+1) insert the next game's pairings: tell both sides of each
-- pairing who haven't picked yet. A bye doesn't play, so it gets nothing.
create function private.queue_pick_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  if new.away is null then return null; end if;
  select gm.id, gm.number, gm.stage_id, gm.opponent, st.name as stage into g
  from public.games gm join public.stages st on st.id = gm.stage_id where gm.id = new.game_id;
  insert into private.outbox (membership_id, kind, ref, subject, body)
  select me.id, 'pick_next', g.id::text,
    format('Pick your player for game %s', g.number) || coalesce(' vs ' || g.opponent, ''),
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

create trigger game_pairings_pick_notice after insert on public.game_pairings
  for each row execute function private.queue_pick_notice();

-- Up to p_limit due emails, locked so overlapping runs never share one. Due = unsent, under 3 tries, not claimed in
-- the last 5 minutes (a crashed run's rows come back), queued in the last 30 minutes (late is worse than never),
-- and still true: a bid reminder's close time unchanged and its auction open; a pick notice's game not started and
-- the manager still without a pick (they may have picked in the minute since it was queued).
create function private.claim_outbox(p_limit int)
returns table (id bigint, email text, subject text, body text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with c as (
    select o.id from private.outbox o
    where o.sent_at is null and o.tries < 3
      and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
      and o.created_at > now() - interval '30 minutes'
      and (o.kind not in ('bid_24h', 'bid_2h') or exists (
        select 1 from public.stages s
        where o.ref = private.bid_ref(s.id, s.bid_close_at) and s.bid_close_at > now() and s.auction_run_at is null))
      and (o.kind <> 'pick_next' or exists (
        select 1 from public.games g where g.id::text = o.ref and g.started_at is null
          and not exists (select 1 from public.game_picks p
                          where p.stage_id = g.stage_id and p.game_number = g.number and p.membership_id = o.membership_id)))
    order by o.id
    limit p_limit
    for update of o skip locked
  ), u as (
    update private.outbox o set claimed_at = now(), tries = o.tries + 1
    from c where o.id = c.id
    returning o.id, o.membership_id, o.subject, o.body
  )
  select u.id, au.email::text, u.subject, u.body
  from u
  join public.memberships m on m.id = u.membership_id
  join auth.users au on au.id = m.user_id
  where au.email is not null
  order by u.id;
end $$;

-- Null error = sent. Otherwise the error is kept and the row is retried once its 5-minute claim runs out.
create function private.mark_outbox(p_id bigint, p_error text) returns void
language sql security definer set search_path = '' as $$
  update private.outbox
  set sent_at = case when p_error is null then now() end, error = left(p_error, 500)
  where id = p_id
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- Me page switch. Every signed-in user has a profile (the name screen comes first), so no upsert.
create function public.set_notify_email(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if p_on is null then raise exception 'INVALID_INPUT'; end if;
  update public.profiles set notify_email = p_on where id = uid;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform private.audit('set_notify_email', 'profile', uid::text, jsonb_build_object('on', p_on));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

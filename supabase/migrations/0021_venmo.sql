-- Venmo donations. Spec: docs/superpowers/specs/2026-10-10-venmo-donations-design.md
-- Additive. Teams get a donation code; Venmo receipts forwarded to a dedicated Gmail are read by the Edge Function
-- `venmo-intake` (supabase/functions/venmo-intake, run every 10 minutes by pg_cron), which hands each one to
-- private.ingest_venmo_receipt. Every decision lives here; the function only fetches mail.

-- 4 consonants: no vowels (no real words), no Y, no L (looks like I). 19^4 ≈ 130k codes.
create function private.new_donation_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare alphabet constant text := 'BCDFGHJKMNPQRSTVWXZ'; c text;
begin
  -- ponytail: two teams created in the same instant could draw the same code; the unique index refuses the second
  -- insert (one retry by the user). Fine at a few dozen teams.
  loop
    c := '';
    for i in 1..4 loop c := c || substr(alphabet, 1 + floor(random() * 19)::int, 1); end loop;
    exit when not exists (select 1 from public.memberships where donation_code = c);
  end loop;
  return c;
end $$;

alter table public.memberships add column donation_code text;
-- One statement per row so each sees the codes already handed out.
do $$
declare r record;
begin
  for r in select id from public.memberships loop
    update public.memberships set donation_code = private.new_donation_code() where id = r.id;
  end loop;
end $$;
alter table public.memberships
  alter column donation_code set default private.new_donation_code(),
  alter column donation_code set not null,
  add constraint memberships_donation_code_key unique (donation_code),
  add constraint memberships_donation_code_check check (donation_code ~ '^[BCDFGHJKMNPQRSTVWXZ]{4}$');

-- Where a donation came from ('venmo:<payment id>'); unique, so one Venmo payment can't credit twice. Null = manual.
alter table public.credit_ledger add column source_ref text unique;

-- The body of record_donation (0006), shared with the Venmo ingest. Callers check who may call it.
create function private.insert_donation(p_membership uuid, p_dollars numeric, p_note text, p_created_by uuid,
  p_source_ref text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare sid uuid; n text; credits int; eid bigint;
begin
  select l.season_id into sid from public.memberships m join public.leagues l on l.id = m.league_id where m.id = p_membership;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not coalesce((select (settings ->> 'donations_enabled')::boolean from public.seasons where id = sid), false) then
    raise exception 'DONATIONS_DISABLED';
  end if;
  if p_dollars is null or p_dollars <= 0 or p_dollars > 10000 or p_dollars <> round(p_dollars, 2) then
    raise exception 'INVALID_AMOUNT';
  end if;
  n := nullif(btrim(coalesce(p_note, '')), '');
  if length(n) > 200 then raise exception 'INVALID_NOTE'; end if;
  credits := round(p_dollars * private.setting_num(sid, 'credits_per_dollar', 20));
  if credits < 1 then raise exception 'INVALID_AMOUNT'; end if;
  insert into public.credit_ledger (membership_id, kind, amount, dollars, note, created_by, source_ref)
  values (p_membership, 'donation', credits, p_dollars, n, p_created_by, p_source_ref) returning id into eid;
  perform private.audit('record_donation', 'membership', p_membership::text,
    jsonb_build_object('ledger_id', eid, 'dollars', p_dollars, 'credits', credits)
    || case when p_source_ref is null then '{}'::jsonb else jsonb_build_object('source_ref', p_source_ref) end);
  return eid;
end $$;

-- The treasurer has already received the money through the official team channel; this only records it.
create or replace function public.record_donation(p_membership uuid, p_dollars numeric, p_note text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_treasurer();
begin
  return private.insert_donation(p_membership, p_dollars, p_note, uid, null);
end $$;

revoke all on all functions in schema private from public, anon, authenticated;

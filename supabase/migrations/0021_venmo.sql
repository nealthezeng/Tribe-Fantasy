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

-- One row per receipt email seen. Not API-exposed. no_code (personal payments) and unsigned (possible forgeries)
-- keep no payer, amount or note.
create table private.venmo_receipts (
  id bigint generated always as identity primary key,
  message_id text not null unique,
  received_at timestamptz,
  status text not null check (status in
    ('credited', 'no_code', 'unknown_code', 'ambiguous', 'unsigned', 'unparsed', 'disabled', 'duplicate')),
  payer text,
  dollars numeric(10, 2),
  note text,
  code text,
  membership_id uuid references public.memberships (id) on delete set null,
  ledger_id bigint references public.credit_ledger (id) on delete set null,
  created_at timestamptz not null default now()
);

-- The note in a "paid you" email as text. Real receipts have an empty text/plain part, so the text is mailparser's
-- conversion of the HTML: "<payer> paid you", the amount split over lines ("$", whole, ".", cents), the typed note,
-- then "See transaction [url]" and boilerplate. The note is the first non-blank line after the amount, so nothing
-- else in the email (names, URLs, tracking ids) ever reaches the code match. No note → null (not "See transaction").
create function private.venmo_note(p_text text) returns text
language sql immutable set search_path = '' as $$
  select case when n ~* '^See transaction' then null else n end
  from (select nullif(btrim((regexp_match(coalesce(p_text, ''),
    'paid you[ \t]*\r?\n[[:space:]]*\$[[:space:]]*[0-9,]+[[:space:]]*\.[[:space:]]*[0-9]{2}[[:space:]]*\r?\n[[:space:]]*([^\r\n]+)'))[1]), '') as n) s
$$;

-- Called by the Edge Function with one email; returns what happened. Re-delivering a message returns its first answer.
-- Trust comes only from the TOP Authentication-Results header: Gmail adds it on receipt, so a sender can't forge it
-- (headers a sender writes sit below it).
create function private.ingest_venmo_receipt(p_message_id text, p_auth_results text[], p_subject text, p_text text,
  p_received_at timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
declare
  top text := lower(coalesce(p_auth_results[1], ''));
  st text; m text[]; payer text; dollars numeric; note text; pid text; codes text[]; teams uuid[]; mid uuid; eid bigint;
begin
  if nullif(btrim(coalesce(p_message_id, '')), '') is null then raise exception 'INVALID_INPUT'; end if;
  select status into st from private.venmo_receipts where message_id = p_message_id;
  if found then return st; end if;

  if top !~ '^mx\.google\.com;'
     or top !~ 'dkim=pass[^;]*header\.(i=@|d=)([a-z0-9-]+\.)*venmo\.com([[:space:];]|$)' then
    st := 'unsigned';
  else
    m := regexp_match(coalesce(p_subject, ''), '^(.+) paid \$([0-9,]+\.[0-9]{2}) to your Venmo account');
    if m is null then
      st := 'unparsed';
    else
      payer := left(btrim(m[1]), 100);
      dollars := replace(m[2], ',', '')::numeric;
      note := left(private.venmo_note(p_text), 200);
      pid := upper((regexp_match(coalesce(p_text, ''), '(?:Payment|Transaction)[[:space:]]+ID:?[[:space:]]*((?=[A-Z0-9]*[0-9])[A-Z0-9]{6,30})', 'i'))[1]);
      select array_agg(distinct w[1]) into codes
      from regexp_matches(upper(coalesce(note, '')), '\m([BCDFGHJKMNPQRSTVWXZ]{4})\M', 'g') w;
      select array_agg(id) into teams from public.memberships where donation_code = any(codes);
      if codes is null then st := 'no_code';
      elsif teams is null then st := 'unknown_code';
      elsif cardinality(teams) > 1 then st := 'ambiguous';
      else
        mid := teams[1];
        begin
          eid := private.insert_donation(mid, dollars, left('Venmo ' || payer || coalesce(': ' || note, ''), 200), null,
            coalesce('venmo:' || pid, 'msg:' || p_message_id));
          st := 'credited';
        exception
          when unique_violation then st := 'duplicate';
          when raise_exception then st := case when sqlerrm = 'DONATIONS_DISABLED' then 'disabled' else 'unparsed' end;
        end;
      end if;
    end if;
  end if;

  insert into private.venmo_receipts (message_id, received_at, status, payer, dollars, note, code, membership_id, ledger_id)
  select p_message_id, p_received_at, st, payer, dollars, note, array_to_string(codes, ' '), mid, eid
  where st not in ('no_code', 'unsigned')
  union all
  select p_message_id, p_received_at, st, null, null, null, null, null, null
  where st in ('no_code', 'unsigned');
  return st;
end $$;
revoke all on all functions in schema private from public, anon, authenticated;

-- Admin → Wallets: receipts that didn't become credits (last 30 days), and how many personal payments were skipped.
create function public.list_venmo_receipts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_treasurer();
  return jsonb_build_object(
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'received_at', coalesce(r.received_at, r.created_at),
        'status', r.status, 'payer', r.payer, 'dollars', r.dollars, 'note', r.note, 'code', r.code, 'team', m.team_name)
        order by coalesce(r.received_at, r.created_at) desc, r.id desc)
      from private.venmo_receipts r left join public.memberships m on m.id = r.membership_id
      where r.created_at > now() - interval '30 days' and r.status not in ('credited', 'no_code')), '[]'::jsonb),
    'skipped', (select count(*) from private.venmo_receipts
                where created_at > now() - interval '30 days' and status = 'no_code'));
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

# Venmo Donations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Invoke `ponytail:ponytail` before writing code.

**Goal:** Venmo "paid you" receipts forwarded to a dedicated Gmail turn into team credits automatically, matched by a 4-consonant team code in the Venmo note.

**Architecture:** Every decision lives in SQL (`0021_venmo.sql`): team codes on `memberships`, idempotent `credit_ledger.source_ref`, and `private.ingest_venmo_receipt`, which checks Gmail's DKIM verdict, parses, matches a code and credits. The Edge Function `venmo-intake` is a dumb pipe (IMAP → SQL), run by pg_cron every 10 minutes, the same way `notify` is. The app shows each team its code + a prefilled Venmo link, and shows the treasurer receipts that weren't credited.

**Tech Stack:** Postgres (Supabase; PGlite in tests), Deno Edge Function (`npm:imapflow`, `npm:mailparser`, `npm:postgres`), React + Vite + TypeScript, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-10-venmo-donations-design.md`

## Global Constraints

- Branch `venmo-donations` in the main checkout `C:\Users\19195\Documents\Tribe-Fantasy`. Bash: `export PATH="/c/Program Files/nodejs:$PATH"` first (node isn't on PATH).
- One migration, `supabase/migrations/0021_venmo.sql`; Tasks 1–2 both write to it. Additive. The user pastes it into Supabase BEFORE the app is pushed.
- Code alphabet `BCDFGHJKMNPQRSTVWXZ`, exactly 4 letters, matched case-insensitively as a whole word.
- `no_code` and `unsigned` receipts never store payer, dollars or note.
- Donor copy must say it's a **donation to the team fund** and that **credits have no cash value**.
- All colours/fonts/sizes come from `src/app/tokens.css`; reuse existing classes (`card`, `section`, `muted`, `list`, `meta`, `secondary`). No new CSS unless a test or the visual check needs it.
- Run `npm test` (all files together, as CI does) before every commit that touches tests. DB tests near date boundaries must not use `current_date` (CI is UTC).
- Commit messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A forged or look-alike receipt (`dkim=fail`, signature for `venmo.com.evil.com` / `notvenmo.com`, a fake "pass" header below Gmail's) must never credit. → Task 2 test "only Gmail's top verdict for venmo.com counts".
2. The same Venmo payment arriving twice (re-forwarded, different Message-ID) must credit once. → Task 2 test "credits a payment once".
3. Codes next to emoji/punctuation or in lower case must match; a code inside a longer word (`BKRTS`) must not. → Task 2 test "matches codes case-insensitively as whole words".
4. A run that fails halfway must not lose a receipt (message left unseen, retried; Message-ID makes the retry safe). → Task 3 Step 3 (smoke test) + the per-message `catch` in the function.
5. With donations off or no Venmo handle set, nobody is told to Venmo money. → Task 4 tests on DonateCard visibility and the Rules copy.

---

### Task 1: Team codes + idempotent donation insert (DB)

**Files:**
- Create: `supabase/migrations/0021_venmo.sql`
- Create: `tests/db/venmo.test.ts`
- Modify: `.gitignore` (add `*.eml`)

**Interfaces:**
- Produces: `memberships.donation_code text not null unique`; `credit_ledger.source_ref text unique`;
  `private.insert_donation(p_membership uuid, p_dollars numeric, p_note text, p_created_by uuid, p_source_ref text) returns bigint`
  (raises NOT_FOUND / DONATIONS_DISABLED / INVALID_AMOUNT / INVALID_NOTE; unique_violation on a repeated `source_ref`).
  `public.record_donation` keeps its signature and behaviour.

- [ ] **Step 1: Add `*.eml` to `.gitignore`** (so the user's sample receipt can sit in the repo folder untracked)

```
*.eml
```
(append as the last line of `.gitignore`)

- [ ] **Step 2: Write the failing tests** — `tests/db/venmo.test.ts`

```ts
// Venmo donations (spec 2026-10-10-venmo-donations-design.md): team codes, idempotent donation insert, and (Task 2)
// receipt ingest. The Edge Function itself is checked by hand at go-live (no Deno in CI).
import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createUser, freshDb, makeAdmin, migrationSql, rpc } from './helpers';
import { member } from './auction-fixture';

let db: PGlite;
let admin: string, season: string, aliceM: string, bobM: string;

const CODE = /^[BCDFGHJKMNPQRSTVWXZ]{4}$/;
const settings = (s: object) => as(db, admin, (tx) => rpc(tx, 'update_season_settings', { p_season: season, p_settings: s }));
const code = async (mid: string) =>
  (await db.query<{ c: string }>('select donation_code as c from public.memberships where id = $1', [mid])).rows[0].c;
/** Superuser write: fixed codes, so tests never depend on the random ones. */
const setCode = (mid: string, c: string) => db.query('update public.memberships set donation_code = $2 where id = $1', [mid, c]);
const ledger = async (mid: string) => (await db.query<{ amount: number; dollars: string; note: string; source_ref: string | null;
  created_by: string | null }>(
  'select amount, dollars::text as dollars, note, source_ref, created_by from public.credit_ledger where membership_id = $1 order by id',
  [mid])).rows;

async function setup(database: PGlite) {
  db = database;
  admin = await createUser(db, 'admin@x.test');
  await makeAdmin(db, admin);
  await as(db, admin, async (tx) => {
    season = (await rpc(tx, 'create_season', { p_name: '2026-27', p_settings: {} })) as string;
    const league = (await rpc(tx, 'create_league', { p_season: season, p_name: 'League A' })) as string;
    await rpc(tx, 'create_invite', { p_league: league, p_code: 'LEAGUE1', p_max_uses: 50, p_expires_at: null });
  });
  [, aliceM] = await member(db, 'alice');
  [, bobM] = await member(db, 'bob');
}

describe('donation codes', () => {
  beforeEach(async () => setup(await freshDb()));

  it('gives every new team its own 4-consonant code', async () => {
    await settings({ max_members: 50 }); // 22 teams in one league
    const codes = [await code(aliceM), await code(bobM)];
    for (let i = 0; i < 20; i++) codes.push(await code((await member(db, `m${i}`))[1]));
    for (const c of codes) expect(c).toMatch(CODE);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('refuses a duplicate or malformed code', async () => {
    await setCode(aliceM, 'BKRT');
    await expect(setCode(bobM, 'BKRT')).rejects.toThrow(/unique/);
    await expect(setCode(bobM, 'BART')).rejects.toThrow(/check/);
    await expect(setCode(bobM, 'bkrt')).rejects.toThrow(/check/);
  });
});

describe('0021 backfill', () => {
  it('gives teams that existed before the migration a code', async () => {
    const old = await freshDb('0021');
    await setup(old);
    await old.exec(migrationSql('0021_venmo.sql'));
    expect(await code(aliceM)).toMatch(CODE);
    expect(await code(bobM)).toMatch(CODE);
    expect(await code(aliceM)).not.toBe(await code(bobM));
  });
});

describe('insert_donation', () => {
  beforeEach(async () => setup(await freshDb()));
  const insert = (ref: string | null, dollars = 10) => db.query<{ id: number }>(
    'select private.insert_donation($1, $2, $3, null, $4) as id', [aliceM, dollars, 'Venmo Jane: hi', ref]);

  it('records a donation with its source ref and no creator', async () => {
    await settings({ donations_enabled: true });
    await insert('venmo:123');
    expect(await ledger(aliceM)).toEqual([
      { amount: 200, dollars: '10.00', note: 'Venmo Jane: hi', source_ref: 'venmo:123', created_by: null }]);
    const audit = await db.query<{ details: { source_ref: string } }>(
      `select details from public.audit_log where action = 'record_donation'`);
    expect(audit.rows[0].details.source_ref).toBe('venmo:123');
  });

  it('refuses the same source ref twice but allows any number of manual (null) refs', async () => {
    await settings({ donations_enabled: true });
    await insert('venmo:123');
    await expect(insert('venmo:123')).rejects.toThrow(/unique|duplicate/);
    await insert(null);
    await insert(null);
    expect(await ledger(aliceM)).toHaveLength(3);
  });

  it('keeps record_donation\'s rules: off → DONATIONS_DISABLED, bad amount → INVALID_AMOUNT', async () => {
    await expect(insert('venmo:1')).rejects.toThrow('DONATIONS_DISABLED');
    await settings({ donations_enabled: true });
    await expect(insert('venmo:2', 20000)).rejects.toThrow('INVALID_AMOUNT');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/db/venmo.test.ts`
Expected: FAIL — `column "donation_code" does not exist` / `function private.insert_donation(...) does not exist` / ENOENT for `0021_venmo.sql`.

- [ ] **Step 4: Write the migration** — `supabase/migrations/0021_venmo.sql`

```sql
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/db/venmo.test.ts tests/db/rpc-wallet.test.ts tests/db/rpc-gate.test.ts`
Expected: PASS (rpc-wallet proves `record_donation` is unchanged).

- [ ] **Step 6: Full suite + commit**

Run: `npm test` — expected all green.
```bash
git add .gitignore supabase/migrations/0021_venmo.sql tests/db/venmo.test.ts
git commit -m "Venmo donations: team donation codes + idempotent insert_donation (t222)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Receipt ingest + treasurer list (DB)

**GATE:** needs the user's real receipt `.eml` in the repo folder (spec §8). If it isn't there, stop and ask the user for it; do not guess further than the layout below.

**Files:**
- Modify: `supabase/migrations/0021_venmo.sql` (append; insert the new functions BEFORE the existing `revoke all on all functions in schema private …` line, and the public grant loop at the very end)
- Modify: `tests/db/venmo.test.ts` (append)
- Modify: `tests/db/rpc-gate.test.ts:8` (read-only staff RPCs)

**Interfaces:**
- Consumes: Task 1's `private.insert_donation`, `memberships.donation_code`.
- Produces: `private.ingest_venmo_receipt(p_message_id text, p_auth_results text[], p_subject text, p_text text, p_received_at timestamptz) returns text`
  (one of `credited | no_code | unknown_code | ambiguous | unsigned | unparsed | disabled | duplicate`);
  `private.venmo_note(p_text text) returns text`;
  `public.list_venmo_receipts() returns jsonb` = `{ receipts: [{ id, received_at, status, payer, dollars, note, code, team }], skipped: number }`.

- [ ] **Step 1: Read the real receipt exactly as the Edge Function will see it**

```bash
export PATH="/c/Program Files/nodejs:$PATH"
S="$(mktemp -d)"   # outside the repo
npm i --prefix "$S" mailparser@3 >/dev/null
cat > "$S/show.mjs" <<'EOF'
import { readFileSync } from 'node:fs';
import { simpleParser } from 'mailparser';
const mail = await simpleParser(readFileSync(process.argv[2]));
console.log('SUBJECT:', JSON.stringify(mail.subject));
for (const h of mail.headerLines.filter((h) => h.key === 'authentication-results'))
  console.log('AUTH:', JSON.stringify(h.line.replace(/^authentication-results:\s*/i, '').replace(/\r?\n\s+/g, ' ')));
console.log('TEXT:', JSON.stringify(mail.text));
EOF
node "$S/show.mjs" "$(ls /c/Users/19195/Documents/Tribe-Fantasy/*.eml | head -1)"
```
Compare with the layout this plan assumes:
- subject `"<payer> paid you $<amount>"`;
- the FIRST `AUTH:` line starts `mx.google.com;` and contains `dkim=pass header.i=@venmo.com` (or `header.d=venmo.com`);
- in TEXT: a line `<payer> paid you`, then the amount line `$<amount>`, then the note on the next non-blank line; somewhere a `Payment ID: <digits>` (or `Transaction ID`).

If the **first AUTH line has no `dkim=pass` for venmo.com: STOP** and report to the user (spec §8 fallback). If the subject/text layout differs, change ONLY: the subject regex in `ingest_venmo_receipt`, the regex in `private.venmo_note`, the payment-id regex, and `receiptText()` in the test so it reproduces the real layout (with fake names/ids — never commit the user's real data). Note any change in the commit message.

- [ ] **Step 2: Write the failing tests** — append to `tests/db/venmo.test.ts`

```ts
const SIGNED = 'mx.google.com; dkim=pass header.i=@venmo.com header.s=sel1 header.b=AbCd; spf=pass smtp.mailfrom=venmo.com';
interface Receipt { id: string; auth: string[]; payer: string; amount: string; note: string; paymentId: string | null; subject?: string }
/** The plain text of a Venmo "paid you" email, in the layout of the user's real receipt (Step 1). */
const receiptText = (r: Receipt) =>
  `${r.payer} paid you\n$${r.amount}\n${r.note}\n\nSee transaction\n\n${r.paymentId ? `Payment ID: ${r.paymentId}\n` : ''}`;
/** Postgres array literal for text[]. */
const pgArray = (xs: string[]) => `{${xs.map((x) => `"${x.replace(/["\\]/g, '\\$&')}"`).join(',')}}`;
let seq = 0;
async function ingest(over: Partial<Receipt> = {}): Promise<string> {
  const r: Receipt = { id: `<m${++seq}@venmo.com>`, auth: [SIGNED], payer: 'Jane Doe', amount: '10.00', note: 'go team bkrt 🥏',
    paymentId: `40000${String(seq).padStart(5, '0')}`, ...over };
  const res = await db.query<{ s: string }>(
    'select private.ingest_venmo_receipt($1, $2::text[], $3, $4, $5) as s',
    [r.id, pgArray(r.auth), r.subject ?? `${r.payer} paid you $${r.amount}`, receiptText(r), new Date().toISOString()]);
  return res.rows[0].s;
}
const receipts = async () => (await db.query<{ status: string; payer: string | null; dollars: string | null; note: string | null;
  code: string | null; membership_id: string | null }>(
  'select status, payer, dollars::text as dollars, note, code, membership_id from private.venmo_receipts order by id')).rows;

describe('ingest_venmo_receipt', () => {
  beforeEach(async () => {
    await setup(await freshDb());
    await setCode(aliceM, 'BKRT');
    await setCode(bobM, 'ZMPD');
    await settings({ donations_enabled: true });
  });

  it('credits the team whose code is in the note', async () => {
    expect(await ingest({ paymentId: '4000004001' })).toBe('credited');
    expect(await ledger(aliceM)).toEqual([{ amount: 200, dollars: '10.00', note: 'Venmo Jane Doe: go team bkrt 🥏',
      source_ref: 'venmo:4000004001', created_by: null }]);
    expect(await receipts()).toEqual([{ status: 'credited', payer: 'Jane Doe', dollars: '10.00', note: 'go team bkrt 🥏',
      code: 'BKRT', membership_id: aliceM }]);
  });

  it('matches codes case-insensitively as whole words', async () => {
    expect(await ingest({ note: 'ZmPd!' })).toBe('credited');
    expect(await ingest({ note: '🥏ZMPD🥏' })).toBe('credited');
    expect(await ingest({ note: 'BKRTS for the team' })).toBe('no_code');
    expect(await ingest({ note: 'bkrt and BKRT again' })).toBe('credited');
    expect(await ledger(bobM)).toHaveLength(2);
    expect(await ledger(aliceM)).toHaveLength(1);
  });

  it('reads amounts with thousands separators', async () => {
    expect(await ingest({ amount: '1,234.50' })).toBe('credited');
    expect((await ledger(aliceM))[0]).toMatchObject({ amount: 24690, dollars: '1234.50' });
  });

  it('credits a payment once: same message → same answer, same payment id → duplicate', async () => {
    expect(await ingest({ id: '<a@venmo.com>', paymentId: '4000000777' })).toBe('credited');
    expect(await ingest({ id: '<a@venmo.com>', paymentId: '4000000777' })).toBe('credited');
    expect(await ingest({ id: '<b@venmo.com>', paymentId: '4000000777' })).toBe('duplicate');
    expect(await ledger(aliceM)).toHaveLength(1);
    expect((await receipts()).map((r) => r.status)).toEqual(['credited', 'duplicate']);
  });

  it('falls back to the Message-ID when the email has no payment id', async () => {
    expect(await ingest({ id: '<c@venmo.com>', paymentId: null })).toBe('credited');
    expect((await ledger(aliceM))[0].source_ref).toBe('msg:<c@venmo.com>');
  });

  it('only Gmail\'s top verdict for venmo.com counts', async () => {
    for (const auth of [
      [],
      ['mx.google.com; dkim=fail header.i=@venmo.com', SIGNED],
      ['evil.example; dkim=pass header.i=@venmo.com'],
      ['mx.google.com; dkim=pass header.i=@venmo.com.evil.com'],
      ['mx.google.com; dkim=pass header.i=@notvenmo.com'],
      ['mx.google.com; dkim=pass header.i=@gmail.com; spf=pass smtp.mailfrom=venmo.com'],
    ]) expect(await ingest({ auth }), JSON.stringify(auth)).toBe('unsigned');
    expect(await ingest({ auth: ['mx.google.com; dkim=pass header.d=venmo.com'] })).toBe('credited');
    expect(await ingest({ auth: ['MX.GOOGLE.COM; dkim=pass header.i=@email.venmo.com; arc=pass'] })).toBe('credited');
    const unsigned = (await receipts()).filter((r) => r.status === 'unsigned');
    expect(unsigned.every((r) => r.payer === null && r.dollars === null && r.note === null)).toBe(true);
  });

  it('skips personal payments without storing who paid or why', async () => {
    expect(await ingest({ note: 'rent 🏠' })).toBe('no_code');
    expect(await receipts()).toEqual([{ status: 'no_code', payer: null, dollars: null, note: null, code: null, membership_id: null }]);
    expect(await ledger(aliceM)).toEqual([]);
  });

  it('keeps unknown, ambiguous and refused receipts for the treasurer', async () => {
    expect(await ingest({ note: 'for GRRR' })).toBe('unknown_code');
    expect(await ingest({ note: 'BKRT and ZMPD' })).toBe('ambiguous');
    expect(await ingest({ amount: '20,000.00' })).toBe('unparsed');
    expect(await ingest({ subject: 'Your Venmo statement is ready' })).toBe('unparsed');
    await settings({ donations_enabled: false });
    expect(await ingest()).toBe('disabled');
    const rows = await receipts();
    expect(rows[0]).toMatchObject({ status: 'unknown_code', payer: 'Jane Doe', note: 'for GRRR', code: 'GRRR', membership_id: null });
    expect(rows[1]).toMatchObject({ status: 'ambiguous', code: 'BKRT ZMPD' });
    expect(rows[4]).toMatchObject({ status: 'disabled', membership_id: aliceM });
    expect(await ledger(aliceM)).toEqual([]);
  });

  it('is not callable from the app', async () => {
    const [alice] = await member(db, 'mallory');
    await expect(as(db, alice, (tx) => tx.query(
      `select private.ingest_venmo_receipt('<x@x>', '{}'::text[], 's', 't', now())`))).rejects.toThrow(/permission denied/);
  });
});

describe('list_venmo_receipts', () => {
  beforeEach(async () => {
    await setup(await freshDb());
    await setCode(aliceM, 'BKRT');
    await settings({ donations_enabled: true });
  });
  const list = (who: string) => as(db, who, (tx) => rpc(tx, 'list_venmo_receipts', {})) as Promise<{
    receipts: { status: string; payer: string | null; team: string | null }[]; skipped: number }>;

  it('shows the last 30 days of uncredited receipts and counts skipped personal ones', async () => {
    await ingest();                                  // credited → hidden
    await ingest({ note: 'rent' });                  // no_code → counted only
    await ingest({ note: 'rent again' });
    await ingest({ note: 'for GRRR' });              // unknown_code → listed
    await ingest({ auth: [] });                      // unsigned → listed
    await ingest({ note: 'old GRRR' });
    await db.query(`update private.venmo_receipts set created_at = now() - interval '31 days' where note = 'old GRRR'`);
    await settings({ donations_enabled: false });
    await ingest();                                  // disabled → listed with its team
    const out = await list(admin);
    expect(out.skipped).toBe(2);
    expect(out.receipts.map((r) => r.status).sort()).toEqual(['disabled', 'unknown_code', 'unsigned']);
    expect(out.receipts.find((r) => r.status === 'disabled')?.team).toBe('alice');
  });

  it('is for the treasurer and admins only', async () => {
    const treasurer = await createUser(db, 't@x.test');
    await db.query(`insert into public.user_roles (user_id, role) values ($1, 'treasurer')`, [treasurer]);
    await expect(list(treasurer)).resolves.toMatchObject({ skipped: 0 });
    const [alice] = await member(db, 'pat');
    await expect(list(alice)).rejects.toThrow('FORBIDDEN');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/db/venmo.test.ts`
Expected: Task 1 tests PASS; the new ones FAIL with `function private.ingest_venmo_receipt(...) does not exist` / `function public.list_venmo_receipts() does not exist`.

- [ ] **Step 4: Append to the migration** — in `supabase/migrations/0021_venmo.sql`, insert this block directly ABOVE the line `revoke all on all functions in schema private from public, anon, authenticated;`

```sql
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

-- The note in a "paid you" email as text: the first non-blank line after the amount line (layout checked against a
-- real forwarded receipt, plan 2026-10-10 Task 2 Step 1).
create function private.venmo_note(p_text text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim((regexp_match(coalesce(p_text, ''),
    'paid you[ \t]*\r?\n[[:space:]]*\$[0-9,]+\.[0-9]{2}[ \t]*\r?\n[[:space:]]*([^\r\n]+)'))[1]), '')
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
    m := regexp_match(coalesce(p_subject, ''), '^(.+) paid you \$([0-9,]+\.[0-9]{2})$');
    if m is null then
      st := 'unparsed';
    else
      payer := left(btrim(m[1]), 100);
      dollars := replace(m[2], ',', '')::numeric;
      note := left(private.venmo_note(p_text), 200);
      pid := (regexp_match(coalesce(p_text, ''), '(?:Payment|Transaction) ID:?[[:space:]]*([0-9]{6,30})'))[1];
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
```
(`array_agg(distinct …)` sorts, so two codes read `'BKRT ZMPD'`.)

Then append at the very END of the file (after the `revoke all … schema private` line):

```sql
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
```

- [ ] **Step 5: Teach the RPC gate about read-only staff RPCs** — `tests/db/rpc-gate.test.ts`

After the `READ_HELPERS` line add:
```ts
/** Staff-only reads: refused for non-staff like any staff RPC, but they change nothing, so no audit row. */
const STAFF_READS = ['list_venmo_receipts'];
```
and change the `missing` line in the audit test to:
```ts
    const missing = fns.map((f) => f.name).filter((n) => !READ_HELPERS.includes(n) && !STAFF_READS.includes(n) && !covered.has(n));
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/db/venmo.test.ts tests/db/rpc-gate.test.ts`
Expected: PASS.

- [ ] **Step 7: Full suite + commit**

Run: `npm test` — all green.
```bash
git add supabase/migrations/0021_venmo.sql tests/db/venmo.test.ts tests/db/rpc-gate.test.ts
git commit -m "Venmo donations: ingest receipts (Gmail DKIM verdict, code match, idempotent) + treasurer list (t222)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Edge Function `venmo-intake` + runbook

**Files:**
- Create: `supabase/functions/venmo-intake/index.ts`
- Modify: `docs/setup-supabase.md` (new section after the M10 notifications section)

**Interfaces:**
- Consumes: `private.ingest_venmo_receipt(text, text[], text, text, timestamptz) returns text` (Task 2).
- Produces: HTTP endpoint `POST /functions/v1/venmo-intake` (header `x-cron-secret`), JSON `{ [status]: count, error?: n }`.

- [ ] **Step 1: Write the function** — `supabase/functions/venmo-intake/index.ts`

```ts
// Venmo receipts → credits (spec docs/superpowers/specs/2026-10-10-venmo-donations-design.md §5). Runs on Supabase
// Edge Functions (Deno), deployed by pasting this file into the dashboard with "Verify JWT" OFF; pg_cron calls it every
// 10 minutes (docs/setup-supabase.md). Every decision lives in SQL (0021_venmo.sql): this only fetches mail.
// Reads ONLY the dedicated Venmo Gmail. Secrets: CRON_SECRET, VENMO_GMAIL_USER, VENMO_GMAIL_APP_PASSWORD.
import postgres from 'npm:postgres@3';
import { ImapFlow } from 'npm:imapflow@1';
import { simpleParser } from 'npm:mailparser@3';

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };

const env = (key: string) => {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`missing secret ${key}`);
  return v;
};

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return new Response('unauthorized', { status: 401 });
  const sql = postgres(env('SUPABASE_DB_URL'), { max: 1, prepare: false });
  const imap = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: env('VENMO_GMAIL_USER'), pass: env('VENMO_GMAIL_APP_PASSWORD') },
  });
  const counts: Record<string, number> = {};
  try {
    await imap.connect();
    const lock = await imap.getMailboxLock('INBOX');
    try {
      const uids = ((await imap.search({ seen: false }, { uid: true })) || []).slice(0, 50);
      for (const uid of uids) {
        try {
          const msg = await imap.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const mail = await simpleParser(msg.source);
          // Top first: the first is the one Gmail added on receipt (the only one SQL trusts).
          const auth = mail.headerLines.filter((h) => h.key === 'authentication-results')
            .map((h) => h.line.replace(/^authentication-results:\s*/i, '').replace(/\r?\n\s+/g, ' '));
          const [{ s }] = await sql`select private.ingest_venmo_receipt(${mail.messageId ?? `uid:${uid}`},
            ${sql.array(auth)}::text[], ${mail.subject ?? ''}, ${mail.text ?? ''}, ${mail.date ?? null}) as s`;
          counts[s] = (counts[s] ?? 0) + 1;
          await imap.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        } catch (e) {
          // Leave it unseen so the next run retries; the Message-ID makes a retry safe.
          console.error(String(e));
          counts.error = (counts.error ?? 0) + 1;
          await imap.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true }).catch(() => {});
        }
      }
    } finally {
      lock.release();
    }
    await imap.logout();
  } finally {
    await sql.end();
  }
  console.log(JSON.stringify(counts));
  return Response.json(counts);
});
```

- [ ] **Step 2: Lint it**

Run: `npm run lint`
Expected: no errors (supabase/functions is linted; it isn't type-checked — no Deno types locally, same as `notify`).

- [ ] **Step 3: Write the runbook** — in `docs/setup-supabase.md`, add a new section after the M10 notifications section:

````markdown
## Venmo donations (0021, Edge Function `venmo-intake`)

Donors Venmo the treasurer with their team's 4-letter code in the note. Venmo's "paid you" emails are forwarded to a
Gmail that holds nothing else; `venmo-intake` reads only that mailbox every 10 minutes and SQL credits the team.
Your personal inbox's password never goes into Supabase.

1. SQL Editor: paste and run `supabase/migrations/0021_venmo.sql` BEFORE pushing the app (the new app reads
   `memberships.donation_code`). If asked, choose **Run without RLS** (`private.venmo_receipts` isn't API-exposed).
   Check: `select count(*) from public.memberships where donation_code is null;` → 0.
2. Make a new Gmail used only for this (e.g. `tribefantasy.venmo@gmail.com`). Turn on 2-Step Verification, then
   create an **app password** (Google Account → Security → App passwords).
3. In your **personal** Gmail: Settings → Forwarding and POP/IMAP → **Add a forwarding address** → the new address;
   open the confirmation email in the new account and click the link. Leave "Disable forwarding" selected there (the
   filter below forwards only Venmo receipts).
4. Personal Gmail → Create a filter: From `venmo@venmo.com`, Has the words `"paid you"` → **Forward it to** the new
   address (optionally also apply a label).
5. **Edge Functions → Deploy a new function → Via editor**, name it `venmo-intake`: paste
   `supabase/functions/venmo-intake/index.ts`, turn **Verify JWT** OFF. **Secrets**: add `VENMO_GMAIL_USER` (the new
   address) and `VENMO_GMAIL_APP_PASSWORD` (step 2). `CRON_SECRET` is already there from `notify`.
6. Smoke test (before scheduling): have someone Venmo you $1 with a team's code in the note (Home shows each team's
   code). Wait for it to arrive in the new inbox, then in SQL Editor:
   ```sql
   select net.http_post(
     url := 'https://effyjptuoztyduydwcwh.supabase.co/functions/v1/venmo-intake',
     headers := '{"x-cron-secret": "PASTE-CRON-SECRET-HERE"}'::jsonb,
     timeout_milliseconds := 60000);
   ```
   then `select status, payer, dollars, code from private.venmo_receipts order by id desc limit 5;` → `credited`
   (or `disabled` if donations are still off — fine for the test). **Edge Functions → venmo-intake → Logs** show
   the counts. `unsigned` means the forwarded mail lost Venmo's signature: stop and tell Claude.
   If the logs show a connection error to `imap.gmail.com:993`, Supabase blocks that port: stop and tell Claude.
7. Schedule it:
   ```sql
   select cron.schedule('venmo-intake', '*/10 * * * *', $$
     select net.http_post(
       url := 'https://effyjptuoztyduydwcwh.supabase.co/functions/v1/venmo-intake',
       headers := '{"x-cron-secret": "PASTE-CRON-SECRET-HERE"}'::jsonb,
       timeout_milliseconds := 60000
     )
   $$);
   ```
8. Admin → Settings: set `"venmo_handle": "<your Venmo username, no @>"` and `"donations_enabled": true`.

Stop all intake: `select cron.unschedule('venmo-intake');`. Receipts that didn't become credits are listed in
Admin → Wallets; fix them with **Record a donation**. A refund = **Adjust credits** with a negative number.
````

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/venmo-intake/index.ts docs/setup-supabase.md
git commit -m "Venmo donations: venmo-intake Edge Function + setup runbook (t222)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: App — Venmo handle setting, Donate box on Home, receipts in Wallets, Rules copy

**Files:**
- Modify: `src/core/settings.ts` (interface, `DEFAULT_SETTINGS`, `CHECKS`)
- Modify: `src/core/settings.test.ts`
- Modify: `src/app/lib/rpc.ts` (type + `listVenmoReceipts`)
- Create: `src/app/pages/DonateBox.tsx`, `src/app/pages/DonateBox.test.tsx`
- Modify: `src/app/pages/HomePage.tsx` (query + render DonateBox)
- Create: `src/app/pages/admin/VenmoReceipts.tsx`, `src/app/pages/admin/VenmoReceipts.test.tsx`
- Modify: `src/app/pages/admin/WalletsPanel.tsx` (render VenmoReceipts)
- Modify: `src/app/pages/RulesPage.tsx:41-42,171-174`, `src/app/pages/RulesPage.test.tsx`

**Interfaces:**
- Consumes: `memberships.donation_code` (Task 1), `public.list_venmo_receipts()` (Task 2).
- Produces: `SeasonSettings.venmo_handle: string | null`; `api.listVenmoReceipts(): Promise<VenmoReceiptList>`;
  `<DonateBox code handle creditsPerDollar />`; `<VenmoReceipts />`.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/settings.test.ts` (inside the top-level `describe`, or as a new `describe` at the end):
```ts
describe('venmo_handle', () => {
  it('defaults to null and accepts a Venmo username without @', () => {
    expect(DEFAULT_SETTINGS.venmo_handle).toBeNull();
    expect(parseSettings({ venmo_handle: 'Tribe-Fund_23' }).venmo_handle).toBe('Tribe-Fund_23');
  });
  it('rejects @, spaces and bad lengths', () => {
    for (const bad of ['@tribe', 'tri be', 'abcd', 'x'.repeat(31), 5]) {
      expect(() => parseSettings({ venmo_handle: bad }), String(bad)).toThrow(/venmo_handle/);
    }
  });
});
```
(`parseSettings` and `DEFAULT_SETTINGS` are already imported in that file.)

`src/app/pages/DonateBox.test.tsx`:
```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DonateBox } from './DonateBox';

afterEach(cleanup);

describe('DonateBox', () => {
  it('shows the team code and a Venmo link with the code already in the note', () => {
    render(<DonateBox code="BKRT" handle="tribe-fund" creditsPerDollar={20} />);
    fireEvent.click(screen.getByText(/Donate to the team/));
    const link = screen.getByRole('link', { name: /@tribe-fund/ }) as HTMLAnchorElement;
    const url = new URL(link.href);
    expect(url.searchParams.get('recipients')).toBe('tribe-fund');
    expect(url.searchParams.get('note')).toBe('Tribe Fantasy BKRT');
    expect(url.searchParams.get('audience')).toBe('private');
    expect(document.body.textContent).toMatch(/team fund/);
    expect(document.body.textContent).toMatch(/no cash value/);
    expect(document.body.textContent).toMatch(/\$1 = 20 credits/);
  });

  it('copies the code', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DonateBox code="BKRT" handle="tribe-fund" creditsPerDollar={20} />);
    fireEvent.click(screen.getByText(/Donate to the team/));
    fireEvent.click(screen.getByRole('button', { name: /copy bkrt/i }));
    expect(writeText).toHaveBeenCalledWith('BKRT');
    await waitFor(() => expect(screen.getByRole('button', { name: /copied/i })).toBeTruthy());
  });
});
```

`src/app/pages/admin/VenmoReceipts.test.tsx`:
```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VenmoReceipts } from './VenmoReceipts';
import type { VenmoReceiptList } from '../../lib/rpc';

const list = vi.hoisted(() => ({ value: { receipts: [], skipped: 0 } as VenmoReceiptList }));
vi.mock('../../lib/rpc', () => ({ api: { listVenmoReceipts: () => Promise.resolve(list.value) } }));

afterEach(cleanup);

describe('VenmoReceipts', () => {
  it('lists receipts that did not become credits, in plain words', async () => {
    list.value = {
      skipped: 3,
      receipts: [
        { id: 2, received_at: '2026-11-01T15:00:00Z', status: 'unknown_code', payer: 'Jane Doe', dollars: 10, note: 'for GRRR',
          code: 'GRRR', team: null },
        { id: 1, received_at: '2026-11-01T14:00:00Z', status: 'unsigned', payer: null, dollars: null, note: null, code: null, team: null },
      ],
    };
    render(<VenmoReceipts />);
    expect(await screen.findByText(/Venmo receipts not credited \(2\)/)).toBeTruthy();
    expect(document.body.textContent).toContain('No team has that code');
    expect(document.body.textContent).toContain('Not a verified Venmo email');
    expect(document.body.textContent).toContain('Jane Doe');
    expect(document.body.textContent).toContain('$10.00');
    expect(document.body.textContent).toContain('3 other Venmo payments without a team code were skipped');
  });

  it('says so when everything was credited', async () => {
    list.value = { skipped: 0, receipts: [] };
    render(<VenmoReceipts />);
    expect(await screen.findByText(/Venmo receipts not credited \(0\)/)).toBeTruthy();
    expect(document.body.textContent).toContain('Every Venmo donation in the last 30 days was credited.');
  });
});
```

Append to `src/app/pages/RulesPage.test.tsx` inside `describe('RulesPage', …)`:
```tsx
  it('says donations are not open while they are off', () => {
    render(<RulesPage />);
    expect(document.body.textContent).toContain("Donations aren't open yet.");
    expect(document.body.textContent).not.toMatch(/Venmo/);
  });

  it('explains how to donate by Venmo once donations are on', async () => {
    current = { id: 'se', name: 'Spring 2027', settings: parseSettings({ donations_enabled: true, venmo_handle: 'tribe-fund' }) };
    render(<RulesPage />);
    expect(await screen.findByText(/Venmo @tribe-fund/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/4-letter code/);
    expect(document.body.textContent).not.toContain("Donations aren't open yet.");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/core/settings.test.ts src/app/pages/DonateBox.test.tsx src/app/pages/admin/VenmoReceipts.test.tsx src/app/pages/RulesPage.test.tsx`
Expected: FAIL — `venmo_handle` undefined / cannot find module `./DonateBox` / `./VenmoReceipts` / Rules text missing.

- [ ] **Step 3: Setting** — `src/core/settings.ts`

In `interface SeasonSettings`, after `donations_enabled: boolean;`:
```ts
  /** The treasurer's Venmo username (no @), shown with each team's donation code. Null = no Venmo box. */
  venmo_handle: string | null;
```
In `DEFAULT_SETTINGS`, after `donations_enabled: false,`:
```ts
  venmo_handle: null,
```
In `CHECKS`, after `donations_enabled: bool,`:
```ts
  venmo_handle: nullable((v) =>
    typeof v === 'string' && /^[A-Za-z0-9_-]{5,30}$/.test(v) ? null : 'must be a Venmo username: 5-30 letters, digits, - or _ (no @)'),
```

- [ ] **Step 4: RPC** — `src/app/lib/rpc.ts`

After the `LeagueListing` interface:
```ts
/** list_venmo_receipts(): receipts that didn't become credits (last 30 days) + skipped personal payments. */
export interface VenmoReceipt {
  id: number;
  received_at: string;
  status: 'unknown_code' | 'ambiguous' | 'unsigned' | 'unparsed' | 'disabled' | 'duplicate';
  payer: string | null;
  dollars: number | null;
  note: string | null;
  code: string | null;
  team: string | null;
}
export interface VenmoReceiptList { receipts: VenmoReceipt[]; skipped: number }
```
In `api`, after `recordDonation`:
```ts
  listVenmoReceipts: () => call<VenmoReceiptList>('list_venmo_receipts', {}),
```

- [ ] **Step 5: DonateBox** — `src/app/pages/DonateBox.tsx`

```tsx
import { useState } from 'react';

/** How a team donates: Venmo the treasurer with the team's code in the note (spec 2026-10-10 §6). */
export function DonateBox({ code, handle, creditsPerDollar }: { code: string; handle: string; creditsPerDollar: number }) {
  const [copied, setCopied] = useState(false);
  // Opens the Venmo app on a phone with the recipient and note filled in; private so it stays off the public feed.
  const venmo = `https://venmo.com/?${new URLSearchParams({ txn: 'pay', audience: 'private', recipients: handle,
    note: `Tribe Fantasy ${code}` })}`;
  return (
    <details className="card">
      <summary>Donate to the team · code <strong>{code}</strong></summary>
      <p>Venmo <a href={venmo} target="_blank" rel="noreferrer">@{handle}</a> and keep <strong>{code}</strong> in the
        note. Credits show up within about 10 minutes.</p>
      <button type="button" className="secondary"
        onClick={() => void navigator.clipboard.writeText(code).then(() => setCopied(true))}>
        {copied ? 'Copied' : `Copy ${code}`}
      </button>
      <p className="muted">Every dollar is a donation to the team fund. $1 = {creditsPerDollar} credits. Credits have no
        cash value and can't be refunded.</p>
    </details>
  );
}
```

- [ ] **Step 6: Home wiring** — `src/app/pages/HomePage.tsx`

Import: `import { DonateBox } from './DonateBox';` and `import { DEFAULT_SETTINGS } from '../../core/settings';`

`MembershipRow`: add `donation_code: string;` and change `seasons: { name: string } | null` to
`seasons: { name: string; settings: { donations_enabled?: unknown; venmo_handle?: unknown; credits_per_dollar?: unknown } } | null`.

Select string becomes:
```ts
      .select(`id, team_name, league_id, created_at, donation_code, leagues(name, season_id, seasons(name, settings)), credit_ledger(${LEDGER_COLUMNS})`)
```
In the `data?.map((m) => { … })` body, after `const manage = …;` add:
```tsx
        const s = m.leagues?.seasons?.settings;
        const donate = s?.donations_enabled === true && typeof s.venmo_handle === 'string'
          ? <DonateBox code={m.donation_code} handle={s.venmo_handle}
              creditsPerDollar={Number(s.credits_per_dollar ?? DEFAULT_SETTINGS.credits_per_dollar)} />
          : null;
```
and render `{donate}` right before `{manage}` in BOTH returns:
`<Fragment key={m.id}>{team}{donate}{manage}</Fragment>` and, in the second return, `{donate}` on the line before `{manage}`.

- [ ] **Step 7: VenmoReceipts** — `src/app/pages/admin/VenmoReceipts.tsx`

```tsx
import { Loading } from '../../components/Loading';
import { api, type VenmoReceipt } from '../../lib/rpc';
import { useLoad } from '../../lib/useLoad';

const REASON: Record<VenmoReceipt['status'], string> = {
  unknown_code: 'No team has that code',
  ambiguous: 'More than one team code in the note',
  unsigned: 'Not a verified Venmo email',
  unparsed: "Couldn't read the amount (or over $10,000)",
  disabled: 'Donations were turned off',
  duplicate: 'Already credited (same Venmo payment)',
};

/** Venmo receipts that didn't become credits. Fix one with "Record a donation" below. */
export function VenmoReceipts() {
  const list = useLoad(() => api.listVenmoReceipts(), []);
  const receipts = list.data?.receipts ?? [];
  return (
    <details className="section">
      <summary>Venmo receipts not credited ({receipts.length})</summary>
      {!list.data && !list.error && <Loading />}
      {list.error && <p className="error" role="alert">{list.error}</p>}
      {list.data && receipts.length === 0 && <p className="muted">Every Venmo donation in the last 30 days was credited.</p>}
      <ul className="list">
        {receipts.map((r) => (
          <li key={r.id}>
            <span>
              {r.payer ?? '—'}{r.note ? `: ${r.note}` : ''} <small>{new Date(r.received_at).toLocaleString()}</small>
              <br /><small className="muted">{REASON[r.status]}{r.team ? ` · ${r.team}` : ''}</small>
            </span>
            <strong className="num">{r.dollars === null ? '' : `$${Number(r.dollars).toFixed(2)}`}</strong>
          </li>
        ))}
      </ul>
      {list.data && list.data.skipped > 0 && (
        <p className="muted">{list.data.skipped} other Venmo payments without a team code were skipped.</p>
      )}
    </details>
  );
}
```
Check `useLoad`'s error type before relying on `{list.error}` rendering as text (WalletsPanel renders `data.error` the same way, so it's a string).

- [ ] **Step 8: Wallets wiring** — `src/app/pages/admin/WalletsPanel.tsx`

Import `import { VenmoReceipts } from './VenmoReceipts';` and render `<VenmoReceipts />` directly above the `<CreditForm title="Adjust credits" …>` element.

- [ ] **Step 9: Rules copy** — `src/app/pages/RulesPage.tsx`

Lines 41–42 (the notice) become:
```tsx
        Tribe Fantasy is a fantasy league for our team. Playing is free. Donations go to the team fund
        {S.donations_enabled ? '.' : ", and they aren't open yet."}{' '}
```
The FAQ answer (lines 172–174) becomes:
```tsx
          <p>A donation is a donation to the team fund. It buys credits at {S.credits_per_dollar} credits per
            dollar. Credits have no cash value and can't be refunded or cashed out.{' '}
            {S.donations_enabled && S.venmo_handle
              ? <>To donate, Venmo @{S.venmo_handle} with your team's 4-letter code in the note (it's on your Home
                page). Credits show up within about 10 minutes.</>
              : "Donations aren't open yet."}</p>
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run src/core/settings.test.ts src/app/pages/DonateBox.test.tsx src/app/pages/admin/VenmoReceipts.test.tsx src/app/pages/RulesPage.test.tsx`
Expected: PASS.

- [ ] **Step 11: Typecheck, lint, build, full suite**

Run: `npx tsc -b && npm run lint && npm run build && npm test`
Expected: all green.

- [ ] **Step 12: Commit**

```bash
git add src/core/settings.ts src/core/settings.test.ts src/app/lib/rpc.ts src/app/pages/DonateBox.tsx src/app/pages/DonateBox.test.tsx \
  src/app/pages/HomePage.tsx src/app/pages/admin/VenmoReceipts.tsx src/app/pages/admin/VenmoReceipts.test.tsx \
  src/app/pages/admin/WalletsPanel.tsx src/app/pages/RulesPage.tsx src/app/pages/RulesPage.test.tsx
git commit -m "Venmo donations: venmo_handle setting, Donate box on Home, uncredited receipts in Wallets, Rules copy (t222)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Controller wrap-up (not a subagent task)

- [ ] Spec amendments in `docs/superpowers/specs/2026-10-10-venmo-donations-design.md` (new §10): Donate box has a
  prefilled private Venmo link (note `Tribe Fantasy <code>`); a deleted team's code can be handed out again
  (dropping "never reused"); `record_donation` keeps its signature (the shared body is `private.insert_donation`);
  any receipt-layout changes found in Task 2 Step 1. Commit.
- [ ] Final review (opus) of `main..venmo-donations`; fix wave if needed.
- [ ] Visual check in the preview (signed in): Home Donate box at 375px and desktop with a throwaway season that has
  `donations_enabled` + `venmo_handle`; Admin → Wallets receipts section.
- [ ] Board: add/tick t222 (phase p15).
- [ ] GO-LIVE ORDER (user): paste 0021 FIRST (anon probe: `list_venmo_receipts` → 42501), then push to main with
  the user's OK, CI + Deploy green, tag `m12-venmo` (`git push origin refs/tags/m12-venmo`). Then runbook steps 2–8
  (Gmail, forwarding, function, smoke test, cron, settings).
- [ ] `graphify update .`, memory update, delete branch.

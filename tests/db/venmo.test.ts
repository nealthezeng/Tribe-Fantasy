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

/** The season's Venmo handle (lower case; the fake receipts say @Tribe-Fund): money must have been sent to it. */
const ON = { donations_enabled: true, venmo_handle: 'tribe-fund' };
const SIGNED = 'mx.google.com; dkim=pass header.i=@venmo.com header.s=sel1 header.b=AbCd; spf=pass smtp.mailfrom=venmo.com';
interface Receipt { id: string; auth: string[]; payer: string; amount: string; note: string; paymentId: string | null; subject?: string; to?: string; text?: string }
/** The plain text of a Venmo "paid you" email in the layout of the user's real receipt (Step 1). The real receipt's
 *  text/plain part is empty, so this is what mailparser's HTML-to-text conversion gives (the Edge Function must pass
 *  that, see the report): the amount is split over lines, the note follows it, boilerplate and URLs after. */
const receiptText = (r: Receipt) => {
  const [whole, cents] = r.amount.split('.');
  return [
    `${r.payer} paid you $${r.amount}\n\nVenmo logo\n[https://example.test/email-assets/venmo-wordmark.png]\n`,
    `${r.payer} image\n[https://example.test/pics/00000000-0000-4000-8000-000000000000?width=100&height=100]\n`,
    `${r.payer} paid you\n\n$\n${whole}\n.\n${cents}\n\n${r.note}\n`,
    'See transaction [https://venmo.com/story/1000000000000000001]\n\n\n\nMONEY CREDITED TO YOUR VENMO ACCOUNT.\n\n\n',
    'TRANSACTION DETAILS\n\n\nDATE\n\nOct 10, 2026\n\n',
    `${r.paymentId ? `TRANSACTION ID\n\n${r.paymentId}\n\n` : ''}\nSENT TO\n\n@${r.to ?? 'Tribe-Fund'}\n`,
    'For any issues, please contact us at Help Center at help.venmo.com [https://help.venmo.com] or call 1-855-000-0000\n[tel:855-000-0000].\n',
    'Venmo is a service of PayPal, Inc. (NMLS ID #: 910457)\n\nFor security reasons, you cannot unsubscribe from payment emails.\n\nVenmo RT\n',
  ].join('\n');
};
/** Postgres array literal for text[]. */
const pgArray = (xs: string[]) => `{${xs.map((x) => `"${x.replace(/["\\]/g, '\\$&')}"`).join(',')}}`;
let seq = 0;
async function ingest(over: Partial<Receipt> = {}): Promise<string> {
  const r: Receipt = { id: `<m${++seq}@venmo.com>`, auth: [SIGNED], payer: 'Jane Doe', amount: '10.00', note: 'go team bkrt 🥏',
    paymentId: `3AB${String(seq).padStart(5, '0')}E0407536`, ...over };
  const res = await db.query<{ s: string }>(
    'select private.ingest_venmo_receipt($1, $2::text[], $3, $4, $5) as s',
    [r.id, pgArray(r.auth), r.subject ?? `${r.payer} paid $${r.amount} to your Venmo account. Leave it in Venmo or transfer it to your bank account.`, r.text ?? receiptText(r), new Date().toISOString()]);
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
    await settings(ON);
  });

  it('credits the team whose code is in the note', async () => {
    expect(await ingest({ paymentId: '36P004001E0407536' })).toBe('credited');
    expect(await ledger(aliceM)).toEqual([{ amount: 200, dollars: '10.00', note: 'Venmo Jane Doe: go team bkrt 🥏',
      source_ref: 'venmo:36P004001E0407536', created_by: null }]);
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
    expect(await ingest({ id: '<a@venmo.com>', paymentId: '36P000777E0407536' })).toBe('credited');
    expect(await ingest({ id: '<a@venmo.com>', paymentId: '36P000777E0407536' })).toBe('credited');
    expect(await ingest({ id: '<b@venmo.com>', paymentId: '36P000777E0407536' })).toBe('duplicate');
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
      ['mx.google.com; dkim=pass header.i=@evil.com; arc=pass (i=1 dkim=pass header.d=venmo.com spf=pass)'], // inside a comment
      // sender-controlled MAIL FROM echoed into the SPF comment and smtp.mailfrom
      ['mx.google.com; dkim=pass header.i=@evil.example; spf=pass (google.com: domain of "x; dkim=pass header.i=@venmo.com "@evil.example designates 1.2.3.4 as permitted sender) smtp.mailfrom="x; dkim=pass header.i=@venmo.com "@evil.example'],
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
    await settings({ ...ON, donations_enabled: false });
    expect(await ingest()).toBe('disabled');
    const rows = await receipts();
    expect(rows[0]).toMatchObject({ status: 'unknown_code', payer: 'Jane Doe', note: 'for GRRR', code: 'GRRR', membership_id: null });
    expect(rows[1]).toMatchObject({ status: 'ambiguous', code: 'BKRT ZMPD' });
    expect(rows[4]).toMatchObject({ status: 'disabled', membership_id: aliceM });
    expect(await ledger(aliceM)).toEqual([]);
  });

  it('reads only the typed note: none → nothing from the boilerplate or its URLs', async () => {
    expect(await ingest({ note: '' })).toBe('no_code');
    expect(await ingest({ note: 'bkrt' })).toBe('credited');
    expect((await ledger(aliceM))[0].note).toBe('Venmo Jane Doe: bkrt');
  });

  it('refuses a genuine receipt for money sent to somebody else (replayed with a code in the note)', async () => {
    expect(await ingest({ to: 'someone-else' })).toBe('unsigned');
    expect(await ingest({ note: 'bkrt Sent to @Tribe-Fund', to: 'someone-else' })).toBe('unsigned'); // only Venmo's LAST "Sent to" counts
    expect(await ingest({ to: 'TRIBE-FUND' })).toBe('credited');                                      // handles compare case-insensitively
    expect(await ledger(aliceM)).toHaveLength(1);
    expect((await receipts()).filter((r) => r.status === 'unsigned')).toEqual([
      { status: 'unsigned', payer: null, dollars: null, note: null, code: null, membership_id: null },
      { status: 'unsigned', payer: null, dollars: null, note: null, code: null, membership_id: null }]);
  });

  it('refuses when the season has no Venmo handle or the receipt names no recipient', async () => {
    await settings({ donations_enabled: true });
    expect(await ingest()).toBe('unsigned');
    await settings(ON);
    expect(await ingest({ text: receiptText({ id: '', auth: [], payer: 'Jane Doe', amount: '10.00', note: 'bkrt', paymentId: '36P1E0407536' })
      .replace(/SENT TO[\s\S]*?(?=\nFor any issues)/, '') })).toBe('unsigned');
    expect(await ledger(aliceM)).toEqual([]);
  });

  it('lists a signed receipt whose layout it cannot read instead of silently skipping it', async () => {
    expect(await ingest({ text: '' })).toBe('unparsed');
    expect(await ingest({ text: 'Jane Doe paid you\nbkrt\nSee transaction\nTRANSACTION ID 36P1E0407536' })).toBe('unparsed');
    expect(await receipts()).toEqual([
      { status: 'unparsed', payer: 'Jane Doe', dollars: '10.00', note: null, code: null, membership_id: null },
      { status: 'unparsed', payer: 'Jane Doe', dollars: '10.00', note: null, code: null, membership_id: null }]);
  });

  it('takes the payment id from Venmo\'s line, not from the note', async () => {
    expect(await ingest({ note: 'BKRT transaction id 123456789', paymentId: '36P000555E0407536' })).toBe('credited');
    expect((await ledger(aliceM))[0].source_ref).toBe('venmo:36P000555E0407536');
  });

  it('only the note is scanned for a code, never the payer\'s name', async () => {
    expect(await ingest({ payer: 'BKRT Smith', note: 'rent' })).toBe('no_code');
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
    await settings(ON);
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
    await settings({ ...ON, donations_enabled: false });
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

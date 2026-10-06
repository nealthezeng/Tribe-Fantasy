# M10 Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Invoke `ponytail:ponytail` before writing code (project rule).

**Goal:** Email every manager 24 h and 2 h before an auction's bidding closes, and when they have to pick their player for the next tournament game. Users can opt out on the Me page.

**Architecture:** SQL decides who gets which email: migration 0016 adds `private.outbox`, `queue_bid_reminders()`, a trigger on `game_pairings`, and `claim_outbox()`/`mark_outbox()`. A thin Supabase Edge Function (`notify`), run every minute by `pg_cron` + `pg_net`, sends the claimed rows through the existing Gmail account over SMTP port 465. The app adds one Me-page switch backed by `set_notify_email`.

**Tech Stack:** Postgres (Supabase; PGlite in tests), Deno Edge Function (`npm:postgres`, `npm:nodemailer`), React 19 + TS, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-05-m10-notifications-design.md` (§1–§11 plus §12 amendments from the verified build). Executors read both.

**Where:** worktree `C:\Users\19195\Documents\Tribe-Fantasy-m10`, branch `m10-notify`. **Never touch `C:\Users\19195\Documents\Tribe-Fantasy`**: another session works there.

**Verified draft:** branch `m10-notify-verified-draft` (head 0f1ab86, rebased on main 74e9c26 = M9 wrap-up) holds the full implementation: 419 tests, tsc, lint and build all green. Every code block below is copied from it. An executor may run `git checkout m10-notify-verified-draft -- <path>` instead of retyping, then diff against this plan.

## Global Constraints

- Node/npm aren't on the Bash PATH: run `export PATH="/c/Program Files/nodejs:$PATH"` first.
- Migration number is **0016** (0015 is reserved for board t125 in the other session; a gap is harmless).
- Every new `security definer` function sets `search_path = ''` (guards.test.ts enforces it).
- `private` functions are never executable by `anon`/`authenticated`: end the private block with `revoke all on all functions in schema private from public, anon, authenticated;`.
- Every new public RPC writes an audit row and appears in `tests/db/rpc-gate.test.ts` (that file discovers RPCs from `pg_proc` and fails on any it doesn't list).
- Times shown to users are Eastern (`America/New_York`). The site URL is `https://nealthezeng.github.io/Tribe-Fantasy/`.
- Exact copy:
  - Bid subject: `Bidding for <stage> closes within 24 hours` / `within 2 hours`.
  - Pick subject: `Pick your player for game <n>` plus ` vs <opponent>` when it's set.
  - Footer: `Turn these emails off: https://nealthezeng.github.io/Tribe-Fantasy/#/me`.
  - Switch label: `Email me before bidding closes and when it's time to pick for the next game.`
- UI follows DESIGN.md + `src/app/tokens.css`: the switch reuses the existing `label.check` style, so no new CSS.
- DB tests use the fixtures in `tests/db/auction-fixture.ts`. Stage dates are fixed (2026-10-18..11-08); close times are set relative to `now()` on purpose.
- Run DB tests alone (`npx vitest run tests/db`) when a dev server or other agents are busy: PGlite boots time out under load.

## Review Focus

1. **Gmail refuses a send, or nodemailer misbehaves in the Edge runtime** (no CI coverage: there's no Deno here).
   - Expected: the row records the error and is retried up to 3 times; nothing else stops.
   - Pinned by the `mark_outbox` retry test (Task 1). The runtime itself is proven by the go-live smoke test
     (Wrap-up step 4).
2. **The scheduler stops for a while** (Supabase pauses an idle free project, or cron fails), then resumes.
   - Expected: no burst of stale "bidding closes in 2 hours" or "pick for game 3" mail. Anything queued over 30
     minutes ago is dropped.
   - Pinned by the 30-minute expiry test (Task 1).
3. **An admin moves the close time, or runs the auction early.**
   - Expected: reminders for the old time are never sent. The new time gets its own reminders.
   - Pinned by the requeue test and the "drops a bid reminder once its close time moved, or once the auction ran"
     test (Task 1).
4. **A manager picks in the minute between Finish and the sender's run, or the game starts before the email goes
   out.**
   - Expected: no stale "pick your player" email.
   - Pinned by the "picked after it was queued" and "game has started" claim tests (Task 1).
5. **A manager in two leagues, or one who turned emails off.**
   - Expected: one email per team; none at all when off. A user with no profile row counts as on.
   - Pinned by the two-league test and the opt-out tests (Task 1), plus the switch test (Task 3).

---

### Task 1: Migration 0016 and its DB tests

Model: sonnet (SQL + integration).

**Files:**
- Create: `supabase/migrations/0016_notify.sql`
- Create: `tests/db/notify.test.ts`
- Modify: `tests/db/rpc-gate.test.ts` (MEMBER_CALLABLE list and one audit step)

**Interfaces:**
- Consumes (existing):
  - RPCs: `open_tournament(p_stage, p_pairings)`, `finish_game(p_game, p_pairings, p_provisional)`,
    `start_game(p_game)`, `reset_game(p_game)`, `set_game_pick(...)`, `open_auction(p_stage, p_close_at)`,
    `run_auction(p_stage)`.
  - Helpers: `private.require_user()`, `private.audit(action, entity, id, details)`.
  - Test helpers: `auctionFixture`, `member`, `grant`, `bid`, `openAuction`, `closeBids`, `runAuction`,
    `makeKeeper`, `as`, `rpc`, `createUser`.
- Produces (used by Task 2):
  - `private.queue_bid_reminders() returns int`
  - `private.claim_outbox(p_limit int) returns table (id bigint, email text, subject text, body text)`
  - `private.mark_outbox(p_id bigint, p_error text) returns void`
  - The `private.outbox` table (kinds `bid_24h | bid_2h | pick_next | test`).
- Produces (used by Task 3): `public.set_notify_email(p_on boolean) returns void` and the column
  `public.profiles.notify_email boolean not null default true`.

- [ ] **Step 1: Write the failing test.** Create `tests/db/notify.test.ts`:

```ts
// M10 email notifications (spec 2026-10-05-m10-notifications-design.md §3–§5): what gets queued in private.outbox,
// and what the sender may claim. The Edge Function itself is checked by hand at go-live (no Deno in CI).
import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, bid, closeBids, grant, member, openAuction, runAuction, type AuctionFixture } from './auction-fixture';
import { makeKeeper } from './stats-fixture';

let f: AuctionFixture;
let keeper: string, alice: string, aliceM: string, bob: string, bobM: string, carol: string, carolM: string;

interface OutboxRow { id: number; membership_id: string; kind: string; ref: string; subject: string; body: string;
  tries: number; sent: boolean; error: string | null }

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
/** Superuser write: moves the close time without open_auction's checks. */
const setClose = (h: number) =>
  f.db.query(`update public.stages set bid_close_at = now() + $2 * interval '1 hour' where id = $1`, [f.stage, h]);
const queueBids = async () => (await f.db.query<{ n: number }>('select private.queue_bid_reminders() as n')).rows[0].n;
const outbox = async () => (await f.db.query<OutboxRow>(
  `select id::int as id, membership_id, kind, ref, subject, body, tries, sent_at is not null as sent, error
   from private.outbox order by id`)).rows;
const claim = async (limit = 50) => (await f.db.query<{ id: number; email: string; subject: string; body: string }>(
  'select id::int as id, email, subject, body from private.claim_outbox($1)', [limit])).rows;
const mark = (id: number, error: string | null) => f.db.query('select private.mark_outbox($1, $2)', [id, error]);
const optOut = (uid: string) => as(f.db, uid, (tx) => rpc(tx, 'set_notify_email', { p_on: false }));

const pairings = () => [
  { league_id: f.league, home: aliceM, away: bobM },
  { league_id: f.league, home: carolM, away: null },
];
const open = () => as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: pairings() })) as Promise<string>;
const start = (game: string) => as(f.db, keeper, (tx) => rpc(tx, 'start_game', { p_game: game }));
const finish = (game: string) =>
  as(f.db, keeper, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: pairings(), p_provisional: {} })) as Promise<string>;

beforeEach(async () => {
  f = await auctionFixture(16); // open_auction needs 3 members × roster 4 opted-in athletes
  keeper = await createUser(f.db, 'keeper@x.test');
  await makeKeeper(f.db, keeper);
  [alice, aliceM] = await member(f.db, 'alice');
  [bob, bobM] = await member(f.db, 'bob');
  [carol, carolM] = await member(f.db, 'carol');
});

describe('bid reminders', () => {
  it('queues nothing over 24 h out, bid_24h inside 24 h, and only bid_2h inside 2 h', async () => {
    await openAuction(f, hours(25));
    expect(await queueBids()).toBe(0);
    await setClose(23);
    expect(await queueBids()).toBe(3);
    expect((await outbox()).map((r) => r.kind)).toEqual(['bid_24h', 'bid_24h', 'bid_24h']);
    await setClose(1);
    expect(await queueBids()).toBe(3);
    const late = (await outbox()).slice(3);
    expect(late.map((r) => r.kind)).toEqual(['bid_2h', 'bid_2h', 'bid_2h']);
    expect(late[0].subject).toBe('Bidding for Fall beta closes within 2 hours');
  });

  it('never queues twice for the same close time, and queues again when the close moves', async () => {
    await openAuction(f, hours(23));
    expect(await queueBids()).toBe(3);
    expect(await queueBids()).toBe(0);
    await setClose(20);
    expect(await queueBids()).toBe(3);
    expect(new Set((await outbox()).map((r) => r.ref)).size).toBe(2);
  });

  it('says how many bids each team has placed, when bidding closes, and how to turn emails off', async () => {
    await grant(f);
    await openAuction(f, hours(23));
    await bid(f, alice, aliceM, f.athletes[0], 5);
    await bid(f, alice, aliceM, f.athletes[1], 5);
    await bid(f, bob, bobM, f.athletes[2], 5);
    await queueBids();
    const body = Object.fromEntries((await outbox()).map((r) => [r.membership_id, r.body]));
    expect(body[aliceM]).toMatch(/^alice: bidding for Fall beta closes \w{3} \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M ET\. You have placed 2 bids\./);
    expect(body[bobM]).toContain('You have placed 1 bid.');
    expect(body[carolM]).toContain("You haven't placed any bids yet.");
    expect(body[carolM]).toContain('Turn these emails off: https://nealthezeng.github.io/Tribe-Fantasy/#/me');
    expect((await outbox())[0].subject).toBe('Bidding for Fall beta closes within 24 hours');
  });

  it('queues nothing once bidding has closed or the auction has run', async () => {
    await grant(f);
    await openAuction(f, hours(1));
    await closeBids(f);
    expect(await queueBids()).toBe(0);
    await runAuction(f);
    await setClose(1); // a run auction never reminds, whatever its close time says
    expect(await queueBids()).toBe(0);
  });

  it('skips members who turned emails off; a member with no profile still gets them', async () => {
    await optOut(alice);
    await f.db.query('delete from public.profiles where id = $1', [carol]);
    await openAuction(f, hours(23));
    await queueBids();
    expect((await outbox()).map((r) => r.membership_id).sort()).toEqual([bobM, carolM].sort());
  });

  it('a manager in two leagues gets one reminder per team', async () => {
    await as(f.db, f.admin, async (tx) => {
      const b = (await rpc(tx, 'create_league', { p_season: f.season, p_name: 'League B' })) as string;
      await rpc(tx, 'create_invite', { p_league: b, p_code: 'LEAGUE2', p_max_uses: 50, p_expires_at: null });
    });
    const aliceB = (await as(f.db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'LEAGUE2', p_team_name: 'alice B' }))) as string;
    await openAuction(f, hours(23));
    await queueBids();
    const mine = (await outbox()).filter((r) => r.membership_id === aliceM || r.membership_id === aliceB);
    expect(mine.map((r) => r.body.split(':')[0]).sort()).toEqual(['alice', 'alice B']);
  });
});

describe('pick notices', () => {
  it('opening a tournament tells both sides of each pairing, not the team with a bye', async () => {
    const g1 = await open();
    const rows = await outbox();
    expect(rows.map((r) => [r.membership_id, r.kind, r.ref])).toEqual([[aliceM, 'pick_next', g1], [bobM, 'pick_next', g1]]);
    expect(rows[0].subject).toBe('Pick your player for game 1');
    expect(rows[0].body).toMatch(/^alice: game 1 of Fall beta is next\. You play bob\. Pick your player on the League page/);
    expect(rows[1].body).toContain('You play alice.');
  });

  it('finishing game N tells only the managers with no pick yet for game N+1', async () => {
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, 10, 'bid')`, [f.stage, aliceM, f.league, f.athletes[0]]);
    const g1 = await open();
    await start(g1);
    await as(f.db, alice, (tx) => rpc(tx, 'set_game_pick', { p_membership: aliceM, p_stage: f.stage, p_number: 2, p_athlete: f.athletes[0] }));
    const g2 = await finish(g1);
    expect((await outbox()).filter((r) => r.ref === g2).map((r) => r.membership_id)).toEqual([bobM]);
  });

  it('skips managers who turned emails off', async () => {
    await optOut(bob);
    await open();
    expect((await outbox()).map((r) => r.membership_id)).toEqual([aliceM]);
  });

  it('after an admin undoes a game and it is finished again, the new next game gets fresh notices', async () => {
    const g1 = await open();
    await start(g1);
    const first = await finish(g1);
    await as(f.db, f.admin, (tx) => rpc(tx, 'reset_game', { p_game: g1 }));
    await start(g1);
    const second = await finish(g1);
    expect(second).not.toBe(first);
    expect((await outbox()).filter((r) => r.ref === second)).toHaveLength(2);
  });
});

describe('claim_outbox and mark_outbox', () => {
  it('hands out each due email once, with the address, and takes it back after a 5-minute lease', async () => {
    await open();
    const got = await claim();
    expect(got.map((r) => r.email).sort()).toEqual(['alice@x.test', 'bob@x.test']);
    expect(await claim()).toEqual([]);
    await f.db.query(`update private.outbox set claimed_at = now() - interval '6 minutes'`);
    expect(await claim()).toHaveLength(2);
    expect((await outbox()).map((r) => r.tries)).toEqual([2, 2]);
  });

  it('respects the limit without handing a row out twice', async () => {
    await open();
    const a = await claim(1);
    const b = await claim(50);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].id).not.toBe(b[0].id);
  });

  it('a sent email is never claimed again; a failed one is retried, at most 3 tries in all', async () => {
    await open();
    const [x, y] = await claim();
    await mark(x.id, null);
    await mark(y.id, 'smtp down');
    const rows = await outbox();
    expect(rows.map((r) => [r.sent, r.error])).toEqual([[true, null], [false, 'smtp down']]);
    for (let i = 0; i < 3; i++) {
      await f.db.query(`update private.outbox set claimed_at = now() - interval '6 minutes'`);
      const again = await claim();
      expect(again.map((r) => r.id)).toEqual(i < 2 ? [y.id] : []);
    }
  });

  it('drops emails queued over 30 minutes ago', async () => {
    await open();
    await f.db.query(`update private.outbox set created_at = now() - interval '31 minutes'`);
    expect(await claim()).toEqual([]);
  });

  it('drops a bid reminder once its close time moved, or once the auction ran', async () => {
    await grant(f);
    await openAuction(f, hours(23));
    await queueBids();
    await setClose(20);
    expect(await claim()).toEqual([]);
    await queueBids();
    await closeBids(f);
    await runAuction(f);
    expect(await claim()).toEqual([]);
  });

  it('drops a pick notice once its game has started, or once the game was deleted', async () => {
    const g1 = await open();
    await start(g1);
    expect(await claim()).toEqual([]);
    const g2 = await finish(g1);
    await as(f.db, f.admin, (tx) => rpc(tx, 'reset_game', { p_game: g1 })); // deletes the unstarted g2, un-starts g1
    const due = await claim();
    const byId = new Map((await outbox()).map((r) => [r.id, r.ref]));
    expect(due.map((r) => byId.get(r.id))).toEqual([g1, g1]); // game 1 is unplayed again; game 2 is gone
    expect((await outbox()).some((r) => r.ref === g2)).toBe(true);
  });

  it('drops a pick notice when the manager picked after it was queued', async () => {
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, 10, 'bid')`, [f.stage, aliceM, f.league, f.athletes[0]]);
    await open();
    await as(f.db, alice, (tx) => rpc(tx, 'set_game_pick', { p_membership: aliceM, p_stage: f.stage, p_number: 1, p_athlete: f.athletes[0] }));
    expect((await claim()).map((r) => r.email)).toEqual(['bob@x.test']);
  });
});

describe('set_notify_email', () => {
  it('turns only the caller’s own emails on and off, with an audit row', async () => {
    await optOut(alice);
    const on = async (uid: string) =>
      (await f.db.query<{ v: boolean }>('select notify_email as v from public.profiles where id = $1', [uid])).rows[0].v;
    expect([await on(alice), await on(bob)]).toEqual([false, true]);
    await as(f.db, alice, (tx) => rpc(tx, 'set_notify_email', { p_on: true }));
    expect(await on(alice)).toBe(true);
    expect((await f.db.query(`select 1 from public.audit_log where action = 'set_notify_email' and actor = $1`, [alice])).rows)
      .toHaveLength(2);
  });

  it('refuses anonymous callers, null, and users with no profile', async () => {
    await expect(as(f.db, null, (tx) => rpc(tx, 'set_notify_email', { p_on: false }))).rejects.toThrow();
    await expect(as(f.db, alice, (tx) => rpc(tx, 'set_notify_email', { p_on: null }))).rejects.toThrow('INVALID_INPUT');
    const nameless = await createUser(f.db, 'nameless@x.test');
    await expect(as(f.db, nameless, (tx) => rpc(tx, 'set_notify_email', { p_on: false }))).rejects.toThrow('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Register the new RPC in the gate test.** In `tests/db/rpc-gate.test.ts`, apply:

```diff
--- a/tests/db/rpc-gate.test.ts
+++ b/tests/db/rpc-gate.test.ts
@@ -10,7 +10,7 @@ const READ_HELPERS = ['can_read_league_data', 'has_role', 'is_admin', 'is_keeper
 /** Any signed-in user may call these; they check ownership instead of a role. */
 const MEMBER_CALLABLE = [
   'clear_injury', 'delete_bid', 'join_league', 'place_bid', 'report_injury', 'set_attendance', 'set_display_name',
-  'set_bench', 'set_game_pick', 'swap_bench',
+  'set_bench', 'set_game_pick', 'set_notify_email', 'swap_bench',
 ];
 /** Keepers (and admins) may call these; every other staff RPC is admin-only. */
 const KEEPER_CALLABLE = [
@@ -57,6 +57,7 @@ describe('RPC gate', () => {
     const c: Record<string, string> = {};
     const steps: [string, string, () => Record<string, unknown>, ((r: unknown) => void)?][] = [
       ['set_display_name', player, () => ({ p_name: 'Pat' })],
+      ['set_notify_email', player, () => ({ p_on: false })],
       ['create_season', admin, () => ({ p_name: 'Gate', p_settings: {} }), (r) => (c.season = r as string)],
       ['update_season_settings', admin, () => ({ p_season: c.season, p_settings: { donations_enabled: true, roster_size: 1, allow_self_ownership: true } })],
       ['create_league', admin, () => ({ p_season: c.season, p_name: 'L' }), (r) => (c.league = r as string)],
```

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `npx vitest run tests/db/notify.test.ts tests/db/rpc-gate.test.ts`
Expected: FAIL. Errors like `relation "private.outbox" does not exist` and
`function public.set_notify_email(...) does not exist`.

- [ ] **Step 4: Write the migration.** Create `supabase/migrations/0016_notify.sql`:

```sql
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
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `npx vitest run tests/db/notify.test.ts tests/db/rpc-gate.test.ts tests/db/guards.test.ts src/app/lib/backup.test.ts`
Expected: all PASS (notify.test.ts: 19 tests).

- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/0016_notify.sql tests/db/notify.test.ts tests/db/rpc-gate.test.ts
git commit -m "0016: email outbox, bid reminders, next-game pick notices, set_notify_email (t200 t201)"
```

---

### Task 2: Edge Function `notify` and the go-live runbook

Model: haiku (transcription; the code is complete below).

**Files:**
- Create: `supabase/functions/notify/index.ts`
- Modify: `docs/setup-supabase.md` (append a section at the end)

**Interfaces:**
- Consumes (Task 1): `private.queue_bid_reminders()`, `private.claim_outbox(50)`, `private.mark_outbox(id, error)`.
- Produces: an HTTP endpoint `POST /functions/v1/notify` that needs the header `x-cron-secret` and returns JSON
  `{ queued, sent, failed }`.

There is no automated test: CI has no Deno, and tsc doesn't include `supabase/`. The function holds no logic of
its own; it is proven by the go-live smoke test (Wrap-up step 4).

- [ ] **Step 1: Create the function.** `supabase/functions/notify/index.ts`:

```ts
// M10 email sender (spec docs/superpowers/specs/2026-10-05-m10-notifications-design.md §5). Runs on Supabase Edge
// Functions (Deno), deployed by pasting this file into the dashboard with "Verify JWT" OFF; pg_cron calls it every
// minute (docs/setup-supabase.md). Every decision lives in SQL (0016_notify.sql): this only sends what it's handed.
// Secrets: CRON_SECRET, GMAIL_USER, GMAIL_APP_PASSWORD. SUPABASE_DB_URL is provided by Supabase.
import postgres from 'npm:postgres@3';
import nodemailer from 'npm:nodemailer@6';

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };

const env = (key: string) => {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`missing secret ${key}`);
  return v;
};

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return new Response('unauthorized', { status: 401 });
  const sql = postgres(env('SUPABASE_DB_URL'), { max: 1, prepare: false });
  // Port 465 (implicit TLS): Supabase blocks outbound 25 and 587.
  const mail = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: env('GMAIL_USER'), pass: env('GMAIL_APP_PASSWORD') },
  });
  let sent = 0, failed = 0;
  try {
    const [{ n: queued }] = await sql`select private.queue_bid_reminders() as n`;
    const rows = await sql`select id, email, subject, body from private.claim_outbox(50)`;
    for (const r of rows) {
      try {
        await mail.sendMail({ from: `Tribe Fantasy <${env('GMAIL_USER')}>`, to: r.email, subject: r.subject, text: r.body });
        await sql`select private.mark_outbox(${r.id}, null)`;
        sent++;
      } catch (e) {
        await sql`select private.mark_outbox(${r.id}, ${String(e)})`;
        failed++;
      }
    }
    return Response.json({ queued, sent, failed });
  } finally {
    mail.close();
    await sql.end();
  }
});
```

- [ ] **Step 2: Append the runbook to `docs/setup-supabase.md`.** Add at the end of the file:

````markdown
## M10 email notifications (after 0001–0015)

Bid reminders (24 h and 2 h before bidding closes) and next-game pick notices, sent from the Gmail account already
used for sign-in mail. SQL queues them; the Edge Function `notify` sends them; `pg_cron` runs it every minute.

1. SQL Editor: paste and run `supabase/migrations/0016_notify.sql`. It's additive and safe before the deploy: pick
   notices start queuing at once, but nothing is sent until step 4, and anything unsent for 30 minutes expires.
2. **Database → Extensions**: enable `pg_cron` and `pg_net`.
3. **Edge Functions → Deploy a new function → Via editor**, name it `notify`:
   - paste `supabase/functions/notify/index.ts`, and turn **Verify JWT** OFF (the function checks its own secret);
   - **Edge Functions → Secrets**: add `GMAIL_USER` (the Gmail address), `GMAIL_APP_PASSWORD` (the same app
     password as Auth → SMTP), and `CRON_SECRET` (any long random string; make one with
     `select md5(random()::text) || md5(random()::text);`).
4. SQL Editor, with your `CRON_SECRET` pasted in:
   ```sql
   select cron.schedule('notify', '* * * * *', $$
     select net.http_post(
       url := 'https://effyjptuoztyduydwcwh.supabase.co/functions/v1/notify',
       headers := '{"x-cron-secret": "PASTE-CRON-SECRET-HERE"}'::jsonb
     )
   $$);
   ```
5. Smoke test, in the SQL Editor (sends one email to every membership you own):
   ```sql
   insert into private.outbox (membership_id, kind, ref, subject, body)
   select m.id, 'test', now()::text, 'Tribe Fantasy test email', 'If you can read this, notifications work.'
   from public.memberships m join auth.users u on u.id = m.user_id where u.email = 'YOUR-EMAIL-HERE';
   ```
   Within a minute the email arrives. Check: `select kind, tries, sent_at, error from private.outbox order by id desc limit 5;`
   (`error` says what went wrong; the function's **Logs** tab shows each run's `{queued, sent, failed}`).
6. Deploy (merge + push): the Me page gets the Emails switch, the Rules page a line about emails.

Stop all email at any time: `select cron.unschedule('notify');`. Gmail allows about 500 emails a day.
````

- [ ] **Step 3: Check lint and typecheck still pass.** The function file is linted but not typechecked.

Run: `npx eslint . && npx tsc`
Expected: no output (exit 0).

- [ ] **Step 4: Commit.**

```bash
git add supabase/functions/notify/index.ts docs/setup-supabase.md
git commit -m "Edge Function notify (Gmail SMTP 465) + go-live runbook (t200 t201)"
```

---

### Task 3: Me-page Emails switch, menu line and Rules line

Model: haiku (code complete below); sonnet if the test is flaky.

**Files:**
- Create: `src/app/pages/EmailReminders.tsx`
- Create: `src/app/pages/EmailReminders.test.tsx`
- Modify: `src/app/lib/rpc.ts` (one api entry)
- Modify: `src/app/pages/MePage.tsx` (render the switch in both branches)
- Modify: `src/app/components/Layout.tsx` (Me menu subtitle)
- Modify: `src/app/pages/RulesPage.tsx` (one Questions entry)

**Interfaces:**
- Consumes (Task 1): RPC `set_notify_email(p_on boolean)` and the column `profiles.notify_email`.
- Produces: `export function EmailReminders({ uid }: { uid: string })` and `api.setNotifyEmail(on: boolean): Promise<void>`.

- [ ] **Step 1: Write the failing test.** Create `src/app/pages/EmailReminders.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailReminders } from './EmailReminders';
import { api } from '../lib/rpc';

const profile = vi.hoisted(() => ({ row: null as { notify_email: boolean } | null }));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: profile.row, error: null }),
      };
      return builder;
    },
  },
}));

vi.mock('../lib/rpc', () => ({
  api: { setNotifyEmail: vi.fn(async (on: boolean) => { profile.row = { notify_email: on }; }) },
}));

afterEach(cleanup);

const box = () => screen.getByRole('checkbox', { name: /email me before bidding closes/i }) as HTMLInputElement;

describe('EmailReminders', () => {
  it('shows emails on by default and turns them off', async () => {
    profile.row = { notify_email: true };
    render(<EmailReminders uid="u1" />);
    await waitFor(() => expect(box().disabled).toBe(false));
    expect(box().checked).toBe(true);
    fireEvent.click(box());
    await waitFor(() => expect(api.setNotifyEmail).toHaveBeenCalledWith(false));
    await waitFor(() => expect(box().checked).toBe(false));
  });

  it('shows the saved choice when a user turned emails off', async () => {
    profile.row = { notify_email: false };
    render(<EmailReminders uid="u1" />);
    await waitFor(() => expect(box().disabled).toBe(false));
    expect(box().checked).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npx vitest run src/app/pages/EmailReminders.test.tsx`
Expected: FAIL with `Failed to resolve import "./EmailReminders"`.

- [ ] **Step 3: Add the api entry.** In `src/app/lib/rpc.ts`:

```diff
--- a/src/app/lib/rpc.ts
+++ b/src/app/lib/rpc.ts
@@ -11,6 +11,7 @@ async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
 
 export const api = {
   setDisplayName: (name: string) => call<void>('set_display_name', { p_name: name }),
+  setNotifyEmail: (on: boolean) => call<void>('set_notify_email', { p_on: on }),
   joinLeague: (code: string, teamName: string) => call<string>('join_league', { p_code: code, p_team_name: teamName }),
   createSeason: (name: string, settings: object) => call<string>('create_season', { p_name: name, p_settings: settings }),
   updateSeasonSettings: (seasonId: string, settings: object) =>
```

- [ ] **Step 4: Create the component.** `src/app/pages/EmailReminders.tsx`:

```tsx
import { useState } from 'react';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';

/** Me page switch for the M10 emails (bid reminders, next-game pick notices). On unless the user turned it off. */
export function EmailReminders({ uid }: { uid: string }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const on = useLoad(async () => {
    const r = await supabase!.from('profiles').select('notify_email').eq('id', uid).maybeSingle();
    if (r.error) throw r.error;
    return (r.data as { notify_email: boolean } | null)?.notify_email ?? true;
  }, [uid]);

  async function toggle(next: boolean) {
    setError(null);
    setSaving(true);
    try {
      await api.setNotifyEmail(next);
      on.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>Emails</h2>
      {(error ?? on.error) && <p className="error" role="alert">{error ?? on.error}</p>}
      <label className="check">
        <input type="checkbox" checked={on.data ?? true} disabled={on.data === undefined || saving}
          onChange={(e) => void toggle(e.target.checked)} />
        Email me before bidding closes and when it's time to pick for the next game.
      </label>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `npx vitest run src/app/pages/EmailReminders.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Show the switch on the Me page, for linked players and unlinked managers alike.** In
  `src/app/pages/MePage.tsx`:

```diff
--- a/src/app/pages/MePage.tsx
+++ b/src/app/pages/MePage.tsx
@@ -2,6 +2,7 @@ import { useState } from 'react';
 import { Navigate } from 'react-router';
 import { useAuth } from '../auth/AuthProvider';
 import { errorMessage } from '../lib/errors';
+import { EmailReminders } from './EmailReminders';
 import { api } from '../lib/rpc';
 import { gameTitles, SESSION_COLUMNS, sessionState, titleOf, todayLocal, type SessionRow } from '../lib/stats';
 import { parseSettings } from '../../core/settings';
@@ -18,7 +19,7 @@ interface MeData {
   injury: { confirmed_at: string | null } | null;
 }
 
-/** A player's own page: attendance for the last week of games, and injury reports. */
+/** Your own page: email reminders for everyone; attendance and injury reports for linked players. */
 export function MePage() {
   const { session, loading } = useAuth();
   const uid = session?.user.id;
@@ -65,9 +66,12 @@ export function MePage() {
   if (data.data === undefined) return <p className="muted" role="status">Loading…</p>;
   if (data.data === null) {
     return (
-      <section className="card">
+      <section className="page">
         <h1>Me</h1>
-        <p>Your account isn't linked to a player yet. Ask an admin to link it.</p>
+        <EmailReminders uid={uid!} />
+        <div className="card">
+          <p>Your account isn't linked to a player yet. Ask an admin to link it.</p>
+        </div>
       </section>
     );
   }
@@ -76,6 +80,7 @@ export function MePage() {
     <section className="page">
       <h1>{athlete.name}</h1>
       {error && <p className="error" role="alert">{error}</p>}
+      <EmailReminders uid={uid!} />
       <div className="card">
         <div className="head">
           <h2>Injury</h2>
```

- [ ] **Step 7: Update the menu line and add the Rules entry.** In `src/app/components/Layout.tsx` and
  `src/app/pages/RulesPage.tsx`:

```diff
--- a/src/app/components/Layout.tsx
+++ b/src/app/components/Layout.tsx
@@ -43,7 +43,7 @@ function AccountMenu({ name, email, isAdmin }: { name: string | null; email: str
           <strong>{name || 'No name yet'}</strong>
           <small>{email}</small>
         </p>
-        <NavLink to="/me" onClick={close}>Me<small>Attendance and injuries</small></NavLink>
+        <NavLink to="/me" onClick={close}>Me<small>Emails, attendance, injuries</small></NavLink>
         <NavLink to="/rules" onClick={close}>Rules<small>How scoring works</small></NavLink>
         {isAdmin && <NavLink to="/admin" onClick={close}>Admin<small>Seasons, leagues, athletes</small></NavLink>}
         <button type="button" onClick={flipTheme}>{theme === 'light' ? 'Dark mode' : 'Light mode'}</button>
--- a/src/app/pages/RulesPage.tsx
+++ b/src/app/pages/RulesPage.tsx
@@ -167,6 +167,9 @@ export function RulesPage() {
             see your credit balance. Other teams can't see your pick until the game starts.</p>
           <h3>I'm a player. Can I opt out?</h3>
           <p>Yes. Tell a captain before the next auction opens. Players who opt out aren't listed or bid on in the next auction.</p>
+          <h3>Will I get emails?</h3>
+          <p>Yes: 24 hours and 2 hours before bidding closes, and when it's time to pick your player for the next
+            game. Turn them off on the Me page.</p>
           <h3>What if a stat is wrong?</h3>
           <p>Tell a stat keeper. A game's stats can be reopened for {S.stat_lock_hours} hours after they're verified, and an admin can correct them after
             that. Scores update by themselves.</p>
```

- [ ] **Step 8: Run the app tests, typecheck, lint and build.**

Run: `npx vitest run src && npx tsc && npx eslint . && npm run build`
Expected: all pass. RulesPage.test.tsx stays green: it checks numbers, not this copy.

- [ ] **Step 9: Commit.**

```bash
git add src/app/pages/EmailReminders.tsx src/app/pages/EmailReminders.test.tsx src/app/lib/rpc.ts src/app/pages/MePage.tsx src/app/components/Layout.tsx src/app/pages/RulesPage.tsx
git commit -m "Me page Emails switch, menu line, Rules entry (t200 t201)"
```

---

### Controller wrap-up (not a subagent task)

- [ ] **Step 1: Full check, branch vs draft.**
  - Run: `npx vitest run && npx tsc && npx eslint . && npm run build`. Expected: all green (≈419 tests).
  - Then `git diff m10-notify-verified-draft -- supabase src tests`. Expected: empty, or only differences you
    can justify.
- [ ] **Step 2: Final review.** One opus reviewer on `origin/main..HEAD`, with the spec. Focus: the Review Focus list,
  outbox races, and private-schema exposure. Fix any findings, then re-run Step 1.
- [ ] **Step 3: Rebase on `main` if it moved** (t125's 0015, M9 edits to MePage/RulesPage/setup-supabase.md).
  Re-run Step 1 with 0015 present.
- [ ] **Step 4: Go-live, user-side, in this order** (`docs/setup-supabase.md` "M10 email notifications"):
  1. Paste 0016.
  2. Enable `pg_cron` + `pg_net`.
  3. Deploy `notify` with Verify JWT off, plus the 3 secrets.
  4. Run `cron.schedule`.
  5. Smoke-test email to the user's own address.
  6. Check the Me switch in the preview (port 5173 may belong to the other session's server; navigate to it).
- [ ] **Step 5: Ship, only with the user's explicit OK.**
  - The other session owns the `main` checkout, so don't merge there. From the worktree, after Step 3's rebase:
    `git push origin m10-notify:main` (a fast-forward), then `git tag m10-notify && git push origin m10-notify`.
  - Wait for CI + Deploy green.
  - Board t200 + t201 → done.
  - `graphify update .`
  - Delete the branch `m10-notify-verified-draft` and remove the worktree.

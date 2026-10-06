# Admin Powers and Opponent Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Invoke `ponytail:ponytail` before writing code.

**Goal:** Admins can tally and verify every game, delete a tournament (keeping credits), undo the latest played game; keepers can name each game after the real opponent.

**Architecture:** One additive migration `0014_admin_powers.sql` changes two gates (`private.owns_athlete` returns false for admins; `verify_session` skips `VERIFIER_TAPPED` for admins), re-points the credit-ledger stage FK to `set null`, adds `games.opponent` and three RPCs (`delete_stage`, `reset_game`, `set_game_opponent`). The app adds a `gameLabel` helper, an Opponent field on the tally page's tournament card, two admin buttons on the Tournaments tab, and two one-line admin exemptions in the tally and verify UI.

**Tech Stack:** Supabase Postgres (security-definer RPCs, RLS), PGlite DB tests (vitest), Vite + React 19 + TypeScript, react-router 8 hash routing.

**Spec:** `docs/superpowers/specs/2026-10-03-admin-powers-design.md` (read its Amendments section too).

**Verified draft:** branch `admin-powers-verified-draft` (a719287) holds the complete, green implementation (386 tests at e8b3efa + 1 bench test; tsc, lint, build green). Executors may copy a task's files with `git checkout admin-powers-verified-draft -- <file>` instead of retyping, then run the task's tests. The code below is that draft.

**Branch:** `admin-powers`, cut from `m9-fixes` (light mode, name at sign-in, standings on verify: unmerged when this plan was written). Merging `admin-powers` ships `m9-fixes` too.

## Global Constraints

- Env: node is not on the Bash PATH: `export PATH="/c/Program Files/nodejs:$PATH"` before `npx`/`npm`.
- Every DB write goes through a `security definer` RPC with `set search_path = ''`, whose FIRST statement is the role check (`private.require_admin()` / `private.require_keeper()`), so the pg_proc gate test (`tests/db/rpc-gate.test.ts`) sees `FORBIDDEN` for a role-less caller passing all nulls.
- Every state-changing RPC writes `private.audit(action, entity, id, details)`.
- Every new public RPC needs an audit step in `rpc-gate.test.ts`, and keeper-callable ones go in its `KEEPER_CALLABLE` list.
- Grants: end the migration with the do-loop that revokes `public, anon` and grants `authenticated` on every `public` function (as 0012/0013).
- New error codes need a plain-language entry in `src/app/lib/errors.ts`.
- `styles.css` takes no literal colours/sizes (`tokens.test.ts`); this plan adds no CSS.
- Player-facing word is "game", never "session"; stages are "tournaments" in all copy.
- Opponent names: 1–40 characters after trimming; blank clears.
- DB tests are calendar-proof: no dates that rot (use `now()`-relative or fixed far-future fixtures).
- Run DB tests alone (`npx vitest run tests/db`) if they time out next to a dev server.

## Review Focus

- **Deleting the tournament that is live or bidding right now:** League and Tally must not crash; `loadCurrentGame` returns null and the cards fall back. (Reviewer: open the League card code paths after a stage vanishes; the DB side is pinned by Task 1's delete test, which deletes a stage with a live auction bid and finished game.)
- **Undo while a keeper's phone still holds unsaved taps for that game:** their batch gets `NOT_FOUND` on save and is dropped with the existing rejected-taps notice (same as force-delete, parked M8.6). Acceptable; reviewer confirms the notice path, no new code.
- **Undo picks the newest STARTED game, never the unstarted one its Finish created:** pinned by Task 2's StagesPanel test (games 1–2 started, 3 unstarted → "Undo game 2").
- **Undoing game 1 must reopen bench choices** (the tournament is "not started" again): pinned in Task 1 (`set_bench` refused while live, allowed after the undo).
- **Opponent text edge cases** (spaces only, 41 characters, emoji): trimming and the 40 limit are pinned in Task 1; the input's `maxLength={40}` counts UTF-16 units, stricter than Postgres `length`, so the client can't send what the server refuses.

---

### Task 1: Migration 0014 and its DB tests

**Files:**
- Create: `supabase/migrations/0014_admin_powers.sql`
- Create: `tests/db/rpc-admin-powers.test.ts`
- Modify: `tests/db/owner-gates.test.ts` (replace the test `correct_stat_line refuses an admin who owns the athlete`)
- Modify: `tests/db/rpc-gate.test.ts` (KEEPER_CALLABLE + 3 audit steps)

**Interfaces:**
- Produces (SQL): `public.delete_stage(p_stage uuid) → void` (admin; `NOT_FOUND`), `public.reset_game(p_game uuid) → void` (admin; `NOT_FOUND`, `GAME_NOT_STARTED`, `NOT_LATEST_GAME`), `public.set_game_opponent(p_game uuid, p_name text) → void` (keeper/admin; `NOT_FOUND`, `INVALID_NAME`), column `games.opponent text null`.
- Produces (behaviour): admins never hit `OWNS_ATHLETE`; admins skip `VERIFIER_TAPPED`; `credit_ledger.stage_id` is `on delete set null`.

- [ ] **Step 1: Write the failing DB tests.** Create `tests/db/rpc-admin-powers.test.ts`:

```ts
// Admin powers (spec 2026-10-03-admin-powers-design.md §2–§4): delete a tournament keeping its credits, undo the
// newest played game, name games after the opponent.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, bid, grant, member, openAuction, type AuctionFixture } from './auction-fixture';
import { makeKeeper, tap } from './stats-fixture';

let f: AuctionFixture;
let keeper: string, alice: string, aliceM: string, bobM: string;

const pairings = () => [{ league_id: f.league, home: aliceM, away: bobM }];
const open = () => as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: pairings() })) as Promise<string>;
const start = (game: string) => as(f.db, keeper, (tx) => rpc(tx, 'start_game', { p_game: game })) as Promise<string>;
const finish = (game: string) =>
  as(f.db, keeper, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: pairings(), p_provisional: {} })) as Promise<string>;
const reset = (game: string, who = f.admin) => as(f.db, who, (tx) => rpc(tx, 'reset_game', { p_game: game }));
const name = (game: string, n: string | null, who = keeper) =>
  as(f.db, who, (tx) => rpc(tx, 'set_game_opponent', { p_game: game, p_name: n }));
const count = async (sql: string, args: unknown[] = []) =>
  (await f.db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, args)).rows[0].n;
const balance = async (mid: string) =>
  (await f.db.query<{ b: number }>('select coalesce(sum(amount), 0)::int as b from public.credit_ledger where membership_id = $1', [mid])).rows[0].b;
const gameRow = async (id: string) => (await f.db.query<{ number: number; session_id: string | null; started: boolean; finished: boolean; opponent: string | null }>(
  `select number, session_id, started_at is not null as started, finished_at is not null as finished, opponent
   from public.games where id = $1`, [id])).rows[0];
const audit = async (action: string) => (await f.db.query<{ details: Record<string, unknown> }>(
  'select details from public.audit_log where action = $1', [action])).rows;

beforeEach(async () => {
  f = await auctionFixture(8);
  keeper = await createUser(f.db, 'keeper@x.test');
  await makeKeeper(f.db, keeper);
  [alice, aliceM] = await member(f.db, 'alice');
  [, bobM] = await member(f.db, 'bob');
  for (const [mid, a] of [[aliceM, 0], [aliceM, 1], [bobM, 2], [bobM, 3]] as const) {
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, 10, 'bid')`, [f.stage, mid, f.league, f.athletes[a]]);
  }
});

describe('delete_stage', () => {
  it('deletes the tournament, its games, stats sessions, rosters and bids, but keeps every credit (t121)', async () => {
    await grant(f);
    await openAuction(f);
    await bid(f, alice, aliceM, f.athletes[4], 5);
    const g1 = await open();
    const sid = await start(g1);
    await as(f.db, keeper, (tx) => rpc(tx, 'save_taps', {
      p_session: sid, p_client_now: new Date().toISOString(), p_taps: [tap(f.athletes[0], 'goal', new Date().toISOString())] }));
    await finish(g1);
    const before = [await balance(aliceM), await balance(bobM)];
    const ledger = await count('public.credit_ledger');
    expect(ledger).toBeGreaterThan(0);

    await as(f.db, f.admin, (tx) => rpc(tx, 'delete_stage', { p_stage: f.stage }));

    expect(await count('public.stages where id = $1', [f.stage])).toBe(0);
    expect(await count('public.games')).toBe(0);
    expect(await count('public.game_pairings')).toBe(0);
    expect(await count('public.sessions where id = $1', [sid])).toBe(0);
    expect(await count('public.stat_taps')).toBe(0);
    expect(await count('public.roster_slots')).toBe(0);
    expect(await count('public.bids')).toBe(0);
    expect(await count('public.credit_ledger')).toBe(ledger);
    expect(await count('public.credit_ledger where stage_id is not null')).toBe(0);
    expect([await balance(aliceM), await balance(bobM)]).toEqual(before);
    expect((await audit('delete_stage'))[0].details).toMatchObject({ name: 'Fall beta', games: 2, sessions: 1, slots: 4, bids: 1 });
  });

  it('is admin-only and needs a real tournament', async () => {
    await expect(as(f.db, keeper, (tx) => rpc(tx, 'delete_stage', { p_stage: f.stage }))).rejects.toThrow('FORBIDDEN');
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'delete_stage', { p_stage: crypto.randomUUID() }))).rejects.toThrow('NOT_FOUND');
  });
});

describe('reset_game', () => {
  it('undoes the newest started game: its stats and the next game go, and it can be played again (t121)', async () => {
    const g1 = await open();
    const sid = await start(g1);
    await as(f.db, keeper, (tx) => rpc(tx, 'save_taps', {
      p_session: sid, p_client_now: new Date().toISOString(), p_taps: [tap(f.athletes[0], 'goal', new Date().toISOString())] }));
    const g2 = await finish(g1);

    await reset(g1);

    expect(await gameRow(g1)).toMatchObject({ number: 1, session_id: null, started: false, finished: false });
    expect(await gameRow(g2)).toBeUndefined();
    expect(await count('public.sessions where id = $1', [sid])).toBe(0);
    expect(await count('public.game_pairings where game_id = $1', [g1])).toBe(1); // pairings kept
    expect((await audit('reset_game'))[0].details).toMatchObject({ number: 1, taps: 1, lines: 0, verified: false, next_game_deleted: true });
    await start(g1); // playable again
  });

  it('resets a live game that has no next game yet; undoing game 1 reopens bench choices', async () => {
    const g1 = await open();
    await start(g1);
    const setBench = () => as(f.db, alice, (tx) => rpc(tx, 'set_bench', { p_membership: aliceM, p_stage: f.stage, p_athletes: `{${f.athletes[0]}}` }));
    await expect(setBench()).rejects.toThrow('TOURNAMENT_STARTED');
    await reset(g1);
    expect(await gameRow(g1)).toMatchObject({ started: false });
    expect((await audit('reset_game'))[0].details).toMatchObject({ next_game_deleted: false });
    await setBench();
  });

  it('refuses an unstarted game, an older game, a non-admin and a missing game', async () => {
    const g1 = await open();
    await expect(reset(g1)).rejects.toThrow('GAME_NOT_STARTED');
    await start(g1);
    const g2 = await finish(g1);
    await start(g2);
    await expect(reset(g1)).rejects.toThrow('NOT_LATEST_GAME');
    await expect(reset(g2, keeper)).rejects.toThrow('FORBIDDEN');
    await expect(reset(crypto.randomUUID())).rejects.toThrow('NOT_FOUND');
    await reset(g2);
    await reset(g1); // newest first, one at a time
    expect(await gameRow(g1)).toMatchObject({ started: false });
  });
});

describe('set_game_opponent', () => {
  it('lets a keeper name a game any time; blank clears it (t123)', async () => {
    const g1 = await open();
    await name(g1, '  Duke ');
    expect((await gameRow(g1)).opponent).toBe('Duke');
    await start(g1);
    await name(g1, 'UNC', f.admin);
    expect((await gameRow(g1)).opponent).toBe('UNC');
    await name(g1, '   ');
    expect((await gameRow(g1)).opponent).toBeNull();
    expect((await audit('set_game_opponent')).map((r) => r.details.opponent)).toEqual(['Duke', 'UNC', null]);
  });

  it('refuses players, names over 40 characters and missing games', async () => {
    const g1 = await open();
    await expect(name(g1, 'Duke', alice)).rejects.toThrow('FORBIDDEN');
    await expect(name(g1, 'x'.repeat(41))).rejects.toThrow('INVALID_NAME');
    await expect(name(crypto.randomUUID(), 'Duke')).rejects.toThrow('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Flip the admin owner-gate test.** In `tests/db/owner-gates.test.ts`, replace the whole `it('correct_stat_line refuses an admin who owns the athlete', …)` block with:

```ts
  it('an admin is never an owner: tallies, verifies their own tally, reopens and corrects their own athlete (t120)', async () => {
    await own(f.admin, f.sam);
    await save(f.admin, f.sam);
    await verify(f.admin, f.sam); // no OWNS_ATHLETE, no VERIFIER_TAPPED
    await as(f.db, f.admin, (tx) => rpc(tx, 'reopen_session', { p_session: f.session }));
    await verify(f.admin, f.sam);
    await backdateVerify(f.db, f.session, 49);
    await as(f.db, f.admin, (tx) => rpc(tx, 'correct_stat_line', { p_session: f.session, p_athlete: f.sam, p_stats: { goal: 2 } }));
    const iid = (await as(f.db, f.admin, (tx) => rpc(tx, 'report_injury', { p_athlete: f.sam }))) as string;
    const row = await f.db.query<{ confirmed_at: string | null }>(`select confirmed_at from public.injuries where id = $1`, [iid]);
    expect(row.rows[0].confirmed_at).not.toBeNull(); // auto-confirmed, as for any non-owner keeper
  });

  it('a keeper who tallied still cannot verify (VERIFIER_TAPPED is lifted for admins only)', async () => {
    await save(f.k1, f.sam);
    await expect(verify(f.k1, f.sam)).rejects.toThrow('VERIFIER_TAPPED');
  });
```

The other owner-gate tests (keepers k1/k2 owning athletes) stay unchanged: they prove keepers keep the gate.

- [ ] **Step 3: Register the new RPCs in the gate test.** In `tests/db/rpc-gate.test.ts`, set `KEEPER_CALLABLE` to:

```ts
const KEEPER_CALLABLE = [
  'confirm_injury', 'create_session', 'delete_session', 'finish_game', 'reopen_session', 'save_taps', 'set_game_opponent',
  'start_game', 'verify_session',
];
```

and append three steps after the `finish_game` step (order matters: reset needs the started game, delete comes last):

```ts
      ['set_game_opponent', keeper, () => ({ p_game: c.game, p_name: 'Duke' })],
      ['reset_game', admin, () => ({ p_game: c.game })],
      ['delete_stage', admin, () => ({ p_stage: c.stage })],
```

- [ ] **Step 4: Run them to see them fail.**

Run: `npx vitest run tests/db/rpc-admin-powers.test.ts tests/db/owner-gates.test.ts tests/db/rpc-gate.test.ts`
Expected: FAIL: `function public.delete_stage(...) does not exist` / `reset_game` / `set_game_opponent`, and the admin owner test fails with `OWNS_ATHLETE`.

- [ ] **Step 5: Write the migration.** Create `supabase/migrations/0014_admin_powers.sql`:

```sql
-- Admin powers and opponent names. Spec: docs/superpowers/specs/2026-10-03-admin-powers-design.md
-- Additive or more permissive for admins only, so it is safe to paste before the new build deploys.

-- §1 Admins tally and verify everything: an admin never "owns" an athlete for the owner gates (taps, verify,
-- reopen, corrections, keeper attendance, injury auto-confirm). Checked by p_user, not auth.uid().
create or replace function private.owns_athlete(p_user uuid, p_athlete uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.user_roles where user_id = p_user and role = 'admin')
    and exists (
      select 1 from public.roster_slots r
      join public.memberships m on m.id = r.membership_id
      join public.stages s on s.id = r.stage_id
      where m.user_id = p_user and r.athlete_id = p_athlete and s.auction_run_at is not null
        and (s.ends_on >= current_date - 7 or s.id = (
          select s2.id from public.stages s2 join public.athletes a on a.season_id = s2.season_id
          where a.id = p_athlete and s2.auction_run_at is not null
          order by s2.starts_on desc limit 1)))
$$;

-- 0005's verify_session, except an admin may verify a session they tallied (VERIFIER_TAPPED is for keepers).
create or replace function public.verify_session(p_session uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_keeper(); s public.sessions; l jsonb; v_athlete uuid; bad boolean;
begin
  select * into s from public.sessions where id = p_session for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if s.verified_at is not null then raise exception 'SESSION_VERIFIED'; end if;
  if not public.is_admin() and exists (select 1 from public.stat_taps where session_id = p_session and keeper_id = uid) then
    raise exception 'VERIFIER_TAPPED';
  end if;
  if exists (select 1 from public.stat_taps where session_id = p_session and private.owns_athlete(uid, athlete_id)) then
    raise exception 'OWNS_ATHLETE';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'INVALID_LINES'; end if;

  for l in select value from jsonb_array_elements(p_lines) loop
    begin
      v_athlete := (l ->> 'athlete_id')::uuid;
    exception when invalid_text_representation then raise exception 'INVALID_LINES';
    end;
    if v_athlete is null then raise exception 'INVALID_LINES'; end if;
    if not exists (select 1 from public.athletes where id = v_athlete and season_id = s.season_id) then
      raise exception 'NOT_FOUND';
    end if;
    perform private.check_stats(s.season_id, l -> 'stats');
    begin
      insert into public.stat_lines (session_id, athlete_id, stats) values (p_session, v_athlete, l -> 'stats');
    exception when unique_violation then raise exception 'INVALID_LINES';
    end;
  end loop;

  with live as (
    select t.athlete_id, t.stat, t.keeper_id from public.stat_taps t
    where t.session_id = p_session and t.undoes is null
      and not exists (select 1 from public.stat_taps u where u.undoes = t.id)
  ), per_keeper as (
    select athlete_id, stat, keeper_id, count(*)::int as n from live group by 1, 2, 3
  ), bounds as (
    select athlete_id, stat, max(n) as lo, sum(n)::int as hi from per_keeper group by 1, 2
  ), claimed as (
    select sl.athlete_id, kv.key as stat, kv.value::text::int as c
    from public.stat_lines sl, jsonb_each(sl.stats) kv where sl.session_id = p_session
  )
  select exists (
    select 1 from bounds b full join claimed c on c.athlete_id = b.athlete_id and c.stat = b.stat
    where coalesce(c.c, 0) < coalesce(b.lo, 0) or coalesce(c.c, 0) > coalesce(b.hi, 0)
  ) into bad;
  if bad then raise exception 'LINES_MISMATCH'; end if;

  update public.sessions set verified_by = uid, verified_at = now() where id = p_session;
  perform private.audit('verify_session', 'session', p_session::text, jsonb_build_object('lines', p_lines));
end $$;

-- §2 Deleting a tournament keeps its credits: allowance, refund and adjustment rows lose their stage link instead.
alter table public.credit_ledger drop constraint credit_ledger_stage_id_fkey;
alter table public.credit_ledger add constraint credit_ledger_stage_id_fkey
  foreign key (stage_id) references public.stages (id) on delete set null;

-- Admin: a tournament and everything played in it (games and their stats sessions, picks, bench swaps, bids,
-- rosters). Ledger rows stay, so no balance moves.
create function public.delete_stage(p_stage uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare st public.stages; sids uuid[]; counts jsonb;
begin
  perform private.require_admin();
  select * into st from public.stages where id = p_stage for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(array_agg(session_id), '{}') into sids from public.games where stage_id = p_stage and session_id is not null;
  counts := jsonb_build_object(
    'games', (select count(*) from public.games where stage_id = p_stage),
    'sessions', cardinality(sids),
    'slots', (select count(*) from public.roster_slots where stage_id = p_stage),
    'bids', (select count(*) from public.bids where stage_id = p_stage),
    'ledger_rows_kept', (select count(*) from public.credit_ledger where stage_id = p_stage));
  delete from public.stages where id = p_stage;
  delete from public.sessions where id = any (sids);
  perform private.audit('delete_stage', 'stage', p_stage::text,
    jsonb_build_object('season_id', st.season_id, 'name', st.name) || counts);
end $$;

-- §3 Admin "delete game" = undo the newest started game of its tournament: its stats session and the unstarted
-- next game its Finish created go; the game is not started again, keeping its number, pairings and picks.
create function public.reset_game(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.games; s public.sessions; next_deleted boolean; taps int; lines int;
begin
  perform private.require_admin();
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.started_at is null then raise exception 'GAME_NOT_STARTED'; end if;
  if exists (select 1 from public.games where stage_id = g.stage_id and number > g.number and started_at is not null) then
    raise exception 'NOT_LATEST_GAME';
  end if;
  select * into s from public.sessions where id = g.session_id;
  select count(*) into taps from public.stat_taps where session_id = g.session_id;
  select count(*) into lines from public.stat_lines where session_id = g.session_id;
  delete from public.games where stage_id = g.stage_id and number = g.number + 1;
  next_deleted := found;
  update public.games set started_at = null, finished_at = null, session_id = null where id = p_game;
  delete from public.sessions where id = g.session_id;
  perform private.audit('reset_game', 'game', p_game::text, jsonb_build_object(
    'stage_id', g.stage_id, 'number', g.number, 'session_id', g.session_id, 'verified', s.verified_at is not null,
    'taps', taps, 'lines', lines, 'next_game_deleted', next_deleted));
end $$;

-- §4 Opponent names: "vs Duke" instead of "Game 3". Keepers and admins, any time; blank clears it.
alter table public.games add column opponent text check (length(opponent) between 1 and 40);

create function public.set_game_opponent(p_game uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_name, '')), '');
begin
  perform private.require_keeper();
  if not exists (select 1 from public.games where id = p_game) then raise exception 'NOT_FOUND'; end if;
  if length(v) > 40 then raise exception 'INVALID_NAME'; end if;
  update public.games set opponent = v where id = p_game;
  perform private.audit('set_game_opponent', 'game', p_game::text, jsonb_build_object('opponent', v));
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

Notes for the implementer: `credit_ledger`'s stage FK was declared inline in 0006, so Postgres named it `credit_ledger_stage_id_fkey`. The one-allowance-per-stage unique index ignores null stage ids, so orphaned allowances can't clash. `private.*` grants survive `create or replace`.

- [ ] **Step 6: Run the DB tests to see them pass.**

Run: `npx vitest run tests/db/rpc-admin-powers.test.ts tests/db/owner-gates.test.ts tests/db/rpc-gate.test.ts`
Expected: PASS (7 + owner-gates + 3 gate tests).

- [ ] **Step 7: Run the whole DB suite** (the owns_athlete change touches every owner gate).

Run: `npx vitest run tests/db`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit.**

```bash
git add supabase/migrations/0014_admin_powers.sql tests/db/rpc-admin-powers.test.ts tests/db/owner-gates.test.ts tests/db/rpc-gate.test.ts
git commit -m "0014: admins tally/verify all, delete tournaments, undo games, opponent names (t120 t121 t123)"
```

---

### Task 2: Admin controls in the app (tally, verify, Tournaments tab)

**Files:**
- Modify: `src/app/lib/rpc.ts` (3 wrappers), `src/app/lib/errors.ts` (2 codes)
- Modify: `src/app/pages/TallyPage.tsx` (`TallyBoard`), `src/app/pages/SessionPage.tsx`
- Modify: `src/app/pages/admin/StagesPanel.tsx`, Test: `src/app/pages/admin/StagesPanel.test.tsx`

**Interfaces:**
- Consumes: Task 1's RPCs.
- Produces: `api.setGameOpponent(gameId: string, name: string): Promise<void>`, `api.resetGame(gameId: string): Promise<void>`, `api.deleteStage(stageId: string): Promise<void>` (Task 3 uses `setGameOpponent`).

- [ ] **Step 1: Write the failing StagesPanel tests.** Replace `src/app/pages/admin/StagesPanel.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/rpc';
import { StagesPanel } from './StagesPanel';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({ stages: [] as Row[], games: [] as Row[] }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = () => (db as Record<string, Row[]>)[table] ?? [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows(), error: null }),
      };
      return builder;
    },
  },
}));

vi.mock('../../lib/rpc', () => ({ api: { resetGame: vi.fn(), deleteStage: vi.fn() } }));

afterEach(() => {
  cleanup();
  db.games = [];
});
const stage = (id: string, starts_on: string, bid_close_at: string) => (
  { id, name: id, starts_on, ends_on: '2027-12-31', tournament: null, bid_close_at, auction_run_at: bid_close_at }
);

describe('StagesPanel', () => {
  it('offers Open tournament only on the current stage', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z'), stage('Spring', '2027-02-01', '2027-02-10T00:00:00Z')];
    render(<StagesPanel seasonId="se1" />);
    const buttons = await screen.findAllByRole('button', { name: 'Open tournament' });
    expect(buttons).toHaveLength(1);
    expect(within(buttons[0].closest('li')!).getByText('Spring')).toBeTruthy();
  });

  it('undoes the newest started game, not the unstarted one its finish created (t121)', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    const game = (id: string, number: number, started_at: string | null) =>
      ({ id, stage_id: 'Fall', number, session_id: null, started_at, finished_at: null, opponent: null });
    db.games = [game('g1', 1, '2026-11-07T14:00:00Z'), game('g2', 2, '2026-11-07T16:00:00Z'), game('g3', 3, null)];
    window.confirm = () => true;
    render(<StagesPanel seasonId="se1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Undo game 2', hidden: true }));
    await waitFor(() => expect(api.resetGame).toHaveBeenCalledWith('g2'));
  });

  it('deletes a tournament from its Edit form after a confirm (t121)', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    window.confirm = () => true;
    render(<StagesPanel seasonId="se1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete tournament' }));
    await waitFor(() => expect(api.deleteStage).toHaveBeenCalledWith('Fall'));
  });
});
```

- [ ] **Step 2: Run to see them fail.**

Run: `npx vitest run src/app/pages/admin/StagesPanel.test.tsx`
Expected: FAIL: no button "Undo game 2" / "Delete tournament".

- [ ] **Step 3: Add the RPC wrappers.** In `src/app/lib/rpc.ts`, right after the `finishGame` entry:

```ts
  setGameOpponent: (gameId: string, name: string) => call<void>('set_game_opponent', { p_game: gameId, p_name: name }),
  resetGame: (gameId: string) => call<void>('reset_game', { p_game: gameId }),
  deleteStage: (stageId: string) => call<void>('delete_stage', { p_stage: stageId }),
```

- [ ] **Step 4: Add the error messages.** In `src/app/lib/errors.ts`, after `PREVIOUS_GAME_LIVE`:

```ts
  GAME_NOT_STARTED: "This game hasn't started, so there's nothing to undo.",
  NOT_LATEST_GAME: 'Undo the newest game first: only the latest played game can be undone.',
```

- [ ] **Step 5: Delete tournament in the Edit form.** In `src/app/pages/admin/StagesPanel.tsx`, after the Cancel button inside the edit `<form>`:

```tsx
          {form.id && <button type="button" className="secondary" onClick={() => {
            const id = form.id!;
            if (!window.confirm(`Delete ${form.name}? Its games and their stats, rosters and bids are deleted for good. `
              + 'Credits given or refunded for it stay. Take a backup first if you might want it back.')) return;
            void run(async () => {
              await api.deleteStage(id);
              setForm(EMPTY);
              return `${form.name} deleted.`;
            });
          }}>Delete tournament</button>}
```

- [ ] **Step 6: Undo game in the Tournament section.** In `TournamentControls`, after `const last = games.data[games.data.length - 1];`:

```tsx
  // Undo = reset the newest started game (spec §3): its stats and the next game it created go; it can be replayed.
  const played = games.data.filter((g) => g.started_at !== null).at(-1);
  const undo = (g: GameRow) => {
    if (!window.confirm(`Undo game ${g.number} of ${stage.name}? Its stats are deleted, the game after it is unpaired, `
      + `and game ${g.number} can be started again.`)) return;
    void run(async () => {
      await api.resetGame(g.id);
      games.reload();
      return `${stage.name}: game ${g.number} undone. Keepers can start it again on the Tally tab.`;
    });
  };
```

and replace `<button className="secondary" onClick={check}>Check pairings</button>` with:

```tsx
        <div className="row">
          <button className="secondary" onClick={check}>Check pairings</button>
          {played && <button className="secondary" onClick={() => undo(played)}>Undo game {played.number}</button>}
        </div>
```

(`games.data` is ordered by number, so `.at(-1)` of the started ones is the newest started game.)

- [ ] **Step 7: Admins tally their own players.** In `src/app/pages/TallyPage.tsx`, `TallyBoard`: add `const { isAdmin } = useAuth();` as its first line; replace the `loadOwnedAthletes(...)` element of the `Promise.all` with:

```ts
      // The server refuses a keeper's taps on their own players (OWNS_ATHLETE); admins may tally anyone (t120).
      isAdmin ? new Set<string>() : loadOwnedAthletes(keeperId, seasonId).catch(() => new Set<string>()),
```

and change that `useLoad`'s deps from `[sessionId, keeperId]` to `[sessionId, keeperId, isAdmin]`.

- [ ] **Step 8: Admins verify their own tally.** In `src/app/pages/SessionPage.tsx`, replace `const iTapped = taps.some((t) => t.keeperId === auth?.user.id);` with:

```ts
  // Keepers can't verify a game they tallied (VERIFIER_TAPPED); admins can (t120).
  const iTapped = !isAdmin && taps.some((t) => t.keeperId === auth?.user.id);
```

(`isAdmin` is already destructured from `useAuth()` in this component.) Steps 7–8 are one-line conditions; the DB tests in Task 1 pin the real rules, so they get no UI tests (spec amendment 3).

- [ ] **Step 9: Run the tests.**

Run: `npx vitest run src/app && npx tsc && npx eslint src`
Expected: PASS, no type or lint errors.

- [ ] **Step 10: Commit.**

```bash
git add src/app/lib/rpc.ts src/app/lib/errors.ts src/app/pages/TallyPage.tsx src/app/pages/SessionPage.tsx src/app/pages/admin/StagesPanel.tsx src/app/pages/admin/StagesPanel.test.tsx
git commit -m "Admin controls: tally/verify own players, delete tournament, undo game (t120 t121)"
```

---

### Task 3: Opponent names in the app

**Files:**
- Modify: `src/core/tournament.ts` (`TournamentGame`), `src/app/lib/tournament.ts` (`GameRow`, `GAME_COLUMNS`, mapping), `src/app/lib/stats.ts` (`gameLabel`, `gameTitles`)
- Modify: `src/app/pages/GameControls.tsx`, Test: `src/app/pages/GameControls.test.tsx`
- Modify: `src/app/pages/TournamentCard.tsx`, Test: `src/app/pages/TournamentCard.test.tsx`
- Modify: `src/app/lib/tournament.test.ts` (fixtures gain `opponent`)

**Interfaces:**
- Consumes: `api.setGameOpponent(gameId, name)` (Task 2), `games.opponent` (Task 1).
- Produces: `gameLabel(number: number, opponent?: string | null): string` in `src/app/lib/stats.ts` → `'vs Duke'` or `'Game 3'`; `GameRow.opponent: string | null`; `TournamentGame.opponent?: string | null`.

- [ ] **Step 1: Write the failing tests.**

In `src/app/pages/GameControls.test.tsx`: change the rpc mock to `vi.mock('../lib/rpc', () => ({ api: { startGame: vi.fn(), finishGame: vi.fn(), setGameOpponent: vi.fn() } }));`, add `opponent: null` to the `upcoming` fixture (`…, started_at: null, finished_at: null, opponent: null }`), and append inside the `describe`:

```tsx
  it('names the game after the real opponent and shows it in place of the bare number (t123)', async () => {
    state.game = upcoming;
    vi.mocked(api.setGameOpponent).mockReset().mockImplementation(async () => { state.game = { ...upcoming, opponent: 'Duke' }; });
    render(<GameControls season={season} onOpen={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Opponent'), { target: { value: 'Duke' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save opponent' }));
    await waitFor(() => expect(api.setGameOpponent).toHaveBeenCalledWith('g2', 'Duke'));
    expect(await screen.findByText(/Game 2 vs Duke is next/)).toBeTruthy();
    expect((screen.getByLabelText('Opponent') as HTMLInputElement).value).toBe('Duke');
  });
```

In `src/app/pages/TournamentCard.test.tsx`: give both `afterGame1` games `opponent: null`:

```ts
  games: [{ id: 'g1', stage_id: 'S1', number: 1, session_id: 'p1', started_at: '2026-11-07T14:00:00Z', finished_at: '2026-11-07T15:00:00Z',
    opponent: null }, { id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null, opponent: null }],
```

and add as the first test in `describe('TournamentCard', …)`:

```tsx
  it('names games after the real opponent once a keeper sets it (t123)', async () => {
    const r = afterGame1();
    r.games = r.games.map((g) => (g.id === 'g1' ? { ...g, opponent: 'UNC' } : { ...g, opponent: 'Duke' }));
    await show(r);
    expect(screen.getByRole('heading', { name: 'vs Duke · Fall beta' })).toBeTruthy();
    expect(screen.getByText(/vs UNC · Fall beta/)).toBeTruthy();
  });
```

In `src/app/lib/tournament.test.ts`: add `opponent: null` to every `GameRow` fixture (the `games:` array near line 32 and the two `mockGames = [...]` near lines 155–169), and to the expected object near line 56: `…, finishedAt: '2026-11-07T15:00:00+00:00', opponent: null });`.

- [ ] **Step 2: Run to see them fail.**

Run: `npx vitest run src/app/pages/GameControls.test.tsx src/app/pages/TournamentCard.test.tsx src/app/lib/tournament.test.ts`
Expected: FAIL: no "Opponent" field; headings still "Game 2 · Fall beta"; `toTournamentInput` output lacks `opponent`.

- [ ] **Step 3: Carry `opponent` through the data.**

`src/core/tournament.ts`, in `interface TournamentGame` after `finishedAt`:

```ts
  /** The real team our team played ("Duke"); display only, scoring ignores it. */
  opponent?: string | null;
```

`src/app/lib/tournament.ts`:

```ts
export interface GameRow {
  id: string; stage_id: string; number: number; session_id: string | null; started_at: string | null; finished_at: string | null;
  opponent: string | null;
}
export const GAME_COLUMNS = 'id, stage_id, number, session_id, started_at, finished_at, opponent';
```

and in `toTournamentInput`'s `games` mapping add `opponent: g.opponent,` after `finishedAt: g.finished_at,`.

- [ ] **Step 4: The label helper.** In `src/app/lib/stats.ts`, replace `gameTitles` and its comment with:

```ts
/** A game's name everywhere it's shown: the real opponent once a keeper names it ("vs Duke"), else "Game 3". */
export const gameLabel = (number: number, opponent?: string | null) => (opponent ? `vs ${opponent}` : `Game ${number}`);

/** "vs Duke · Fall Beta" (or "Game 3 · Fall Beta") for each session that is a tournament game. */
export async function gameTitles(sessionIds: string[]): Promise<Map<string, string>> {
  if (sessionIds.length === 0) return new Map();
  const { data, error } = await supabase!.from('games').select('session_id, number, opponent, stages(name)').in('session_id', sessionIds);
  if (error) throw error;
  const rows = (data ?? []) as unknown as { session_id: string; number: number; opponent: string | null; stages: { name: string } | null }[];
  return new Map(rows.map((g) => [g.session_id, `${gameLabel(g.number, g.opponent)} · ${g.stages?.name ?? 'Tournament'}`]));
}
```

- [ ] **Step 5: League card labels.** In `src/app/pages/TournamentCard.tsx`: import `gameLabel` from `../lib/stats`; add above `focusGame`:

```tsx
/** "vs Duke" once a keeper names game `number`'s real opponent, else "Game 3". */
const labelOf = (y: LeagueTournament, stageId: string, number: number) =>
  gameLabel(number, y.result.games.find((g) => g.game.stageId === stageId && g.game.number === number)?.game.opponent);
```

then replace `<span>Game {focus.number}</span>` with `<span>{labelOf(y, focus.stageId, focus.number)}</span>`; in `PickGame` replace the title with ``const title = `${labelOf(y, next.stageId, next.number)} · ${y.stage.get(next.stageId) ?? ''}`;``; in the played-game row (`function GameRow`) replace `Game {g.game.number} · {y.stage.get(g.game.stageId) ?? ''}` with `{gameLabel(g.game.number, g.game.opponent)} · {y.stage.get(g.game.stageId) ?? ''}`.

- [ ] **Step 6: Opponent field on the tally page.** In `src/app/pages/GameControls.tsx`: import `type FormEvent` from react; add state `const [opponent, setOpponent] = useState<string | null>(null); // being edited; null = show the saved name`; after `const live = …` add ``const title = game.opponent ? `Game ${n} vs ${game.opponent}` : `Game ${n}`;`` (staff see both: the number keeps Start/Finish unambiguous); use `title` in the three sentences:

```tsx
    setStatus(`${title} finished. Game ${n + 1} is paired.`);
```
```tsx
          <span>{title} is next. Starting it locks every team's pick.</span>
```
```tsx
            {game.session_id ? <>{title} is live.</> : <>{title}: its tally was deleted, so it won't count. Finish it to pair the next game.</>}
```

add after the `confirm` handler:

```tsx
  const nameOpponent = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.setGameOpponent(game.id, opponent ?? '');
      setOpponent(null);
    });
  };
```

and right before `{preview && (`:

```tsx
      {sessionId === undefined && !preview && (
        <form className="row" onSubmit={nameOpponent}>
          <label>Opponent<input maxLength={40} placeholder="e.g. Duke" value={opponent ?? game.opponent ?? ''}
            onChange={(e) => setOpponent(e.target.value)} /></label>
          <button className="secondary" disabled={busy || opponent === null}>Save opponent</button>
        </form>
      )}
```

(`run` already reloads the current game, so the saved name shows after the save.) Button labels stay "Start game N" / "Finish game N".

- [ ] **Step 7: Run the tests.**

Run: `npx vitest run src && npx tsc && npx eslint src`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add src/core/tournament.ts src/app/lib/tournament.ts src/app/lib/tournament.test.ts src/app/lib/stats.ts src/app/pages/GameControls.tsx src/app/pages/GameControls.test.tsx src/app/pages/TournamentCard.tsx src/app/pages/TournamentCard.test.tsx
git commit -m "Name games after the real opponent: vs Duke (t123)"
```

---

### Task 4: Docs and go-live runbook

**Files:**
- Modify: `docs/setup-supabase.md` (new section), `DESIGN.md` ("Words" glossary)

- [ ] **Step 1: Runbook.** Append to `docs/setup-supabase.md`:

```markdown
## Admin powers (after 0001–0013)

1. SQL Editor: paste and run `supabase/migrations/0014_admin_powers.sql` **before** deploying the build. It is
   additive: admins skip the owner and tallied-it-yourself checks, `delete_stage`, `reset_game` and
   `set_game_opponent` appear, games get an `opponent` column, and deleting a tournament keeps its credit rows.
   The old site keeps working on it.
2. Deploy (merge + push). Hard-reload open admin and keeper tabs.
3. Before deleting a tournament for real, **Admin → Backup** → download a Backup JSON: deletes can't be undone.
```

- [ ] **Step 2: Glossary.** In `DESIGN.md`'s "Words" section, add one line: `**Opponent**: the real team our team plays in a game; players see "vs Duke", staff see "Game 2 vs Duke"; unnamed games stay "Game 2".` If there's no "Words" section, add it under Colour's sibling headings with that single line.

- [ ] **Step 3: Full check.**

Run: `npm run typecheck && npm run lint && npx vitest run && npm run build`
Expected: all green (≈387 tests).

- [ ] **Step 4: Commit.**

```bash
git add docs/setup-supabase.md DESIGN.md
git commit -m "Admin powers: go-live runbook and glossary"
```

---

### Controller wrap-up (not a subagent task)

- [ ] Final opus review of `m9-fixes..admin-powers` (and of `main..m9-fixes`, since it ships too) against the spec.
- [ ] User pastes `0014_admin_powers.sql` into tribe-dev; anon probe: `delete_stage`/`reset_game`/`set_game_opponent` exist and answer 42501 for anon (call WITH named params).
- [ ] With the user's OK: merge `admin-powers` into main (`--no-ff`), run the full suite on the merge, push; CI + Deploy green; check the live bundle has the new code. Tag `m10-admin`.
- [ ] Board: t118 t119 t120 t121 t122 t123 done. Delete `admin-powers-verified-draft` and `m9-fixes`. `graphify update .` and report node/edge counts. Update memory.
- [ ] Signed-in check at 375px in light AND dark: League, Tally (opponent field), Stats, Admin → Tournaments (Undo, Delete in Edit).

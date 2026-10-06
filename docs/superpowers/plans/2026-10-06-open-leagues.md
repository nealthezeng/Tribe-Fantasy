# Open Leagues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Invoke `ponytail:ponytail` before writing code.

**Goal:** Anyone signed in creates or joins a league of the current season (public or password), from a searchable list showing "N of M teams"; seasons stay admin-only.

**Architecture:** One additive migration (0019) adds `leagues.created_by`, a private bcrypt password table and six security-definer RPCs; the app replaces the invite-code Join page with `/leagues` (list + inline join) and `/leagues/new`, a Get started card on Home, a creator/admin Manage section, and an admin list with Delete.

**Tech Stack:** Supabase Postgres (plpgsql RPCs, pgcrypto in schema `extensions`), PGlite 0.5.8 tests with `contrib/pgcrypto`, React 19 + react-router (hash routing), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-06-open-leagues-design.md`

**Worktree:** `C:\Users\19195\Documents\Tribe-Fantasy-leagues`, branch `open-leagues`. Never touch the main checkout `Documents\Tribe-Fantasy` (another session uses it).

**Verified draft:** branch `open-leagues-verified-draft` holds the whole build, already green (tsc, lint, build, 288 app/core + open-leagues/gate DB tests, full DB suite 210). Each task below shows the exact code; executors may copy a file with `git checkout open-leagues-verified-draft -- <path>` instead of retyping, then still run every step's command.

## Global Constraints

- Migration file: `supabase/migrations/0019_open_leagues.sql`; additive only (old `create_league`, `create_invite`, `join_league` stay in SQL).
- Every new RPC: `security definer set search_path = ''`, audited via `private.audit`, stable upper-case error codes; the "authenticated only" grant block re-runs at the end of the migration.
- Password: 4–40 characters after trim; blank = public; stored only as `extensions.crypt(pw, extensions.gen_salt('bf'))` in `private.league_passwords`; never written to an audit row.
- Current season = newest by `created_at` (same as the app's `loadCurrentSeason`).
- One created league per person per season; admins exempt (`CREATE_LIMIT`).
- `delete_league`: admin any league; creator only while theirs is the only team (`LEAGUE_HAS_TEAMS`); nobody when the league has donation ledger rows (`LEAGUE_HAS_DONATIONS`).
- UI follows DESIGN.md + `src/app/tokens.css`: reuse existing classes (`.card`, `.list`, `.meta`, `.title`, `.pill`, `.row`, `.section`, `label.check`, `.more`); no raw colours/fonts/radii in CSS (`tokens.test.ts` guards it). No new CSS is needed.
- Words: "league", "team", "season"; buttons name the action and object ("Join league", "Create league", "Rename league", "Delete league").
- Commits end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run (Bash, Git Bash): `export PATH="/c/Program Files/nodejs:$PATH"` first.

## Review Focus

1. **Leagues made before 0019** (the live "League A" has real teams): they list as public with no creator, anyone can join them, and only an admin can lock them — admins get Manage league on Home for any league they're in. Pinned by Task 1's "leagues made before 0019" test.
2. **Password typed with spaces** at create but not at join (or the other way round) must still match — both sides trim. Pinned by Task 1's "trims the password" test.
3. **Search typed with odd case or stray spaces** must still find the league, and an empty result says so. Pinned by Task 2's filter test.
4. **Season switch:** after an admin creates a newer season, older leagues vanish from the list and can't be joined (`NOT_FOUND`), and the create limit starts over. Pinned by Task 1 tests.
5. **A full or already-joined league** must answer `LEAGUE_FULL` / `ALREADY_MEMBER` before asking for a password (no password oracle, no confusing error). Pinned by Task 1's "before asking for the password" test; Task 2 hides Join on those rows.

---

### Task 1: Database — migration 0019, pgcrypto in tests, RPC tests

**Files:**
- Create: `supabase/migrations/0019_open_leagues.sql`
- Create: `tests/db/rpc-open-leagues.test.ts`
- Modify: `tests/db/helpers.ts` (PGlite gets pgcrypto)
- Modify: `tests/db/shim.sql` (schema `extensions`)
- Modify: `tests/db/rpc-gate.test.ts` (new RPCs in the lists + audit steps)

**Interfaces:**
- Produces (SQL, called by Task 2/3 through `supabase.rpc`):
  - `list_leagues() returns table (id uuid, name text, teams int, max_teams int, has_password boolean, is_member boolean, is_creator boolean)`
  - `create_my_league(p_name text, p_password text, p_team_name text) returns uuid` (league id)
  - `join_open_league(p_league uuid, p_password text, p_team_name text) returns uuid` (membership id)
  - `rename_league(p_league uuid, p_name text) returns void`
  - `set_league_password(p_league uuid, p_password text) returns void` (null/blank = public)
  - `delete_league(p_league uuid) returns void`
  - Error codes: `NO_SEASON INVALID_PASSWORD WRONG_PASSWORD CREATE_LIMIT NOT_LEAGUE_OWNER LEAGUE_HAS_TEAMS LEAGUE_HAS_DONATIONS` (plus existing `NO_PROFILE INVALID_NAME INVALID_TEAM_NAME LEAGUE_EXISTS NOT_FOUND ALREADY_MEMBER LEAGUE_FULL TEAM_NAME_TAKEN`).

- [ ] **Step 1: Load pgcrypto in the PGlite harness**

`tests/db/helpers.ts`:

```diff
@@ -1,4 +1,5 @@
 import { PGlite, type Transaction } from '@electric-sql/pglite';
+import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
 import { readdirSync, readFileSync } from 'node:fs';
 import { fileURLToPath } from 'node:url';
 
@@ -7,7 +8,7 @@ const read = (rel: string) => readFileSync(root + rel, 'utf8');
 
 /** A database with every migration applied, or only those sorting before `stopBefore` (e.g. '0006'). */
 export async function freshDb(stopBefore?: string): Promise<PGlite> {
-  const db = new PGlite();
+  const db = new PGlite({ extensions: { pgcrypto } });
   await db.exec(read('tests/db/shim.sql'));
   const files = readdirSync(root + 'supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
   for (const f of files) {
```

`tests/db/shim.sql`:

```diff
@@ -3,6 +3,9 @@ create role anon nologin;
 create role authenticated nologin;
 create role service_role nologin bypassrls;
 
+-- Supabase installs extensions (pgcrypto among them) into this schema.
+create schema extensions;
+
 create schema auth;
 create table auth.users (id uuid primary key, email text unique);
 create function auth.uid() returns uuid language sql stable as $$
```

- [ ] **Step 2: Write the failing RPC tests**

Create `tests/db/rpc-open-leagues.test.ts`:

```ts
// t215: anyone signed in creates or joins a league of the current season; public or password; creator + admins manage.
import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createUser, freshDb, makeAdmin, rpc } from './helpers';

let db: PGlite;
let admin: string, alice: string, bob: string, carol: string, season: string;

interface Listed { id: string; name: string; teams: number; max_teams: number; has_password: boolean; is_member: boolean; is_creator: boolean }

const call = (who: string, fn: string, args: Record<string, unknown>) => as(db, who, (tx) => rpc(tx, fn, args));
const create = (who: string, name: string, password: string | null = null, team = `${name} team`) =>
  call(who, 'create_my_league', { p_name: name, p_password: password, p_team_name: team }) as Promise<string>;
const join = (who: string, league: string, password: string | null = null, team = 'Hucks') =>
  call(who, 'join_open_league', { p_league: league, p_password: password, p_team_name: team }) as Promise<string>;
const list = (who: string) => as(db, who, async (tx) => (await tx.query<Listed>('select * from public.list_leagues()')).rows);
const user = async (email: string, name: string) => {
  const id = await createUser(db, email);
  await call(id, 'set_display_name', { p_name: name });
  return id;
};

beforeEach(async () => {
  db = await freshDb();
  admin = await user('admin@x.test', 'Admin');
  await makeAdmin(db, admin);
  alice = await user('alice@x.test', 'Alice');
  bob = await user('bob@x.test', 'Bob');
  carol = await user('carol@x.test', 'Carol');
  season = (await call(admin, 'create_season', { p_name: 'Fall', p_settings: {} })) as string;
});

describe('create_my_league', () => {
  it('creates a league in the current season with the creator as its first team, and audits no password', async () => {
    const id = await create(alice, ' Huck Yeah ', 'secret1', ' Zips ');
    const l = await db.query<{ season_id: string; name: string; created_by: string }>('select * from public.leagues where id = $1', [id]);
    expect(l.rows[0]).toMatchObject({ season_id: season, name: 'Huck Yeah', created_by: alice });
    const m = await db.query<{ user_id: string; team_name: string }>('select user_id, team_name from public.memberships where league_id = $1', [id]);
    expect(m.rows).toEqual([{ user_id: alice, team_name: 'Zips' }]);
    const a = await db.query<{ details: Record<string, unknown> }>(`select details from public.audit_log where action = 'create_my_league'`);
    expect(a.rows[0].details).toEqual({ season_id: season, name: 'Huck Yeah', team_name: 'Zips', has_password: true });
    expect(JSON.stringify(a.rows[0].details)).not.toContain('secret1');
  });

  it('stores only a bcrypt hash, out of reach of signed-in users', async () => {
    const id = await create(alice, 'Locked', 'secret1');
    const h = await db.query<{ hash: string }>('select hash from private.league_passwords where league_id = $1', [id]);
    expect(h.rows[0].hash).toMatch(/^\$2a\$/);
    await expect(as(db, alice, (tx) => tx.query('select * from private.league_passwords'))).rejects.toThrow(/permission denied/);
  });

  it('treats a blank password as a public league', async () => {
    const id = await create(alice, 'Open', '   ');
    expect((await db.query('select 1 from private.league_passwords where league_id = $1', [id])).rows).toHaveLength(0);
  });

  it('refuses bad input, no profile, no season, and duplicates', async () => {
    const nobody = await createUser(db, 'nobody@x.test');
    await expect(create(nobody, 'X')).rejects.toThrow('NO_PROFILE');
    await expect(create(alice, '   ')).rejects.toThrow('INVALID_NAME');
    await expect(create(alice, 'X', 'abc')).rejects.toThrow('INVALID_PASSWORD');
    await expect(create(alice, 'X', 'x'.repeat(41))).rejects.toThrow('INVALID_PASSWORD');
    await expect(create(alice, 'X', null, ' ')).rejects.toThrow('INVALID_TEAM_NAME');
    await create(alice, 'Taken');
    await expect(create(bob, 'Taken')).rejects.toThrow('LEAGUE_EXISTS');
    await db.query('delete from public.seasons');
    await expect(create(carol, 'Y')).rejects.toThrow('NO_SEASON');
  });

  it('allows one created league per person per season, freed by deleting it; admins are exempt', async () => {
    const first = await create(alice, 'One');
    await expect(create(alice, 'Two')).rejects.toThrow('CREATE_LIMIT');
    await call(alice, 'delete_league', { p_league: first });
    await create(alice, 'Two');
    await create(admin, 'A1');
    await create(admin, 'A2');
    // A new season starts the count again.
    await call(admin, 'create_season', { p_name: 'Spring', p_settings: {} });
    await create(alice, 'Spring league');
  });
});

describe('list_leagues', () => {
  it("lists the current season's leagues by name with counts, lock and my flags", async () => {
    const open = await create(alice, 'Bravo');
    const locked = await create(bob, 'Alpha', 'secret1');
    await join(carol, open);
    expect(await list(carol)).toEqual([
      { id: locked, name: 'Alpha', teams: 1, max_teams: 6, has_password: true, is_member: false, is_creator: false },
      { id: open, name: 'Bravo', teams: 2, max_teams: 6, has_password: false, is_member: true, is_creator: false },
    ]);
    expect((await list(alice)).find((l) => l.id === open)).toMatchObject({ is_member: true, is_creator: true });
  });

  it("uses the season's max_members and hides older seasons' leagues", async () => {
    await create(alice, 'Old');
    await call(admin, 'create_season', { p_name: 'Spring', p_settings: { max_members: 8 } });
    expect(await list(bob)).toEqual([]);
    await create(bob, 'New');
    expect((await list(bob))[0]).toMatchObject({ name: 'New', max_teams: 8 });
  });

  it('is closed to anon', async () => {
    await expect(as(db, null, (tx) => tx.query('select * from public.list_leagues()'))).rejects.toThrow(/permission denied/);
  });
});

describe('join_open_league', () => {
  it('joins a public league whatever password is sent, and audits without it', async () => {
    const id = await create(alice, 'Open');
    const mid = await join(bob, id, 'anything', ' Bobcats ');
    const m = await db.query<{ league_id: string; team_name: string }>('select league_id, team_name from public.memberships where id = $1', [mid]);
    expect(m.rows[0]).toEqual({ league_id: id, team_name: 'Bobcats' });
    const a = await db.query<{ details: Record<string, unknown> }>(`select details from public.audit_log where action = 'join_open_league'`);
    expect(a.rows[0].details).toEqual({ league_id: id, team_name: 'Bobcats' });
  });

  it('checks the password (trimmed) on a locked league', async () => {
    const id = await create(alice, 'Locked', 'secret1');
    await expect(join(bob, id, null)).rejects.toThrow('WRONG_PASSWORD');
    await expect(join(bob, id, 'Secret1')).rejects.toThrow('WRONG_PASSWORD');
    await join(bob, id, ' secret1 ');
  });

  it('says ALREADY_MEMBER and LEAGUE_FULL before asking for the password', async () => {
    await call(admin, 'update_season_settings', { p_season: season, p_settings: { max_members: 2 } });
    const id = await create(alice, 'Small', 'secret1');
    await expect(join(alice, id, 'wrong!')).rejects.toThrow('ALREADY_MEMBER');
    await join(bob, id, 'secret1');
    await expect(join(carol, id, 'wrong!')).rejects.toThrow('LEAGUE_FULL');
  });

  it('refuses a taken team name, no profile, bad team name, unknown or old-season leagues', async () => {
    const id = await create(alice, 'Open', null, 'Zips');
    await expect(join(bob, id, null, 'Zips')).rejects.toThrow('TEAM_NAME_TAKEN');
    await expect(join(bob, id, null, ' ')).rejects.toThrow('INVALID_TEAM_NAME');
    const nobody = await createUser(db, 'nobody@x.test');
    await expect(join(nobody, id)).rejects.toThrow('NO_PROFILE');
    await expect(join(bob, '00000000-0000-0000-0000-000000000000')).rejects.toThrow('NOT_FOUND');
    await call(admin, 'create_season', { p_name: 'Spring', p_settings: {} });
    await expect(join(bob, id)).rejects.toThrow('NOT_FOUND');
  });
});

describe('rename_league / set_league_password', () => {
  it('lets the creator and admins rename and change the password, nobody else', async () => {
    const id = await create(alice, 'Mine', 'secret1');
    await call(alice, 'rename_league', { p_league: id, p_name: 'Ours' });
    await call(admin, 'rename_league', { p_league: id, p_name: 'Theirs' });
    await expect(call(bob, 'rename_league', { p_league: id, p_name: 'Bobs' })).rejects.toThrow('NOT_LEAGUE_OWNER');
    await expect(call(bob, 'set_league_password', { p_league: id, p_password: null })).rejects.toThrow('NOT_LEAGUE_OWNER');
    expect((await list(alice))[0].name).toBe('Theirs');

    await call(alice, 'set_league_password', { p_league: id, p_password: 'newpass' });
    await expect(join(bob, id, 'secret1')).rejects.toThrow('WRONG_PASSWORD');
    await call(admin, 'set_league_password', { p_league: id, p_password: '' });
    expect((await list(bob))[0].has_password).toBe(false);
    await join(bob, id, null);

    const a = await db.query<{ details: unknown }>(`select details from public.audit_log where action = 'set_league_password'`);
    expect(JSON.stringify(a.rows)).not.toContain('newpass');
  });

  it('refuses a duplicate name, a short password, unknown leagues, and non-admins on old leagues', async () => {
    const id = await create(alice, 'Mine');
    await create(bob, 'Other');
    await expect(call(alice, 'rename_league', { p_league: id, p_name: 'Other' })).rejects.toThrow('LEAGUE_EXISTS');
    await expect(call(alice, 'set_league_password', { p_league: id, p_password: 'abc' })).rejects.toThrow('INVALID_PASSWORD');
    await expect(call(alice, 'rename_league', { p_league: '00000000-0000-0000-0000-000000000000', p_name: 'X' }))
      .rejects.toThrow('NOT_FOUND');
    const old = (await call(admin, 'create_league', { p_season: season, p_name: 'Legacy' })) as string;
    await expect(call(alice, 'rename_league', { p_league: old, p_name: 'X' })).rejects.toThrow('NOT_LEAGUE_OWNER');
  });
});

describe('leagues made before 0019', () => {
  it('list as public with no creator, anyone can join, and only an admin can lock them', async () => {
    const old = (await call(admin, 'create_league', { p_season: season, p_name: 'League A' })) as string;
    expect((await list(alice))[0]).toMatchObject({ id: old, has_password: false, is_creator: false, teams: 0 });
    await join(alice, old);
    await expect(call(alice, 'set_league_password', { p_league: old, p_password: 'secret1' })).rejects.toThrow('NOT_LEAGUE_OWNER');
    await call(admin, 'set_league_password', { p_league: old, p_password: 'secret1' });
    await expect(join(bob, old)).rejects.toThrow('WRONG_PASSWORD');
  });

  it('trims the password when it is set, so the same password works at join', async () => {
    const id = await create(alice, 'Spaced', '  secret1  ');
    await join(bob, id, 'secret1');
  });
});

describe('delete_league', () => {
  it('lets the creator delete only while theirs is the only team; admins delete any and audit counts', async () => {
    const id = await create(alice, 'Mine');
    await join(bob, id);
    await expect(call(alice, 'delete_league', { p_league: id })).rejects.toThrow('LEAGUE_HAS_TEAMS');
    await expect(call(carol, 'delete_league', { p_league: id })).rejects.toThrow('NOT_LEAGUE_OWNER');
    await call(admin, 'delete_league', { p_league: id });
    expect((await db.query('select 1 from public.memberships')).rows).toHaveLength(0);
    const a = await db.query<{ details: Record<string, unknown> }>(`select details from public.audit_log where action = 'delete_league'`);
    expect(a.rows[0].details).toEqual({ name: 'Mine', memberships: 2, ledger_rows: 0 });
  });

  it('refuses a league with donation records, even for admins', async () => {
    await call(admin, 'update_season_settings', { p_season: season, p_settings: { donations_enabled: true } });
    const id = await create(alice, 'Mine');
    const mid = (await db.query<{ id: string }>('select id from public.memberships where league_id = $1', [id])).rows[0].id;
    await call(admin, 'record_donation', { p_membership: mid, p_dollars: 5, p_note: null });
    await expect(call(alice, 'delete_league', { p_league: id })).rejects.toThrow('LEAGUE_HAS_DONATIONS');
    await expect(call(admin, 'delete_league', { p_league: id })).rejects.toThrow('LEAGUE_HAS_DONATIONS');
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tests/db/rpc-open-leagues.test.ts`
Expected: FAIL — `function public.create_my_league(...) does not exist` (and list_leagues missing).

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/0019_open_leagues.sql`:

```sql
-- Open leagues (t215): anyone signed in creates or joins a league of the current season; a league is public or has a
-- password. Seasons stay admin-only. Spec: docs/superpowers/specs/2026-10-06-open-leagues-design.md.
-- Additive: the old create_league / create_invite / join_league stay (admin-made codes still work, the app no longer
-- offers them), so this is safe to paste before the new build deploys.

create extension if not exists pgcrypto with schema extensions;

alter table public.leagues add column created_by uuid references auth.users (id) on delete set null;

-- Not on public.leagues: leagues_read is `using (true)`, so a column there would be readable by everyone.
create table private.league_passwords (
  league_id uuid primary key references public.leagues (id) on delete cascade,
  hash text not null
);

-- The newest season, as the app's loadCurrentSeason picks it.
create function private.current_season() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare sid uuid;
begin
  select id into sid from public.seasons order by created_at desc, id desc limit 1;
  if sid is null then raise exception 'NO_SEASON'; end if;
  return sid;
end $$;

-- Blank = no password (public league); otherwise 4-40 characters after trimming.
create function private.clean_password(p_password text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_password, '')), '');
begin
  if v is not null and length(v) not between 4 and 40 then raise exception 'INVALID_PASSWORD'; end if;
  return v;
end $$;

-- The league, locked, if the caller made it or is an admin. Old leagues (created_by null) are admin-only.
create function private.owned_league(p_league uuid) returns public.leagues
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); l public.leagues;
begin
  select * into l from public.leagues where id = p_league for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if l.created_by is distinct from uid and not public.is_admin() then raise exception 'NOT_LEAGUE_OWNER'; end if;
  return l;
end $$;

revoke all on all functions in schema private from public, anon, authenticated;

-- Membership rows are hidden from non-members, so the "N of M teams" count comes from here.
create function public.list_leagues()
returns table (id uuid, name text, teams int, max_teams int, has_password boolean, is_member boolean, is_creator boolean)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user(); sid uuid := private.current_season();
begin
  return query
    select l.id, l.name,
      (select count(*)::int from public.memberships m where m.league_id = l.id),
      private.setting_num(sid, 'max_members', 6)::int,
      exists (select 1 from private.league_passwords p where p.league_id = l.id),
      exists (select 1 from public.memberships m where m.league_id = l.id and m.user_id = uid),
      l.created_by is not distinct from uid
    from public.leagues l where l.season_id = sid order by l.name;
end $$;

create function public.create_my_league(p_name text, p_password text, p_team_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  sid uuid;
  v text;
  pw text;
  t text := btrim(coalesce(p_team_name, ''));
  lid uuid;
begin
  -- Locking the profile row serialises one user's creates, so two at once can't both pass CREATE_LIMIT.
  perform 1 from public.profiles where id = uid for update;
  if not found then raise exception 'NO_PROFILE'; end if;
  v := private.clean_name(p_name, 60);
  pw := private.clean_password(p_password);
  if length(t) < 1 or length(t) > 40 then raise exception 'INVALID_TEAM_NAME'; end if;
  sid := private.current_season();
  if not public.is_admin() and exists (select 1 from public.leagues where season_id = sid and created_by = uid) then
    raise exception 'CREATE_LIMIT';
  end if;
  begin
    insert into public.leagues (season_id, name, created_by) values (sid, v, uid) returning id into lid;
  exception when unique_violation then raise exception 'LEAGUE_EXISTS';
  end;
  if pw is not null then
    insert into private.league_passwords (league_id, hash) values (lid, extensions.crypt(pw, extensions.gen_salt('bf')));
  end if;
  insert into public.memberships (league_id, user_id, team_name) values (lid, uid, t);
  perform private.audit('create_my_league', 'league', lid::text,
    jsonb_build_object('season_id', sid, 'name', v, 'team_name', t, 'has_password', pw is not null));
  return lid;
end $$;

-- join_league's checks and locking (0006), with a league id and password instead of an invite code.
create function public.join_open_league(p_league uuid, p_password text, p_team_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  l public.leagues;
  h text;
  mid uuid;
  t text := btrim(coalesce(p_team_name, ''));
begin
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'NO_PROFILE'; end if;
  if length(t) < 1 or length(t) > 40 then raise exception 'INVALID_TEAM_NAME'; end if;
  -- The league row lock stops two joins from both taking the last spot.
  select * into l from public.leagues where id = p_league for update;
  if not found or l.season_id <> private.current_season() then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.memberships where league_id = l.id and user_id = uid) then
    raise exception 'ALREADY_MEMBER';
  end if;
  if (select count(*) from public.memberships where league_id = l.id) >= private.setting_num(l.season_id, 'max_members', 6) then
    raise exception 'LEAGUE_FULL';
  end if;
  select hash into h from private.league_passwords where league_id = l.id;
  if h is not null and extensions.crypt(btrim(coalesce(p_password, '')), h) <> h then
    raise exception 'WRONG_PASSWORD';
  end if;
  begin
    insert into public.memberships (league_id, user_id, team_name) values (l.id, uid, t) returning id into mid;
  exception when unique_violation then raise exception 'TEAM_NAME_TAKEN';
  end;
  perform private.audit('join_open_league', 'membership', mid::text, jsonb_build_object('league_id', l.id, 'team_name', t));
  return mid;
end $$;

create function public.rename_league(p_league uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leagues := private.owned_league(p_league); v text := private.clean_name(p_name, 60);
begin
  begin
    update public.leagues set name = v where id = l.id;
  exception when unique_violation then raise exception 'LEAGUE_EXISTS';
  end;
  perform private.audit('rename_league', 'league', l.id::text, jsonb_build_object('old', l.name, 'new', v));
end $$;

-- Blank = make the league public. The audit row never holds the password.
create function public.set_league_password(p_league uuid, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leagues := private.owned_league(p_league); pw text := private.clean_password(p_password);
begin
  if pw is null then
    delete from private.league_passwords where league_id = l.id;
  else
    insert into private.league_passwords (league_id, hash) values (l.id, extensions.crypt(pw, extensions.gen_salt('bf')))
    on conflict (league_id) do update set hash = excluded.hash;
  end if;
  perform private.audit('set_league_password', 'league', l.id::text, jsonb_build_object('has_password', pw is not null));
end $$;

-- Admins delete any league; its creator only while they're its only team. Never one with donation records:
-- memberships cascade into the ledger (same ruling as delete_season).
create function public.delete_league(p_league uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leagues; counts jsonb;
begin
  -- ponytail: as delete_season, blocks ledger inserts while the delete runs so a donation can't slip in.
  lock table public.credit_ledger in share mode;
  l := private.owned_league(p_league);
  if not public.is_admin()
     and exists (select 1 from public.memberships where league_id = l.id and user_id is distinct from auth.uid()) then
    raise exception 'LEAGUE_HAS_TEAMS';
  end if;
  if exists (select 1 from public.credit_ledger c join public.memberships m on m.id = c.membership_id
             where m.league_id = l.id and c.kind = 'donation') then
    raise exception 'LEAGUE_HAS_DONATIONS';
  end if;
  counts := jsonb_build_object(
    'memberships', (select count(*) from public.memberships where league_id = l.id),
    'ledger_rows', (select count(*) from public.credit_ledger c join public.memberships m on m.id = c.membership_id
                    where m.league_id = l.id));
  delete from public.leagues where id = l.id;
  perform private.audit('delete_league', 'league', l.id::text, jsonb_build_object('name', l.name) || counts);
end $$;

-- Functions: authenticated only (same block as 0002).
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

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run tests/db/rpc-open-leagues.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Update the RPC gate (it discovers RPCs from pg_proc, so it fails until the new ones are listed)**

Run first: `npx vitest run tests/db/rpc-gate.test.ts` — Expected: FAIL (`add an audit step for each new RPC`, and FORBIDDEN expected from the new member-callable RPCs).

Then apply to `tests/db/rpc-gate.test.ts`:

```diff
@@ -6,11 +6,13 @@ import { as, createUser, freshDb, makeAdmin, rpc } from './helpers';
 import { makeKeeper, tap } from './stats-fixture';
 
 /** Read-only helpers used by RLS policies; they write nothing, so no audit row. */
-const READ_HELPERS = ['can_read_league_data', 'has_role', 'is_admin', 'is_keeper', 'is_my_athlete', 'is_season_athlete'];
+const READ_HELPERS = ['can_read_league_data', 'has_role', 'is_admin', 'is_keeper', 'is_my_athlete', 'is_season_athlete', 'list_leagues'];
 /** Any signed-in user may call these; they check ownership instead of a role. */
 const MEMBER_CALLABLE = [
   'clear_injury', 'delete_bid', 'join_league', 'place_bid', 'report_injury', 'set_attendance', 'set_display_name',
   'set_bench', 'set_game_pick', 'set_notify_email', 'swap_bench',
+  // Open leagues (t215): owner/admin checks happen inside.
+  'create_my_league', 'delete_league', 'join_open_league', 'rename_league', 'set_league_password',
 ];
 /** Keepers (and admins) may call these; every other staff RPC is admin-only. */
 const KEEPER_CALLABLE = [
@@ -112,6 +114,12 @@ describe('RPC gate', () => {
       ['rename_season', admin, () => ({ p_season: c.season, p_name: 'Gate season' })],
       // c.season has a donation (refused), so delete a fresh one.
       ['delete_season', admin, () => ({ p_season: c.spareSeason })],
+      // Open leagues (t215), in the gate season again now that the spare one is gone.
+      ['create_my_league', player, () => ({ p_name: 'Open', p_password: 'gate1', p_team_name: 'Pats' }), (r) => (c.open = r as string)],
+      ['join_open_league', keeper, () => ({ p_league: c.open, p_password: 'gate1', p_team_name: 'Keeps' })],
+      ['rename_league', player, () => ({ p_league: c.open, p_name: 'Open gate' })],
+      ['set_league_password', player, () => ({ p_league: c.open, p_password: null })],
+      ['delete_league', admin, () => ({ p_league: c.open })],
     ];
 
     const covered = new Set(steps.map(([name]) => name));
@@ -145,6 +153,9 @@ describe('RPC gate', () => {
       if (name === 'delete_season') {
         c.spareSeason = (await as(db, admin, (tx) => rpc(tx, 'create_season', { p_name: 'Spare', p_settings: {} }))) as string;
       }
+      if (name === 'join_open_league') {
+        await as(db, keeper, (tx) => rpc(tx, 'set_display_name', { p_name: 'Kim' }));
+      }
       if (name === 'run_auction') {
         await db.query(`update public.stages set bid_close_at = now() - interval '1 second' where id = $1`, [c.stage]);
       }
```

- [ ] **Step 7: Run the DB suite**

Run: `npx vitest run tests/db/rpc-open-leagues.test.ts tests/db/rpc-gate.test.ts tests/db/guards.test.ts`
Expected: PASS. Then the whole DB suite alone (it is slow and flakes under load if run beside a dev server): `npx vitest run tests/db` — Expected: PASS (210 tests in the draft).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0019_open_leagues.sql tests/db/rpc-open-leagues.test.ts tests/db/helpers.ts tests/db/shim.sql tests/db/rpc-gate.test.ts
git commit -m "Open leagues: 0019 RPCs (list, create, join with password, rename, password, delete) + tests (t215)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: App — Join a league, Create a league, Manage league, Home onboarding

**Files:**
- Modify: `src/app/lib/rpc.ts` (`LeagueListing` type + 6 calls; drop `joinLeague`, `createLeague`, `createInvite`)
- Modify: `src/app/lib/errors.ts`, `src/app/lib/errors.test.ts`
- Create: `src/app/pages/LeaguesPage.tsx` (exports `LeaguesPage`, `CreateLeaguePage`, `ManageLeague`)
- Create: `src/app/pages/LeaguesPage.test.tsx`
- Modify: `src/app/App.tsx` (routes `/leagues`, `/leagues/new`; `/join` redirects)
- Modify: `src/app/pages/HomePage.tsx` (Get started card, Manage league, footer links)
- Delete: `src/app/pages/JoinPage.tsx`

**Interfaces:**
- Consumes: Task 1's RPCs.
- Produces:
  - `export interface LeagueListing { id: string; name: string; teams: number; max_teams: number; has_password: boolean; is_member: boolean; is_creator: boolean }` in `src/app/lib/rpc.ts`
  - `api.listLeagues(): Promise<LeagueListing[]>`, `api.createMyLeague(name, password: string | null, teamName): Promise<string>`, `api.joinOpenLeague(leagueId, password: string | null, teamName): Promise<string>`, `api.renameLeague(leagueId, name)`, `api.setLeaguePassword(leagueId, password: string | null)`, `api.deleteLeague(leagueId)` — Task 3 uses `api.deleteLeague`.
  - `ManageLeague({ league: LeagueListing; onChanged: () => void })`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/pages/LeaguesPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type LeagueListing } from '../lib/rpc';
import { CreateLeaguePage, LeaguesPage, ManageLeague } from './LeaguesPage';

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }) }));
vi.mock('../lib/rpc', () => ({ api: {
  listLeagues: vi.fn(),
  joinOpenLeague: vi.fn(() => Promise.resolve('m1')),
  createMyLeague: vi.fn(() => Promise.resolve('l9')),
  renameLeague: vi.fn(() => Promise.resolve()),
  setLeaguePassword: vi.fn(() => Promise.resolve()),
  deleteLeague: vi.fn(() => Promise.resolve()),
} }));

const league = (over: Partial<LeagueListing>): LeagueListing => ({
  id: 'l1', name: 'Huck Yeah', teams: 2, max_teams: 6, has_password: false, is_member: false, is_creator: false, ...over,
});
const LEAGUES = [
  league({ id: 'a', name: 'Alpha Dogs', has_password: true }),
  league({ id: 'b', name: 'Bravo', teams: 6 }),
  league({ id: 'c', name: 'Huck Yeah', teams: 4, is_member: true }),
  league({ id: 'd', name: 'Zip Zap' }),
];

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/" element={<p>home</p>} />
      <Route path="/leagues" element={<LeaguesPage />} />
      <Route path="/leagues/new" element={<CreateLeaguePage />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { vi.mocked(api.listLeagues).mockResolvedValue(LEAGUES); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('LeaguesPage (t215)', () => {
  it('shows N of M teams, Password, Full and Joined, and offers Join only where you can join', async () => {
    at('/leagues');
    expect(await screen.findByText('4 of 6 teams')).toBeTruthy();
    expect(screen.getByText('Password')).toBeTruthy();
    expect(screen.getByText('Full')).toBeTruthy();
    expect(screen.getByText('Joined')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Join / }).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Join Alpha Dogs', 'Join Zip Zap']);
  });

  it('filters by name, ignoring case and spaces, and says when nothing matches', async () => {
    at('/leagues');
    const search = await screen.findByLabelText('Search leagues');
    fireEvent.change(search, { target: { value: '  ZIP ' } });
    expect(screen.getByText('Zip Zap')).toBeTruthy();
    expect(screen.queryByText('Bravo')).toBeNull();
    fireEvent.change(search, { target: { value: 'nope' } });
    expect(screen.getByText('No league matches "nope".')).toBeTruthy();
  });

  it('asks a locked league for its password and goes Home after joining', async () => {
    at('/leagues');
    fireEvent.click(await screen.findByRole('button', { name: 'Join Alpha Dogs' }));
    fireEvent.change(screen.getByLabelText('Your team name'), { target: { value: 'Zips' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join league' }));
    await waitFor(() => expect(api.joinOpenLeague).toHaveBeenCalledWith('a', 'secret1', 'Zips'));
    expect(await screen.findByText('home')).toBeTruthy();
  });

  it('sends no password to a public league and shows a refusal in place', async () => {
    vi.mocked(api.joinOpenLeague).mockRejectedValueOnce({ message: 'TEAM_NAME_TAKEN' });
    at('/leagues');
    fireEvent.click(await screen.findByRole('button', { name: 'Join Zip Zap' }));
    expect(screen.queryByLabelText('Password')).toBeNull();
    fireEvent.change(screen.getByLabelText('Your team name'), { target: { value: 'Zips' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join league' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already has that name/);
    expect(api.joinOpenLeague).toHaveBeenCalledWith('d', null, 'Zips');
  });

  it('invites you to create the first league when there are none', async () => {
    vi.mocked(api.listLeagues).mockResolvedValue([]);
    at('/leagues');
    expect(await screen.findByText('No leagues yet. Create the first one.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create a league' }).getAttribute('href')).toBe('/leagues/new');
  });
});

describe('CreateLeaguePage (t215)', () => {
  it('creates a public league by default', async () => {
    at('/leagues/new');
    fireEvent.change(screen.getByLabelText('League name'), { target: { value: 'Huck Yeah' } });
    fireEvent.change(screen.getByLabelText('Your team name'), { target: { value: 'Zips' } });
    expect(screen.queryByLabelText('Password')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));
    await waitFor(() => expect(api.createMyLeague).toHaveBeenCalledWith('Huck Yeah', null, 'Zips'));
    expect(await screen.findByText('home')).toBeTruthy();
  });

  it('sends the password when the league needs one', async () => {
    at('/leagues/new');
    fireEvent.change(screen.getByLabelText('League name'), { target: { value: 'Locked' } });
    fireEvent.change(screen.getByLabelText('Your team name'), { target: { value: 'Zips' } });
    fireEvent.click(screen.getByLabelText('Needs a password to join'));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));
    await waitFor(() => expect(api.createMyLeague).toHaveBeenCalledWith('Locked', 'secret1', 'Zips'));
  });
});

describe('ManageLeague (t215)', () => {
  it('deletes only while yours is the only team, after a confirm', async () => {
    const onChanged = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { rerender } = render(<ManageLeague league={league({ teams: 1, is_creator: true })} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete league', hidden: true }));
    await waitFor(() => expect(api.deleteLeague).toHaveBeenCalledWith('l1'));
    expect(onChanged).toHaveBeenCalled();
    rerender(<ManageLeague league={league({ teams: 2, is_creator: true })} onChanged={onChanged} />);
    expect(screen.queryByRole('button', { name: 'Delete league', hidden: true })).toBeNull();
    expect(screen.getByText(/only an admin can delete/)).toBeTruthy();
  });

  it('renames, and removes the password only when there is one', async () => {
    render(<ManageLeague league={league({ has_password: true, is_creator: true })} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('League name'), { target: { value: 'Huck No' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename league', hidden: true }));
    await waitFor(() => expect(api.renameLeague).toHaveBeenCalledWith('l1', 'Huck No'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove password', hidden: true }));
    await waitFor(() => expect(api.setLeaguePassword).toHaveBeenCalledWith('l1', null));
    cleanup();
    render(<ManageLeague league={league({ is_creator: true })} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Remove password', hidden: true })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add password', hidden: true })).toBeTruthy();
  });
});
```

Apply to `src/app/lib/errors.test.ts` (the invite-code messages go away with the invite UI):

```diff
@@ -3,11 +3,15 @@ import { errorMessage } from './errors';
 
 describe('errorMessage', () => {
   it('maps RPC codes to plain language', () => {
-    expect(errorMessage({ message: 'INVALID_INVITE' })).toMatch(/invalid, expired, or used up/);
+    expect(errorMessage({ message: 'ALREADY_MEMBER' })).toMatch(/already in this league/);
     expect(errorMessage(new Error('FORBIDDEN'))).toMatch(/permission/);
   });
-  it('maps INVALID_INVITE_SETTINGS to plain language', () => {
-    expect(errorMessage({ message: 'INVALID_INVITE_SETTINGS' })).toMatch(/max uses must be at least 1/);
+  it('maps the open-league codes (t215)', () => {
+    for (const code of ['NO_SEASON', 'INVALID_PASSWORD', 'WRONG_PASSWORD', 'CREATE_LIMIT', 'NOT_LEAGUE_OWNER',
+      'LEAGUE_HAS_TEAMS', 'LEAGUE_HAS_DONATIONS']) {
+      expect(errorMessage({ message: code }), code).not.toMatch(/Something went wrong/);
+    }
+    expect(errorMessage({ message: 'WRONG_PASSWORD' })).toMatch(/Ask the league's creator/);
   });
   it('maps the M3 stats codes', () => {
     expect(errorMessage({ message: 'VERIFIER_TAPPED' })).toMatch(/another keeper has to verify/);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/app/pages/LeaguesPage.test.tsx src/app/lib/errors.test.ts`
Expected: FAIL — cannot resolve `./LeaguesPage`; open-league codes fall back to "Something went wrong".

- [ ] **Step 3: API calls and error messages**

`src/app/lib/rpc.ts`:

```diff
@@ -2,6 +2,17 @@ import type { QueuedTap } from '../tally/queue';
 import { supabase } from './supabase';
 import type { GamePairing, LeaguePairingInput } from './tournament';
 
+/** A row of list_leagues(): the current season's leagues, as anyone signed in sees them (t215). */
+export interface LeagueListing {
+  id: string;
+  name: string;
+  teams: number;
+  max_teams: number;
+  has_password: boolean;
+  is_member: boolean;
+  is_creator: boolean;
+}
+
 async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
   if (!supabase) throw new Error('NOT_CONFIGURED');
   const { data, error } = await supabase.rpc(fn, args);
@@ -12,13 +23,20 @@ async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
 export const api = {
   setDisplayName: (name: string) => call<void>('set_display_name', { p_name: name }),
   setNotifyEmail: (on: boolean) => call<void>('set_notify_email', { p_on: on }),
-  joinLeague: (code: string, teamName: string) => call<string>('join_league', { p_code: code, p_team_name: teamName }),
+  listLeagues: () => call<LeagueListing[]>('list_leagues', {}),
+  /** `password` null = a public league. */
+  createMyLeague: (name: string, password: string | null, teamName: string) =>
+    call<string>('create_my_league', { p_name: name, p_password: password, p_team_name: teamName }),
+  joinOpenLeague: (leagueId: string, password: string | null, teamName: string) =>
+    call<string>('join_open_league', { p_league: leagueId, p_password: password, p_team_name: teamName }),
+  renameLeague: (leagueId: string, name: string) => call<void>('rename_league', { p_league: leagueId, p_name: name }),
+  /** `password` null = make the league public. */
+  setLeaguePassword: (leagueId: string, password: string | null) =>
+    call<void>('set_league_password', { p_league: leagueId, p_password: password }),
+  deleteLeague: (leagueId: string) => call<void>('delete_league', { p_league: leagueId }),
   createSeason: (name: string, settings: object) => call<string>('create_season', { p_name: name, p_settings: settings }),
   updateSeasonSettings: (seasonId: string, settings: object) =>
     call<void>('update_season_settings', { p_season: seasonId, p_settings: settings }),
-  createLeague: (seasonId: string, name: string) => call<string>('create_league', { p_season: seasonId, p_name: name }),
-  createInvite: (leagueId: string, code: string, maxUses: number, expiresAt: string | null) =>
-    call<string>('create_invite', { p_league: leagueId, p_code: code, p_max_uses: maxUses, p_expires_at: expiresAt }),
   addAthlete: (seasonId: string, name: string) => call<string>('add_athlete', { p_season: seasonId, p_name: name, p_user: null }),
   setAthleteOptIn: (athleteId: string, optedIn: boolean) =>
     call<void>('set_athlete_opt_in', { p_athlete: athleteId, p_opted_in: optedIn }),
```

`src/app/lib/errors.ts`:

```diff
@@ -6,14 +6,10 @@ const MESSAGES: Record<string, string> = {
   INVALID_NAME: 'Names must be 1–60 characters.',
   INVALID_SETTINGS: 'Those season settings are not valid.',
   LEAGUE_EXISTS: 'That season already has a league with this name.',
-  INVALID_CODE: 'Invite codes are 6–20 letters or digits.',
-  CODE_TAKEN: 'That invite code already exists.',
   ATHLETE_EXISTS: 'An athlete with that name is already in this season.',
   ATHLETE_IN_USE: "This athlete has stats, bids or picks, so they weren't removed. Opt them out instead.",
   NO_PROFILE: 'Set your display name first.',
   INVALID_TEAM_NAME: 'Team names must be 1–40 characters.',
-  INVALID_INVITE: 'That invite code is invalid, expired, or used up.',
-  INVALID_INVITE_SETTINGS: 'Invite settings are not valid (max uses must be at least 1).',
   ALREADY_MEMBER: "You're already in this league.",
   TEAM_NAME_TAKEN: 'Another team in this league already has that name.',
   INVALID_ROLE: 'Unknown role.',
@@ -38,6 +34,13 @@ const MESSAGES: Record<string, string> = {
   STAGE_EXISTS: 'A tournament with that name already exists this season.',
   SEASON_HAS_DONATIONS: "This season has donation records, so it can't be deleted. You can still rename it.",
   LEAGUE_FULL: 'This league is full.',
+  NO_SEASON: "There's no season yet, so leagues can't be made. Ask an admin to create one.",
+  INVALID_PASSWORD: 'League passwords are 4–40 characters.',
+  WRONG_PASSWORD: "That password isn't right. Ask the league's creator for it.",
+  CREATE_LIMIT: "You've already created a league this season. Delete it first to make another.",
+  NOT_LEAGUE_OWNER: 'Only the person who created this league, or an admin, can change it.',
+  LEAGUE_HAS_TEAMS: 'Other teams have joined, so only an admin can delete this league now.',
+  LEAGUE_HAS_DONATIONS: "This league has donation records, so it can't be deleted.",
   DONATIONS_DISABLED: 'Recording donations to the team is turned off for this season.',
   INVALID_AMOUNT: "That amount isn't valid.",
   NOTE_REQUIRED: 'Add a note saying why.',
```

- [ ] **Step 4: The pages**

Create `src/app/pages/LeaguesPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Loading } from '../components/Loading';
import { errorMessage } from '../lib/errors';
import { api, type LeagueListing } from '../lib/rpc';
import { useLoad } from '../lib/useLoad';

/** /leagues (t215): the current season's leagues, searchable by name; tap Join for a team name (+ password). */
export function LeaguesPage() {
  const { session, loading } = useAuth();
  const uid = session?.user.id;
  const leagues = useLoad(async () => (uid ? api.listLeagues() : undefined), [uid]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  const q = query.trim().toLowerCase();
  const shown = leagues.data?.filter((l) => l.name.toLowerCase().includes(q));

  return (
    <section className="page">
      <h1>Join a league</h1>
      <div className="card">
        <label>Search leagues<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" /></label>
        {leagues.error && <p className="error" role="alert">{leagues.error}</p>}
        {!leagues.data && !leagues.error && <Loading />}
        {leagues.data?.length === 0 && <p className="muted">No leagues yet. Create the first one.</p>}
        {!!leagues.data?.length && shown?.length === 0 && <p className="muted">No league matches "{query.trim()}".</p>}
        <ul className="list">
          {shown?.map((l) => (
            <LeagueRow key={l.id} league={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} />
          ))}
        </ul>
      </div>
      <p><Link to="/leagues/new" className="more">Create a league</Link></p>
    </section>
  );
}

function LeagueRow({ league: l, open, onToggle }: { league: LeagueListing; open: boolean; onToggle: () => void }) {
  const navigate = useNavigate();
  const [team, setTeam] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = l.teams >= l.max_teams;

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.joinOpenLeague(l.id, l.has_password ? password : null, team);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <li>
      <span className="meta">
        <span className="title">{l.name}</span>
        {l.has_password && <span className="pill">Password</span>}
      </span>
      <span className="meta">
        <span className="muted num">{l.teams} of {l.max_teams} teams</span>
        {l.is_member ? <span className="pill ok">Joined</span>
          : full ? <span className="pill">Full</span>
          : <button className="secondary" aria-expanded={open} aria-label={`Join ${l.name}`} onClick={onToggle}>Join</button>}
      </span>
      {open && !l.is_member && !full && (
        <form className="row" onSubmit={join}>
          <label>Your team name<input required maxLength={40} value={team} onChange={(e) => setTeam(e.target.value)} /></label>
          {l.has_password && (
            <label>Password<input type="password" required autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          )}
          <button disabled={busy}>{busy ? 'Joining…' : 'Join league'}</button>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      )}
    </li>
  );
}

/** /leagues/new (t215): anyone makes a league of the current season and joins it as its first team. */
export function CreateLeaguePage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [team, setTeam] = useState('');
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createMyLeague(name, locked ? password : null, team);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <h1>Create a league</h1>
      <form className="card" onSubmit={submit}>
        <label>League name<input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Your team name<input required maxLength={40} value={team} onChange={(e) => setTeam(e.target.value)} /></label>
        <label className="check">
          <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
          Needs a password to join
        </label>
        {locked && (
          <label>Password<input required minLength={4} maxLength={40} autoComplete="off" value={password}
            onChange={(e) => setPassword(e.target.value)} /></label>
        )}
        <p className="muted">
          {locked ? 'Share the password with the people you want in.' : 'Anyone can join until it fills up.'} You join as
          its first team.
        </p>
        <button disabled={busy}>{busy ? 'Creating…' : 'Create league'}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
      <p><Link to="/leagues" className="more">Join a league instead</Link></p>
    </section>
  );
}

/** On Home, for the league's creator (or an admin): rename, set or remove the password, delete while theirs is the only team. */
export function ManageLeague({ league, onChanged }: { league: LeagueListing; onChanged: () => void }) {
  const { isAdmin } = useAuth();
  const [name, setName] = useState(league.name);
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<void>, done: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      setMsg(done);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card">
      <summary>Manage {league.name}</summary>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void act(() => api.renameLeague(league.id, name), 'Renamed.'); }}>
        <label>League name<input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button className="secondary" disabled={busy || name.trim() === league.name}>Rename league</button>
      </form>
      <form className="row section" onSubmit={(e) => {
        e.preventDefault();
        void act(async () => { await api.setLeaguePassword(league.id, password); setPassword(''); }, 'Password saved.');
      }}>
        <label>{league.has_password ? 'New password' : 'Password'}
          <input required minLength={4} maxLength={40} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="secondary" disabled={busy}>{league.has_password ? 'Change password' : 'Add password'}</button>
        {league.has_password && (
          <button type="button" className="secondary" disabled={busy}
            onClick={() => void act(() => api.setLeaguePassword(league.id, null), 'Anyone can join now.')}>Remove password</button>
        )}
      </form>
      <div className="section">
        {league.teams === 1 ? (
          <button className="secondary" disabled={busy} onClick={() => {
            if (!window.confirm(`Delete ${league.name}? Your team and its credits go with it. This can't be undone.`)) return;
            void act(() => api.deleteLeague(league.id), 'Deleted.');
          }}>Delete league</button>
        ) : <p className="muted">{isAdmin ? 'Delete it from Admin → Leagues.' : 'Other teams have joined, so only an admin can delete this league.'}</p>}
      </div>
      {msg && <p className="muted" role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </details>
  );
}
```

- [ ] **Step 5: Routes, Home, and the old Join page**

`src/app/App.tsx`:

```diff
@@ -1,10 +1,10 @@
-import { createHashRouter, RouterProvider } from 'react-router';
+import { createHashRouter, Navigate, RouterProvider } from 'react-router';
 import { AuthProvider } from './auth/AuthProvider';
 import { Layout } from './components/Layout';
 import { supabase } from './lib/supabase';
 import { AdminPage } from './pages/admin/AdminPage';
 import { HomePage } from './pages/HomePage';
-import { JoinPage } from './pages/JoinPage';
+import { CreateLeaguePage, LeaguesPage } from './pages/LeaguesPage';
 import { LoginPage } from './pages/LoginPage';
 import { MePage } from './pages/MePage';
 import { NotConfigured } from './pages/NotConfigured';
@@ -20,7 +20,9 @@ const router = createHashRouter([
     children: [
       { index: true, element: <HomePage /> },
       { path: 'login', element: <LoginPage /> },
-      { path: 'join', element: <JoinPage /> },
+      { path: 'leagues', element: <LeaguesPage /> },
+      { path: 'leagues/new', element: <CreateLeaguePage /> },
+      { path: 'join', element: <Navigate to="/leagues" replace /> },
       { path: 'admin', element: <AdminPage /> },
       { path: 'tally', element: <TallyPage /> },
       { path: 'stats', element: <StatsPage /> },
```

`src/app/pages/HomePage.tsx`:

```diff
@@ -3,7 +3,9 @@ import { Loading } from '../components/Loading';
 import { Link } from 'react-router';
 import { useAuth } from '../auth/AuthProvider';
 import { AuctionCard } from './AuctionCard';
+import { ManageLeague } from './LeaguesPage';
 import { TournamentCard } from './TournamentCard';
+import { api } from '../lib/rpc';
 import { supabase } from '../lib/supabase';
 import { useLoad } from '../lib/useLoad';
 import { balance, entryLabel, LEDGER_COLUMNS, type LedgerEntry } from '../lib/wallet';
@@ -21,9 +23,9 @@ interface MembershipRow {
 }
 
 export function HomePage() {
-  const { session, loading } = useAuth();
+  const { session, loading, isAdmin } = useAuth();
   const uid = session?.user.id;
-  const { data, error } = useLoad(async () => {
+  const { data, error, reload } = useLoad(async () => {
     if (!supabase || !uid) return [] as MembershipRow[];
     const { data, error } = await supabase
       .from('memberships')
@@ -32,6 +34,10 @@ export function HomePage() {
     if (error) throw error;
     return (data ?? []) as unknown as MembershipRow[];
   }, [uid]);
+  // For Manage league (its creator, or an admin: older leagues have no creator) and the create limit (t215).
+  const listed = useLoad(async () => (uid ? api.listLeagues() : undefined), [uid]);
+  const manageable = (leagueId: string) => listed.data?.find((l) => l.id === leagueId && (l.is_creator || isAdmin));
+  const canCreate = isAdmin || !listed.data?.some((l) => l.is_creator);
 
   if (loading) return <Loading />;
   if (!session) {
@@ -60,8 +66,12 @@ export function HomePage() {
       {!data && !error && <Loading />}
       {data && data.length === 0 && (
         <div className="card">
-          <p>You're not in a league yet. Ask your league admin for an invite code.</p>
-          <Link to="/join" className="button">Join with an invite code</Link>
+          <h2>Get started</h2>
+          <p>Join a league someone has already made, or create your own and invite people.</p>
+          <div className="row">
+            <Link to="/leagues" className="button">Join a league</Link>
+            <Link to="/leagues/new" className="button secondary">Create a league</Link>
+          </div>
         </div>
       )}
       {data?.map((m) => {
@@ -77,19 +87,29 @@ export function HomePage() {
             {wallet}
           </article>
         );
-        if (!m.leagues || !uid) return <Fragment key={m.id}>{team}</Fragment>;
+        const mine = manageable(m.league_id);
+        const manage = mine && <ManageLeague league={mine} onChanged={() => { reload(); listed.reload(); }} />;
+        if (!m.leagues || !uid) return <Fragment key={m.id}>{team}{manage}</Fragment>;
         return (
-          <TournamentCard key={m.id} membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues.season_id}
-            teamName={m.team_name} subtitle={subtitle}>
-            <AuctionCard membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues.season_id} userId={uid}
-              joinedAt={m.created_at}
-              teamName={m.team_name} wallet={wallet}
-              team={<Wallet entries={m.credit_ledger} className="card"
-                summary={<>Credits <span className="big credits-sum">{balance(m.credit_ledger)}</span></>} />} />
-          </TournamentCard>
+          <Fragment key={m.id}>
+            <TournamentCard membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues.season_id}
+              teamName={m.team_name} subtitle={subtitle}>
+              <AuctionCard membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues.season_id} userId={uid}
+                joinedAt={m.created_at}
+                teamName={m.team_name} wallet={wallet}
+                team={<Wallet entries={m.credit_ledger} className="card"
+                  summary={<>Credits <span className="big credits-sum">{balance(m.credit_ledger)}</span></>} />} />
+            </TournamentCard>
+            {manage}
+          </Fragment>
         );
       })}
-      {data && data.length > 0 && <p><Link to="/join" className="more">Join another league</Link></p>}
+      {data && data.length > 0 && (
+        <p className="row">
+          <Link to="/leagues" className="more">Join another league</Link>
+          {canCreate && <Link to="/leagues/new" className="more">Create a league</Link>}
+        </p>
+      )}
     </section>
   );
 }
```

Delete the invite-code page: `git rm src/app/pages/JoinPage.tsx`

- [ ] **Step 6: Run tests, types, lint**

Run: `npx vitest run src/app/pages/LeaguesPage.test.tsx src/app/lib/errors.test.ts && npx tsc --noEmit -p .`
Expected: tests PASS. tsc FAILS only in `src/app/pages/admin/LeaguesPanel.tsx` (it still calls `api.createLeague` / `api.createInvite`) — Task 3 fixes that; nothing else may fail.

- [ ] **Step 7: Commit**

```bash
git add src/app/lib/rpc.ts src/app/lib/errors.ts src/app/lib/errors.test.ts src/app/pages/LeaguesPage.tsx src/app/pages/LeaguesPage.test.tsx src/app/App.tsx src/app/pages/HomePage.tsx
git commit -m "Open leagues: Join a league list with search, Create a league, Manage league, Get started on Home (t215)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Admin league list, retire invite codes, docs

**Files:**
- Modify: `src/app/pages/admin/LeaguesPanel.tsx` (full rewrite: list + creator + Delete; no invites, no New league)
- Create: `src/app/pages/admin/LeaguesPanel.test.tsx`
- Delete: `src/app/lib/codes.ts`, `src/app/lib/codes.test.ts` (only the invite UI used `randomCode`)
- Modify: `src/app/pages/RulesPage.tsx`, `src/app/tokens.css` (comments), `DESIGN.md`, `PRODUCT.md`, `docs/setup-supabase.md`
- Modify: `docs/superpowers/specs/2026-10-06-open-leagues-design.md` (amendments)

**Interfaces:**
- Consumes: `api.deleteLeague(leagueId: string): Promise<void>` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `src/app/pages/admin/LeaguesPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/rpc';
import { LeaguesPanel } from './LeaguesPanel';

const ROWS: Record<string, unknown[]> = {
  leagues: [
    { id: 'l1', name: 'Huck Yeah', created_by: 'u1', memberships: [{ id: 'm1', team_name: 'Zips' }, { id: 'm2', team_name: 'Hucks' }] },
    { id: 'l2', name: 'League A', created_by: null, memberships: [] },
  ],
  profiles: [{ id: 'u1', display_name: 'Alice' }],
};
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder, in: () => builder,
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: ROWS[table], error: null }),
      };
      return builder;
    },
  },
}));
vi.mock('../../lib/rpc', () => ({ api: { deleteLeague: vi.fn(() => Promise.resolve()) } }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('LeaguesPanel (t215)', () => {
  it('lists every league with its creator and teams, and no invite codes', async () => {
    render(<LeaguesPanel seasonId="s1" />);
    expect(await screen.findByText('by Alice · 2 teams')).toBeTruthy();
    expect(screen.getByText('by An admin · 0 teams')).toBeTruthy();
    expect(screen.getByText('Zips, Hucks')).toBeTruthy();
    expect(screen.queryByText(/invite/i)).toBeNull();
  });

  it('deletes a league only after the confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<LeaguesPanel seasonId="s1" />);
    const del = await screen.findByRole('button', { name: 'Delete Huck Yeah' });
    fireEvent.click(del);
    expect(api.deleteLeague).not.toHaveBeenCalled();
    fireEvent.click(del);
    await waitFor(() => expect(api.deleteLeague).toHaveBeenCalledWith('l1'));
    expect(confirm.mock.calls[0][0]).toMatch(/^Delete Huck Yeah\? Its 2 teams/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/app/pages/admin/LeaguesPanel.test.tsx`
Expected: FAIL — no "by Alice · 2 teams" text; an invite button is present.

- [ ] **Step 3: Rewrite the panel and delete the code helper**

Replace `src/app/pages/admin/LeaguesPanel.tsx` with:

```tsx
import { useState } from 'react';
import { Loading } from '../../components/Loading';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

interface LeagueRow {
  id: string;
  name: string;
  created_by: string | null;
  memberships: { id: string; team_name: string }[];
}

/** Every league of the season, with who made it (t215). Anyone creates leagues on /leagues/new; admins delete here. */
export function LeaguesPanel({ seasonId }: { seasonId: string }) {
  const [error, setError] = useState<string | null>(null);
  const leagues = useLoad(async () => {
    const { data, error } = await supabase!
      .from('leagues')
      .select('id, name, created_by, memberships(id, team_name)')
      .eq('season_id', seasonId)
      .order('name');
    if (error) throw error;
    const rows = (data ?? []) as LeagueRow[];
    // created_by points at auth.users, which the API can't embed, so names come from profiles.
    const ids = [...new Set(rows.flatMap((l) => (l.created_by ? [l.created_by] : [])))];
    const names = new Map<string, string>();
    if (ids.length) {
      const res = await supabase!.from('profiles').select('id, display_name').in('id', ids);
      if (res.error) throw res.error;
      for (const p of res.data as { id: string; display_name: string }[]) names.set(p.id, p.display_name);
    }
    return rows.map((l) => ({ ...l, creator: l.created_by ? names.get(l.created_by) ?? 'Unknown' : 'An admin' }));
  }, [seasonId]);

  async function remove(l: LeagueRow) {
    const teams = l.memberships.length;
    if (!window.confirm(`Delete ${l.name}? Its ${teams} ${teams === 1 ? 'team' : 'teams'}, their credits, bids and rosters go with it. `
      + "This can't be undone.")) return;
    setError(null);
    try {
      await api.deleteLeague(l.id);
      leagues.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <h2>Leagues</h2>
      <p className="muted">Anyone signed in can create a league (one per season) or join one from the Join a league page.</p>
      {!leagues.data && !leagues.error && <Loading />}
      {leagues.data?.length === 0 && <p className="muted">No leagues in this season yet.</p>}
      <ul className="list">
        {leagues.data?.map((l) => (
          <li key={l.id}>
            <span className="meta">
              <span className="title">{l.name}</span>
              <span className="muted">by {l.creator} · {l.memberships.length} {l.memberships.length === 1 ? 'team' : 'teams'}</span>
            </span>
            <button className="secondary" aria-label={`Delete ${l.name}`} onClick={() => void remove(l)}>Delete</button>
            {l.memberships.length > 0 && <small className="muted">{l.memberships.map((m) => m.team_name).join(', ')}</small>}
          </li>
        ))}
      </ul>
      {(error || leagues.error) && <p className="error" role="alert">{error ?? leagues.error}</p>}
    </div>
  );
}
```

Then: `git rm src/app/lib/codes.ts src/app/lib/codes.test.ts`

- [ ] **Step 4: Copy and docs**

`src/app/pages/RulesPage.tsx`:

```diff
@@ -42,6 +42,8 @@ export function RulesPage() {
         <ul>
           <li>The league runs all season, and the season is split into <strong>tournaments</strong>, the events our
             team plays.</li>
+          <li>Anyone can create a league, open to all or with a password, or join one from the list. You can create one
+            league a season.</li>
           <li>Each league has up to {S.max_members} teams. Every game our team plays at a tournament, every fantasy
             team plays one head-to-head matchup. Standings never reset between tournaments.</li>
           <li>Rosters are rebuilt for every tournament in a fresh auction. Each roster holds {S.roster_size} players:{' '}
```

`src/app/tokens.css` (`.code` is now only the sign-in code):

```diff
@@ -64,7 +64,7 @@
   --button-case: uppercase;
   --button-track: 0.06em;
   --track-label: 0.06em;  /* small caps labels like LIVE */
-  --track-code: 0.08em;   /* invite codes */
+  --track-code: 0.08em;   /* sign-in codes */
   --font-mono: ui-monospace, 'Cascadia Mono', Consolas, monospace;
   --fw-regular: 400;
   --fw-medium: 500;
@@ -77,7 +77,7 @@
   --fs-xs: 13px;
   --fs-sm: 14px;
   --fs-md: 16px;
-  --fs-lead: 18px;  /* brand, hero text, invite codes, tally player names */
+  --fs-lead: 18px;  /* brand, hero text, sign-in codes, tally player names */
   --fs-lg: 20px;
   --fs-count: 24px; /* tally counts */
   --fs-brand: 24px;   /* display face */
```

`DESIGN.md`:

```diff
@@ -67,7 +67,7 @@ Two faces, both from Google Fonts in `index.html` (`display=swap`):
 
 Font tokens: `--font-sans` (Archivo stack), `--font-heading` (points at `--font-sans`) with `--heading-stretch`
 92% so headings and the brand use a slightly condensed cut, and `--font-mono` only for `code`, the settings
-textarea and `.code` (invite codes). Weights come from four tokens: `--fw-regular` 400 (body), `--fw-medium` 500,
+textarea and `.code` (sign-in codes). Weights come from four tokens: `--fw-regular` 400 (body), `--fw-medium` 500,
 `--fw-semi` 600 (buttons, labels, pills, row titles) and `--fw-bold` 700 (`h2`, `h3`).
 Condensed headings take no negative letter-spacing; it closes the word gaps. To swap the font, change the link in
 `index.html` and the font lines in `tokens.css`.
@@ -86,7 +86,7 @@ Condensed headings take no negative letter-spacing; it closes the word gaps. To
 
 Body line height 1.5, headings 1.2 and balanced. Numbers that line up use `.num` or tabular figures.
 Smaller steps for single components are tokens too: `--fs-3xs` 11px (tally weights), `--fs-2xs` 12px (tally
-labels), `--fs-lead` 18px (brand, hero text, invite codes, tally player names), `--fs-count` 24px (tally counts).
+labels), `--fs-lead` 18px (brand, hero text, sign-in codes, tally player names), `--fs-count` 24px (tally counts).
 `src/app/tokens.test.ts` fails if `styles.css` gains a colour, font size, font family, radius or duration literal.
 
 ## Space and shape
```

`PRODUCT.md`:

```diff
@@ -11,7 +11,7 @@ web
 - **Managers**: members of the college ultimate team who buy credits, bid on teammates ("athletes") in a tournament auction, and manage a fantasy roster across the season.
 - **Athletes**: team members who opt in to be draftable; their tournament game stats drive fantasy scoring.
 - **Stat keepers / coaches**: tap in live stats (goals, assists, blocks, callahans, turnovers) during tournament games via a big-button tally screen; cannot record or verify their own athletes.
-- **Admins**: run seasons/tournaments, settings, invite codes, leagues, and confirmed-donation bookkeeping (treasurer role).
+- **Admins**: run seasons/tournaments, settings, deleting leagues, and confirmed-donation bookkeeping (treasurer role).
 - **League viewers**: see stat lines once verified and league standings.
 
 ## Product Purpose
```

`docs/setup-supabase.md` (append at the end):

```diff
@@ -199,3 +199,13 @@ Stop all email at any time: `select cron.unschedule('notify');`. If the pick tri
 2. Deploy (merge + push): Admin → Seasons gets "Rename or delete <season>" for the season being managed. Delete
    unlocks once the season's name is typed, removes everything in the season, and is refused for a season with
    donation records. Download a backup first. Deleting the newest season moves everyone to the next newest.
+
+## Open leagues (t215, after 0018)
+
+1. SQL Editor: paste and run `supabase/migrations/0019_open_leagues.sql`. It adds `leagues.created_by`, a private
+   password table and six RPCs (`list_leagues`, `create_my_league`, `join_open_league`, `rename_league`,
+   `set_league_password`, `delete_league`); the old invite-code functions stay. Paste it BEFORE the deploy: the new
+   build calls `list_leagues` on Home.
+2. Deploy (merge + push): Home offers Join a league (`/leagues`, searchable, "N of M teams") and Create a league
+   (`/leagues/new`, public or password). One created league per person per season (admins exempt). The creator
+   manages it from Home; Admin → Leagues lists every league with Delete (refused when it has donation records).
```

Append to the spec `docs/superpowers/specs/2026-10-06-open-leagues-design.md`:

```markdown

## 8. Amendments (planning, 2026-10-06)

1. **Admins also get Manage league on Home** for any league they're in, not only creators: leagues made before
   0019 (the live League A) have no creator and would otherwise be public with no way to add a password. An admin
   sees "Delete it from Admin → Leagues." instead of the creator's delete rule.
2. **Delete confirms with `window.confirm`** (like tournaments and athletes), not a typed name.
3. **Admin → Leagues shows creator and teams, not Public/Password**: admins can't read `private.league_passwords`
   and `list_leagues` covers only the current season; the panel works for any selected season.
4. **Home's Create a league link** hides once `list_leagues` shows you created one (admins always see it). The
   Get started card is plain links and has no unit test.
5. **Removed**: `JoinPage.tsx`, `lib/codes.ts`, the invite-code error messages (`INVALID_INVITE`,
   `INVALID_INVITE_SETTINGS`, `INVALID_CODE`, `CODE_TAKEN`); `/join` redirects to `/leagues`.
6. **Locked leagues show a "Password" pill**, no lock icon (text is clearer and needs no new asset).
7. **Tests**: PGlite loads `@electric-sql/pglite/contrib/pgcrypto`; the shim creates schema `extensions`.
   `list_leagues` is in the gate's read-only list (it writes nothing).
```

- [ ] **Step 5: Full check**

Run: `npx tsc --noEmit -p . && npx eslint src tests && npx vitest run src && npm run build`
Expected: all green (draft: 42 files / 267 tests under src; tokens.test passes).

- [ ] **Step 6: Commit**

```bash
git add -A src/app docs DESIGN.md PRODUCT.md
git commit -m "Open leagues: admin league list with Delete, invite codes retired, docs (t215)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Controller wrap-up (not a subagent task)

1. `git diff open-leagues-verified-draft -- . ':!docs/superpowers'` is empty (or every difference is a reviewed ruling).
2. Whole-branch final review (opus), fix wave if needed.
3. Visual check in the preview (signed in): Home Get started, `/leagues` at 375px, `/leagues/new`, Manage league, Admin → Leagues.
4. Go-live, in order: rebase `open-leagues` on `origin/main`; the user pastes `0019_open_leagues.sql` into tribe-dev
   FIRST; anon probe (`list_leagues`, `create_my_league` → 42501); merge + push only with the user's OK; tag
   `m11-leagues` (`git push origin refs/tags/m11-leagues`); CI + Deploy green; live bundle has `list_leagues`;
   board t215 done; delete `open-leagues-verified-draft`; `graphify update .` (copy graph in/out as before); remove the worktree.
5. Tell the user: League A becomes public until they add a password from Home → Manage League A.

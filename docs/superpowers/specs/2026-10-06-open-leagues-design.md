# Open leagues — design

Date: 2026-10-06 · Status: APPROVED 2026-10-06 · Board: t215+ · Migration: 0019 · Tag: m11-leagues

## 1. Goal

Anyone signed in can make or join a league; only admins make seasons. On first sign-in a person
chooses **Create a league** or **Join a league**. Leagues are public (no password) or password
protected. Everyone sees a searchable list of the current season's leagues with "N of M teams".

## 2. User rulings (2026-10-06)

- **Privacy: accepted.** `can_read_league_data()` = member of *any* league or staff, so anyone who
  signs up and joins/creates a league can read all athletes, stats, profiles and rosters. Team data
  isn't sensitive; no per-league RLS rewrite.
- **Invite codes retired** from the app. Joining is only through the league list (+ password).
- **Creator + admins** manage a league: creator renames, changes/removes the password, deletes it
  while they're the only team. Admins delete any league and see a list of all leagues.
- **Late joins as today:** a team that joins after `run_auction` has an empty roster until the
  next tournament's auction.
- **Create limit:** one created league per person per season; admins exempt.

## 3. Database — `0019_open_leagues.sql`

### Tables
- `leagues.created_by uuid references auth.users (id) on delete set null` (null for old leagues).
- `private.league_passwords (league_id uuid primary key references public.leagues on delete cascade,
  hash text not null)`. No row = public league. Lives in `private` (not API-exposed) because
  `leagues_read` is `using (true)` — a hash column on `leagues` would be readable by everyone.
- `create extension if not exists pgcrypto with schema extensions;` (already there on Supabase;
  the PGlite test shim loads it). Hash = `extensions.crypt(pw, extensions.gen_salt('bf'))`.

### "Current season"
Newest season by `created_at` — same rule as the app's `loadCurrentSeason`. A private helper
`private.current_season()` returns its id or raises `NO_SEASON`.

### RPCs (all `security definer`, `search_path = ''`, audited, stable error codes)

| RPC | Who | Does | Errors |
|---|---|---|---|
| `list_leagues()` → table(id, name, teams, max_teams, has_password, is_member, is_creator) | any signed-in user | current season's leagues, ordered by name; `max_teams` = season `max_members` | `NO_SEASON` |
| `create_my_league(p_name, p_password, p_team_name)` → league id | user with a profile | creates league in current season, stores hash when `p_password` not null/blank, inserts creator's membership | `NO_PROFILE`, `NO_SEASON`, `INVALID_NAME`, `INVALID_TEAM_NAME`, `INVALID_PASSWORD`, `LEAGUE_EXISTS`, `CREATE_LIMIT` |
| `join_open_league(p_league, p_password, p_team_name)` → membership id | user with a profile | same checks/locking as `join_league` (league row `for update`, then ALREADY_MEMBER, LEAGUE_FULL, TEAM_NAME_TAKEN) plus the password check; league must be in the current season | `NO_PROFILE`, `NOT_FOUND`, `INVALID_TEAM_NAME`, `WRONG_PASSWORD`, `ALREADY_MEMBER`, `LEAGUE_FULL`, `TEAM_NAME_TAKEN` |
| `rename_league(p_league, p_name)` | creator or admin | rename | `NOT_FOUND`, `NOT_LEAGUE_OWNER`, `INVALID_NAME`, `LEAGUE_EXISTS` |
| `set_league_password(p_league, p_password)` | creator or admin | null/blank = make public (delete row), else upsert hash | `NOT_FOUND`, `NOT_LEAGUE_OWNER`, `INVALID_PASSWORD` |
| `delete_league(p_league)` | admin: any league; creator: only while they're the only team | cascade delete | `NOT_FOUND`, `NOT_LEAGUE_OWNER`, `LEAGUE_HAS_TEAMS`, `LEAGUE_HAS_DONATIONS` |

Rules:
- Password: 4–40 characters after trim; blank = public. The audit row never contains it.
- Password check order in `join_open_league`: ALREADY_MEMBER and LEAGUE_FULL first (they don't
  need the password), then WRONG_PASSWORD, then the insert. A public league ignores `p_password`.
- `CREATE_LIMIT`: non-admin already has a league with `created_by = uid` in the current season.
  Deleting it frees the slot.
- `LEAGUE_HAS_DONATIONS`: any `credit_ledger` row of kind donation for a membership of the league
  (memberships cascade into the ledger, so deleting would erase donation records) — same ruling
  as `delete_season`. Lock the ledger the way `delete_season` does (`share mode`).
- Owner = `leagues.created_by = uid` or `is_admin()`. Old leagues (created_by null) are admin-only.
- Old `create_league(season, name)`, `create_invite`, `join_league(code)` stay in SQL, unused by
  the app (DB test fixtures use them; codes can only be minted by admins, so they're harmless).
- Grants: re-run the "authenticated only" function-grant block at the end. All six new RPCs are
  member-callable (owner/admin checks happen inside), so they join the rpc-gate test's
  member-callable list; anon gets 42501.
- `delete_league` audit row carries name + counts (memberships, ledger rows), like `delete_season`.

## 4. App

- **Onboarding.** Layout's first-sign-in name screen is unchanged. HomePage with zero memberships
  replaces "Join with an invite code" with a **Get started** card: two buttons, **Join a league**
  (`/leagues`) and **Create a league** (`/leagues/new`).
- **`/leagues` — LeaguesPage.** Search input (`type="search"`, case-insensitive substring on the
  name, client-side over `list_leagues()`), then a list: name, "N of M teams", lock icon + "Password"
  label for locked leagues, "Full" or "Joined" tag. Tapping a joinable row expands an inline form:
  team name, password (only when locked), **Join league**. Success → `/`. Empty state: "No leagues
  yet — create the first one." with the create link. `/join` redirects to `/leagues`.
- **`/leagues/new` — CreateLeaguePage.** League name, your team name, Public / Password (radio);
  password field appears for Password. Success → `/`.
- **Home with memberships.** Footer links "Join another league" (`/leagues`) and "Create a league"
  (hidden when `list_leagues` shows the user already created one this season and isn't admin —
  the server still enforces it). Each league the user created gets a folded **Manage league**
  `<details>` under its cards: rename, set/remove password, delete (typed-name confirm like
  SeasonsPanel; shown only while they're the only team).
- **Admin → Leagues.** LeaguesPanel lists every league of the selected season: name, teams
  (names), creator's display name (or "admin" for old ones), Public/Password, **Delete** (confirm).
  Invite codes and the "New league" form are removed. Admins create leagues through `/leagues/new`
  like everyone else.
- **Copy.** errors.ts entries for every new code; RulesPage line on how leagues are made/joined;
  DESIGN.md "Words" stays (league, team). New UI follows DESIGN.md + tokens.css (no raw values).

## 5. Pitfalls (accepted)

- **Password guessing:** `join_open_league` can be called in a loop. bcrypt makes each try slow;
  league passwords guard no money. No rate limit.
- **Athlete supply:** every league drafts from the same opted-in pool and needs 24 athletes.
- **Privacy:** see §2 — any signed-up person can read team data.
- **Season switch:** `list_leagues` shows only the newest season; creating a test season hides
  the real leagues (same as today's Home).

## 6. Testing

- DB (PGlite, `tests/db/open-leagues.test.ts`): each RPC's happy path and every error code;
  hash never readable by `authenticated` (`private` schema); list counts and flags; creator vs
  admin vs stranger on rename/password/delete; CREATE_LIMIT freed by delete; donation guard;
  concurrent last-spot covered by the same lock as `join_league`. rpc-gate updated.
- App: LeaguesPage filter + join (locked/public/full), CreateLeaguePage (password toggle),
  HomePage Get started card, LeaguesPanel without invites. Existing tests that mock `joinLeague`
  or invite UI updated.
- Shim: PGlite constructed with the pgcrypto extension; `tests/db/shim.sql` creates schema
  `extensions`.

## 7. Go-live

User pastes 0019 into tribe-dev FIRST (the new build calls `list_leagues`), anon probe (42501 on
the new RPCs), then merge + push with OK, tag `m11-leagues`, board tasks done, graph refresh,
remove worktree `Tribe-Fantasy-leagues`.

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

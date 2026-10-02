# Tournament mode: one-on-one game matchups

Agreed with the user on 2026-10-02. Taking stats at practices proved unrealistic, so **each stage is now one
tournament** and managers play head-to-head **per tournament game** instead of per week. It supersedes the weekly
parts of `2026-09-27-m6-weekly-design.md` (weeks, pick lock day/time, no-repeat cycle, weekly schedule) and the
"weekly head-to-head" line of `2026-09-25-year-stages-revision.md` §1. Everything else holds: the stage auction
(M5), allowances at checkpoints, the wallet, the tally screen, verification and locking (M3), rank-weighted points,
and the cross-stage degradation (revision §4).

## 1. Decisions

| Question | Decision |
|---|---|
| League shape | 6 managers × 4 athletes: **3 active + 1 bench** (`roster_size` 4, new `bench_size` 1) |
| Matchup unit | one **game** of the real team at the tournament; each manager starts one active athlete |
| Next opponent | **Swiss** by standings, avoiding rematches |
| Pairing data | the **live tally** (provisional). Pairings freeze when made; official points come later from locked stats |
| Pick lock | the keeper **starts the game** on the tally screen; blanks are auto-picked then |
| Pre-selecting | a manager may set the pick for the next game at any time before it starts, even before the pairing exists |
| Repeats | allowed, with **tiredness**: ×0.5 if the athlete started the previous game, ×0.75 two games ago, ×1 after that |
| Bench | used only for injury: with a confirmed injury on an active athlete, the manager swaps the bench in for the rest of the tournament |
| Old degradation | **kept**: matchup score = game score × tiredness × stage decay |
| Standings | carry over all year; allowance + fresh auction after each tournament (unchanged) |
| Practices | no longer scored; only game sessions count |
| First real tournament | **Nov 7–8**. Oct 17–18 is a dry run of the tally screen only (no visual tally changes on tournament days) |
| Win probability | later, once there are stats to fit; nothing here blocks it |

## 2. Rules as code runs them

**Games.** A stage has games numbered 1, 2, 3… Each game has a pairing per league, then a stat session once it
starts. Status: `upcoming` (paired, not started) → `live` (started: picks locked) → `pending` (finished, stats not
yet all locked) → `final`. As in M6, a game that isn't final holds back every later game, so rank snapshots build in
order. A game that never starts (the tournament ended) is ignored.

**Flow at the tournament.**
1. Admin **opens the tournament** after the auction: game 1 is created and paired by the year standings.
2. Managers see their opponent and pick (or keep a pre-selected pick).
3. Keeper taps **Start game 1**: a `tournament` session is created and linked to the game, and picks lock. Anyone
   without a valid pick is auto-picked.
4. Keepers tally as now.
5. Keeper taps **Finish game 1**: the keeper's browser computes provisional standings (verified lines where they
   exist, merged live taps otherwise) and the Swiss pairing for game 2, which is frozen. Back to step 2.
6. After the tournament, sessions are verified and lock as usual (M3); official results and standings follow.

**Active athletes.** The roster minus the bench. Before game 1 starts the manager chooses the bench athlete; if they
don't, it's the athlete with the lowest auction price (ties → lowest athlete id). A bench swap (§1) takes effect from
the next game that hasn't started; the injured athlete moves to the bench for the rest of the stage.

**Effective pick** (as of the game's start):
1. The manager's pick stands if it is an active athlete and not injured at the start.
2. Otherwise auto-pick from the active athletes healthy at the start (if none, all active ones), with a notice:
   `missed`, `injured` or `inactive`. The order is **rested first**: highest tiredness multiplier, then the best
   average of the athlete's last 3 settled game scores, then lowest athlete id. So an auto-pick never tires a player
   when a rested one exists. `default_pick = forfeit` or no candidate → forfeit (score 0).

**Tiredness.** `gap` = this game's number minus the number of the last game in this stage in which this manager
started this athlete. `m = tiredness_multipliers[gap − 1]`, or 1 if the gap is past the list or the athlete hasn't
started this stage. Default list `[0.5, 0.75]`: cycling all three active athletes never triggers it. A start counts
whatever happened in the game, even if the athlete got hurt and didn't play.

**Scoring a final game.** Athlete game score = `athleteWeekScore` over that game's locked stat line (one session).
Matchup score = game score × tiredness × `stageMultiplier`. Points use the existing rank-weighted formula, ranks
from the official standings after the previous final game.

**Swiss pairing** (`swissPairings`, pure): order teams by (points desc, total score desc, id). Choose the pairing
with the fewest rematches (counting how often each pair has already met in the year), then the smallest total
rank distance, then the first in standings order. With an odd count, a phantom "bye" joins the search and a repeated
bye counts as a rematch. Leagues are ≤ 8 teams, so trying every pairing (≤ 105) is fine. Game 1 of the first
tournament: everyone is tied, so the order falls back to id.

**Provisional standings** (for pairing only): the same scorer run over finished games of the stage, using verified
lines where they exist and `mergeTaps` totals otherwise, on top of the official year standings. They are never shown
as standings.

## 3. Settings

- Add `bench_size` (int 0–5, default 1, must be < `roster_size`).
- Add `tiredness_multipliers` (array of 0–10 numbers in [0, 1], default `[0.5, 0.75]`).
- Retire `pick_lock_day`, `pick_lock_time`, `usage_reset` in the migration that removes the weekly UI (they stay
  until then so the deployed build keeps working).

## 4. Data (migration `0012_tournament.sql`, additive)

```
games          id, stage_id → stages (cascade), number int ≥ 1, session_id → sessions null unique,
               started_at null, finished_at null, created_at; unique (stage_id, number)
game_pairings  game_id → games (cascade), league_id, home → memberships, away → memberships null;
               unique (game_id, home), unique (game_id, away)
game_picks     stage_id, game_number, membership_id → memberships (cascade), league_id, athlete_id, updated_at;
               primary key (stage_id, game_number, membership_id)   — no FK to games, so pre-selection works
roster_slots   + bench bool not null default false
bench_swaps    id, stage_id, membership_id, out_athlete, in_athlete, from_game int, created_at
```

RLS: games, pairings, bench and swaps readable by every signed-in user; picks as in M6 (own rows; league + staff once
that game has started).

| RPC | Who | Behaviour |
|---|---|---|
| `open_tournament(stage, pairings)` | admin | creates game 1 with the given pairings; `GAMES_EXIST` if any game exists |
| `start_game(game)` | keeper, admin | `PREVIOUS_GAME_LIVE` unless every earlier game is finished; creates the session, sets `started_at` |
| `finish_game(game, pairings, provisional)` | keeper, admin | sets `finished_at`, creates the next game with the pairings; `provisional` copied into the audit row |
| `set_game_pick(membership, stage, number, athlete \| null)` | own membership | `PICK_LOCKED` once that game has started; `NOT_ON_ROSTER` |
| `set_bench(membership, stage, athlete)` | own membership | before game 1 starts only (`TOURNAMENT_STARTED`) |
| `swap_bench(membership, stage, injured_athlete)` | own membership | `NOT_INJURED` unless a confirmed injury is active now; once per stage |

Pairing checks in SQL: each league's memberships (joined before the game) appear exactly once, at most one bye.
Swiss itself runs in the browser, as allocation does; the audit row lets anyone re-run it.

## 5. Core (`src/core`)

- `tiredness.ts`: `tirednessMultiplier(gap | null, s)`.
- `swiss.ts`: `swissPairings(order, meetings) → Pairing[]`.
- `picks.ts`: `autoPick(candidates, tiredness, history, s)` (rested first); the no-repeat cycle goes with the
  weekly code.
- `tournament.ts`: `scoreTournaments(input)` replaces `scoreYear`: games instead of weeks, active/bench, tiredness,
  same standings output. `provisionalStandings(...)` for pairing.
- `simulate.ts`: one tournament of N games with Swiss pairing, to tune tiredness and `upset_k`.

## 6. UI (DESIGN.md + tokens.css only)

- **League tab → This game**: opponent (or "Pairing after game 2 finishes"), the three active athletes with
  tiredness badges ("Tired ×0.5"), bench shown apart with **Swap in** when an active athlete is injured, tap to
  pick. Pre-select works the same way before the pairing is known.
- **Tally**: **Start game N** / **Finish game N** on the top bar; Finish shows the next pairings before confirming.
- **Admin → Stages**: **Open tournament**.
- **Results**: games list replaces weeks; detail per matchup as in M6 plus the tiredness factor.
- **Rules page** rewritten for tournament play.

## 7. Pitfalls

- **HIGH keeper is also a manager:** the browser that finishes a game proposes the pairing. Mitigated by SQL shape
  checks, the audit row with its inputs, and a staff "Check pairing" re-run. Prefer keepers who don't manage.
- **MED live tally ≠ verified stats:** a later correction can flip a result after pairings were made. Accepted:
  pairings never re-run; points do.
- **MED nobody taps Finish:** the next game can't be paired. Start game N+1 refuses until game N is finished, and
  the tally screen nags.
- **LOW unknown game count:** brackets vary, so games are created one at a time; the last created game may never start.

## 8. Build order (target: auction Nov 2–5, tournament Nov 7–8)

| Step | Scope | By |
|---|---|---|
| T1 Core | settings, tiredness, Swiss, auto-pick, `scoreTournaments`, provisional standings, simulator | Oct 9 |
| T2 Database | `0012_tournament.sql`, RPCs, RLS, PGlite tests | Oct 16 |
| — | Oct 17–18: tally dry run on the current app, no tally changes | |
| T3 App | This game card, tally Start/Finish, open tournament, results, rules page | Oct 26 |
| T4 Retire weekly | remove weekly UI, retire the old settings keys, full dry run on fake data | Oct 30 |

## Out of scope

Win probabilities (needs a season of game stats), live provisional points shown to managers, multiple real
teams at one tournament, trades.

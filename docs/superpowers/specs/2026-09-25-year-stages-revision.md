# Revision: league year with stages (checkpoints)

Agreed with the user on 2026-09-25. It supersedes the parts of `2026-09-25-tribe-fantasy-design.md` named below;
everything else there still holds. M3 (`2026-09-25-m3-stats-design.md`) is unaffected.

## 1. Structure

- **League year**: the existing `seasons` table (one row per school year). Weekly head-to-head runs all year.
  Standings (points and ranks) **never reset** within the year.
- **Stage**: a new `stages` table (`season_id`, `name`, `starts_on`, `ends_on`, `tournament`). Each stage lasts about
  2–3 weeks and ends at a tournament. The UI calls stages "seasons".
- 2026–27 stages: **fall beta** (auction Oct 18–19, weeks Oct 19–25, Oct 26–Nov 1, Nov 2–8; ends at the Nov 7–8
  tournament); **spring 1–3** (dates TBD by the user); **postseason** (covers 2–3 tournaments).
- There are no matchups over winter break. A week with no counted session is skipped, not scored as absent.
- The tournament week's stats count ×2 (the existing `session_multipliers`).

## 2. League size (replaces "roster 5")

- New setting `max_members` (default 6). `roster_size` default changes 5 → 4. The intended pairs are 6 × 4 and 8 × 3.
- `join_league` refuses when a league already has `max_members` memberships (`LEAGUE_FULL`).
- The auction refuses to start unless `managers × roster_size ≤ opted-in athletes` (exclusive ownership).

## 3. Checkpoints (end of each stage)

1. **Allowance.** Each manager is credited `allowance_base + allowance_gap × (rank − 1) / (n − 1)` credits, using the
   rank at the checkpoint (1 = best; tied ranks share their average; n < 2 → `allowance_base`). Defaults: base 100,
   gap 30. At the first stage everyone is tied, so everyone gets base + gap/2 = 115.
2. **Wallet.** Credits are one ledger per membership. Allowances and confirmed donations add; winning bids subtract.
   Unspent credits carry over to later stages.
3. **Fresh auction.** Every roster empties, and all opted-in athletes return to the pool. Allocation is the existing
   §5.5 auction plus leftover fill, run once per stage.

## 4. Degradation (replaces §5.2 and §5.4)

Tracked per **manager + athlete pair** across the whole year:

```
s = number of earlier stages in which this manager started this athlete at least once
m = max(decay_floor, decay_rate ^ max(0, s − decay_grace_stages))      (decay_mode exponential)
matchup score = athlete week score × m
```

Defaults: `decay_grace_stages` 1, `decay_rate` 0.9, `decay_floor` 0.6. Owning an athlete without starting them doesn't
count, and neither do stages where another manager owned them. The anti-collusion return window (§5.4) and
`decay_return_window` are removed. `decay_grace_weeks` is renamed to `decay_grace_stages`.

## 5. Points (amends §5.3)

The same rank-weighted formula, using ranks that carry across stages. The `upset_k` default changes 1 → 2 so rank
disparity swings results harder. Tune it with the simulator before the beta. If a linear curve isn't enough, add an
exponent setting then, not before.

## 6. Money and prize (amends §5.9 and the pitfalls)

- Everyone plays free on the allowance. `min_credits_to_play` and "activation" are removed.
- Donations still add credits at `credits_per_dollar` (20), uncapped (the user's decision). In the beta, donation
  recording is **off** (`donations_enabled` false) until the legal sign-off.
- The year-end prize is **merch, not money**. With free play this removes most lottery risk. The remaining question
  is paid credits improving odds at a prize: one check with club sports / student legal before donations go on.
  The pitfall drops from CRITICAL to HIGH.

## 7. Removed

- **Trades (old M7)**: offers, review window, veto, deadline, `trade_review_hours`, `trade_keeps_usage`.
  Revisit after the beta if players ask.
- `usage_reset` stays `cycle`, but now resets every stage, because rosters are rebuilt each stage.

## 8. Pitfalls added

- **HIGH tanking:** losers get more credits and underdog wins pay more, so losing on purpose can pay once a stage
  is decided. Keep `allowance_gap` small, and check it in the simulator.
- **HIGH athlete supply:** each league needs `max_members × roster_size` (24) opted-in athletes.
- **MED small samples:** a 2–3 week stage is a handful of sessions, so steep rank swings amplify noise.

## 9. Build order (replaces §8)

| Milestone | Scope | Dates |
|---|---|---|
| M3 Stats | per `2026-09-25-m3-stats-design.md` | Sep 26–29 |
| M4 Stages + wallet | `stages`, credit ledger, checkpoint allowance run, donation records (treasurer confirms; off in beta), `max_members` | Sep 30–Oct 4 |
| M5 Stage auction | bid UI, close, allocation run + verify, leftovers, athlete-supply check | Oct 5–9 |
| M6 Weekly play | year schedule, picks + lock, scoring from locked counted stats, standings, stage degradation, injury re-pick rules, rescore after corrections | Oct 10–14 |
| M8 Hardening | security pass, simulator tuning (allowance gap, `upset_k`, decay), mobile polish, FAQ, full dry run on fake data | Oct 15–16 |
| — | buffer; tally the Oct 17–18 tournament with the real app | Oct 17–18 |
| Beta | fall beta stage | Oct 18–Nov 8 |

User inputs needed by about Oct 12: ≥ 24 opted-in athletes per league, stat keepers named, league member count
(6 or 8). Spring stage dates can come after the beta.

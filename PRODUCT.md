# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Managers**: members of the college ultimate team who buy credits, bid on teammates ("athletes") in a stage auction, and manage a fantasy roster week to week.
- **Athletes**: team members who opt in to be draftable; their practice/tournament performance drives fantasy scoring.
- **Stat keepers / coaches**: tap in live stats (goals, assists, blocks, callahans, turnovers) during practices and tournaments via a big-button tally screen; cannot record or verify their own athletes.
- **Admins**: run seasons/stages, settings, invite codes, leagues, and confirmed-donation bookkeeping (treasurer role).
- **League viewers**: see stat lines once verified and league standings.

## Product Purpose

A donation-funded fantasy league for a college ultimate team: managers bid credits (bought via real-money donations to the team fund) on their own teammates, draft rosters, and compete weekly head-to-head based on real practice/tournament stats. Success means the league runs engagingly through the season (managers active weekly) and raises meaningful donations for the team fund — both matter equally, not one at the expense of the other.

## Positioning

Unlike a generic fantasy sports app, the "athletes" are the users' own teammates, stats come from verified in-person tally by coaches/keepers (not public box scores), and all money in the system is a donation to the team — never cash prizes or payouts. That combination (peer-to-peer stakes, verified live stat entry, donation-only economics) is the mechanism a copycat couldn't drop in without also being a real team's internal fundraiser.

## Operating Context

- Runs in stages (~2-3 week blocks ending at tournaments) within a year-long league; a fresh credit auction happens each stage; standings and ranks never reset across stages.
- Stats are entered live at practices/tournaments on phones/tablets by keepers, then verified by a second person before they count toward league scoring.
- Money flows only as donations recorded by admins/treasurer against a university club-sports or student-org giving channel — never a personal payment account.
- Deployed as a public GitHub Pages SPA (hash routing) backed by Supabase (Postgres + auth + RLS); all writes go through security-definer RPCs.

## Capabilities and Constraints

- Auth: magic link or 6-digit code (Supabase, PKCE).
- Roles enforced server-side via RLS: admin, coach/stat-keeper, player (linked athlete), league member, public.
- Scoring: per-point-played (configurable normalize_mode), tournaments weighted x2, rank-weighted win/loss points (underdog wins pay more, curve still being tuned), degradation per manager + athlete: the more earlier stages a manager started that athlete in, the less the athlete scores for them (first repeat free, then x0.9 per stage, floor 0.6).
- Credits: $1 = 20 credits, 100-credit minimum to play, currently unlimited credits per manager (pay-to-win risk flagged and accepted by the user for now).
- No athlete trades yet (parked feature); no self-ownership; exclusive ownership (one manager per athlete per league).
- Roster/athlete data visible only to league members + staff, not the public.
- **Explicitly undecided / open (do not invent)**: real prize and its funding, legal/compliance sign-off for money handling, final rank-weight scoring curve, real season calendar dates, manager eligibility for alumni/parents.

## Brand Commitments

- Name: **Tribe Fantasy**.
- Tagline (README/site): "Donation-funded fantasy league for our college ultimate team."
- Any donation-facing copy must explicitly state money is a **donation to the team fund**, with **no cash value** and **no guaranteed prize** — this is a legal/compliance constraint, not a style choice.

## Evidence on Hand

- Live product: https://nealthezeng.github.io/Tribe-Fantasy/
- Spec/design docs under `docs/superpowers/specs/` (rules, settings, milestones) are real product decisions, not placeholders.
- No testimonials, press, or case studies exist yet — do not fabricate any.

## Product Principles

1. Money in the product is always a donation to the team, never a payout — every surface must say so plainly.
2. Stats must be verifiably real (keeper-entered, second-person-verified) before they affect standings; don't let the UI imply unverified numbers are final.
3. The league is peer-to-peer and personal (teammates fielding teammates) — design should keep that legible, not generic-fantasy-sports.
4. Engagement and donations are co-equal goals this season; don't optimize the UI for one at the expense of the other.
5. Roster/athlete data is private to league members and staff — never surface it as if public.

## Accessibility & Inclusion

No formal standard or specific known user need beyond ordinary web accessibility best practices.

// run_auction must settle exactly what settleShares() in src/core/allocation.ts settles: the same kept buys, pools
// and shares.
import { describe, expect, it } from 'vitest';
import { settleShares, type Bid } from '../../src/core/allocation';
import { as, rpc } from './helpers';
import { auctionFixture, closeBids, grant, member, openAuction, runAuction } from './auction-fixture';

/** Small deterministic PRNG so a failing draft can be replayed. */
function lcg(seed: number) {
  let s = seed;
  return (n: number) => { s = (s * 1103515245 + 12345) % 2 ** 31; return s % n; };
}

describe('run_auction matches settleShares()', () => {
  for (const seed of [1, 2, 3, 4]) {
    it(`random draft ${seed}`, async () => {
      const rand = lcg(seed);
      // min_shares 40, so some pools are the floor and some the credits put in.
      const f = await auctionFixture(10, { roster_size: 2, min_shares: 40 });
      const teams: [string, string][] = [];
      for (const n of ['m1', 'm2', 'm3', 'm4']) teams.push(await member(f.db, n));
      await grant(f); // 115 each
      for (const [, mid] of teams) {
        const extra = rand(80) - 40; // budgets from 75 to 154
        if (extra !== 0) await as(f.db, f.admin, (tx) => rpc(tx, 'adjust_credits', { p_membership: mid, p_amount: extra, p_note: 'x' }));
      }
      await openAuction(f);
      for (const [, mid] of teams) {
        for (const athlete of f.athletes) {
          // Direct writes: totals may exceed budgets and buys may exceed roster_size here (place_bid refuses both),
          // so the C5 drop both sides implement still gets exercised. Amounts collide often.
          if (rand(3) === 0) {
            await f.db.query(`insert into public.bids (stage_id, membership_id, league_id, athlete_id, amount)
              values ($1, $2, $3, $4, $5)`, [f.stage, mid, f.league, athlete, 1 + rand(60)]);
          }
        }
      }
      // Distinct millisecond timestamps in random order, so ties by amount resolve on placed_at as in the core.
      // Seeded so a failing draft can be replayed.
      await f.db.query('select setseed($1)', [seed / 10]);
      await f.db.query(`update public.bids set placed_at = now() - (random() * 100000)::int * interval '1 millisecond'`);
      await closeBids(f);

      const bidRows = (await f.db.query<{ id: string; membership_id: string; athlete_id: string; amount: number; placed_at: Date }>(
        `select id, membership_id, athlete_id, amount, placed_at from public.bids`)).rows;
      const budgets = (await f.db.query<{ membership_id: string; budget: number }>(
        `select membership_id, sum(amount)::int as budget from public.credit_ledger group by membership_id`)).rows;
      const bids: Bid[] = bidRows.map((b) => ({
        id: b.id, managerId: b.membership_id, athleteId: b.athlete_id, amount: b.amount, placedAt: b.placed_at.toISOString(),
      }));
      const expected = settleShares(bids, Object.fromEntries(budgets.map((b) => [b.membership_id, b.budget])), 40, 2);

      await runAuction(f);
      const got = (await f.db.query<{ membership_id: string; athlete_id: string; price: number; share: number }>(
        'select membership_id, athlete_id, price, share::float8 as share from public.roster_slots')).rows;
      const key = (m: string, a: string, amount: number, share: number) => `${m}:${a}:${amount}:${share.toFixed(9)}`;
      expect(got.map((s) => key(s.membership_id, s.athlete_id, s.price, s.share)).sort())
        .toEqual(expected.map((h) => key(h.managerId, h.athleteId, h.amount, h.share)).sort());
      expect(expected.length).toBeGreaterThan(0);
    });
  }
});

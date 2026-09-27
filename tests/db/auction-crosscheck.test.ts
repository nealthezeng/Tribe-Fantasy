// run_auction's bid step must award exactly what allocate() in src/core/allocation.ts awards.
import { describe, expect, it } from 'vitest';
import { allocate, type Bid } from '../../src/core/allocation';
import { as, rpc } from './helpers';
import { auctionFixture, bid, closeBids, grant, member, openAuction, runAuction, slots } from './auction-fixture';

/** Small deterministic PRNG so a failing draft can be replayed. */
function lcg(seed: number) {
  let s = seed;
  return (n: number) => { s = (s * 1103515245 + 12345) % 2 ** 31; return s % n; };
}

describe('run_auction matches allocate()', () => {
  for (const seed of [1, 2, 3, 4]) {
    it(`random draft ${seed}`, async () => {
      const rand = lcg(seed);
      const f = await auctionFixture(10, { roster_size: 2 });
      const teams: [string, string][] = [];
      for (const n of ['m1', 'm2', 'm3', 'm4']) teams.push(await member(f.db, n));
      await grant(f); // 115 each
      for (const [, mid] of teams) {
        const extra = rand(80) - 40; // budgets from 75 to 154
        if (extra !== 0) await as(f.db, f.admin, (tx) => rpc(tx, 'adjust_credits', { p_membership: mid, p_amount: extra, p_note: 'x' }));
      }
      await openAuction(f);
      for (const [uid, mid] of teams) {
        for (const athlete of f.athletes) {
          if (rand(3) === 0) await bid(f, uid, mid, athlete, 1 + rand(60)); // amounts collide often
        }
      }
      // Distinct millisecond timestamps in random order, so ties by amount resolve on placed_at as in the core.
      await f.db.query(`update public.bids set placed_at = now() - (random() * 100000)::int * interval '1 millisecond'`);
      await closeBids(f);

      const bidRows = (await f.db.query<{ id: string; membership_id: string; athlete_id: string; amount: number; placed_at: Date }>(
        `select id, membership_id, athlete_id, amount, placed_at from public.bids`)).rows;
      const budgets = (await f.db.query<{ membership_id: string; budget: number }>(
        `select membership_id, sum(amount)::int as budget from public.credit_ledger group by membership_id`)).rows;
      const bids: Bid[] = bidRows.map((b) => ({
        id: b.id, managerId: b.membership_id, athleteId: b.athlete_id, amount: b.amount, placedAt: b.placed_at.toISOString(),
      }));
      const expected = allocate(bids, budgets.map((b) => ({ managerId: b.membership_id, budget: b.budget, openSlots: 2 })), f.athletes);

      await runAuction(f);
      const won = (await slots(f)).filter((s) => s.via === 'bid')
        .map((s) => `${s.membership_id}:${s.athlete_id}:${s.price}`).sort();
      expect(won).toEqual(expected.awards.map((a) => `${a.managerId}:${a.athleteId}:${a.amount}`).sort());
    });
  }
});

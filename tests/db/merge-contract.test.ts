import { expect, it } from 'vitest';
import { hashSeed, mulberry32 } from '../../src/core/rng';
import { mergeTaps } from '../../src/core/taps';
import { rowToTap } from '../../src/app/tally/queue';
import { as, rpc } from './helpers';
import { statsFixture, tap } from './stats-fixture';

const STATS = ['goal', 'assist', 'block', 'callahan', 'turnover'];

// Pins the TS <-> SQL contract: whatever mergeTaps makes of the stored taps, verify_session accepts.
it('verify_session accepts mergeTaps lines for random two-keeper sessions', async () => {
  const f = await statsFixture();
  const rand = mulberry32(hashSeed('merge-contract'));
  let merges = 0;
  let undos = 0;

  for (let n = 0; n < 10; n++) {
    const session = (await as(f.db, f.k1, (tx) =>
      rpc(tx, 'create_session', { p_season: f.season, p_kind: 'practice', p_held_on: '2026-11-16', p_counts: true }),
    )) as string;

    // ~8 plays over 40s; each keeper catches each play with p=0.75 (1-3s late) and undoes ~20% of their taps.
    const t0 = Date.now() - 120_000;
    const byKeeper = new Map<string, ReturnType<typeof tap>[]>([[f.k1, []], [f.k2, []]]);
    for (let play = 0; play < 8; play++) {
      const athlete = rand() < 0.5 ? f.sam : f.ali;
      const stat = STATS[Math.floor(rand() * STATS.length)];
      const at = t0 + rand() * 40_000;
      for (const taps of byKeeper.values()) {
        if (rand() >= 0.75) continue;
        const t = tap(athlete, stat, new Date(at + 1000 + rand() * 2000).toISOString());
        taps.push(t);
        if (rand() < 0.2) {
          taps.push(tap(athlete, stat, new Date(at + 4000).toISOString(), t.id));
          undos++;
        }
      }
    }
    for (const [keeper, taps] of byKeeper) {
      if (taps.length === 0) continue;
      await as(f.db, keeper, (tx) =>
        rpc(tx, 'save_taps', { p_session: session, p_client_now: new Date().toISOString(), p_taps: taps }));
    }

    // Read back what the server stored (skew-corrected), as the verifier's browser would.
    const rows = await f.db.query<{ id: string; athlete_id: string; stat: string; keeper_id: string; tapped_at: Date; undoes: string | null }>(
      `select id, athlete_id, stat, keeper_id, tapped_at, undoes from public.stat_taps where session_id = $1`, [session]);
    const stored = rows.rows.map((r) => rowToTap({ ...r, tapped_at: r.tapped_at.toISOString() }));

    for (const window of [0, 10, 60]) {
      const merge = mergeTaps(stored, window);
      merges += merge.merged.length;
      const lines = Object.entries(merge.counts).map(([athlete_id, stats]) => ({ athlete_id, stats }));
      await as(f.db, f.k3, async (tx) => {
        await rpc(tx, 'verify_session', { p_session: session, p_lines: lines });
        await tx.rollback(); // keep the session open for the next window
      });
    }
  }
  // The random sessions must actually exercise undos and merging, or this pins nothing.
  expect(undos).toBeGreaterThan(0);
  expect(merges).toBeGreaterThan(0);
});

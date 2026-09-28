// Sweeps allowance_gap × upset_k × decay over simulated league years (board t64). Usage:
//   npm run tune -- [seeds=200] [managers=6] [roster=4]
// Per combo: how often the manager with the sharpest read wins the year, how much places churn between stages,
// and whether throwing each stage's last week pays (tank Δ = mean final place tanking − honest; > 0 = it hurts).
import { simulateYear } from '../src/core/simulate';

const [seeds = 200, managers = 6, roster = 4] = process.argv.slice(2).map(Number);
const GAPS = [0, 15, 30, 60];
const UPSET_K = [0, 0.5, 1, 2];
const DECAY = [{ decay_mode: 'none' }, { decay_rate: 0.9, decay_floor: 0.6 }, { decay_rate: 0.8, decay_floor: 0.5 }];

const rows = [];
for (const allowance_gap of GAPS) {
  for (const upset_k of UPSET_K) {
    for (const decay of DECAY) {
      const settings = { allowance_gap, upset_k, roster_size: roster, max_members: managers, ...decay };
      let sharpWins = 0, churn = 0, tankDelta = 0, tankPays = 0;
      for (let i = 0; i < seeds; i++) {
        const base = { managers, athletes: managers * roster, stages: 3, weeksPerStage: 3, seed: `tune${i}`, settings };
        const honest = simulateYear(base);
        const sharp = honest.managerIds.reduce((a, b) => (honest.readNoise[a] <= honest.readNoise[b] ? a : b));
        const final = honest.placesByStage.at(-1)!;
        if (final[sharp] === 1) sharpWins++;
        for (let st = 1; st < honest.placesByStage.length; st++) {
          for (const m of honest.managerIds) churn += Math.abs(honest.placesByStage[st][m] - honest.placesByStage[st - 1][m]);
        }
        const tanker = i % managers;
        const tanked = simulateYear({ ...base, tanker }).placesByStage.at(-1)![honest.managerIds[tanker]];
        const d = tanked - final[honest.managerIds[tanker]];
        tankDelta += d;
        if (d < 0) tankPays++;
      }
      rows.push({
        gap: allowance_gap, upset_k, decay: 'decay_mode' in decay ? 'none' : `${decay.decay_rate}/${decay.decay_floor}`,
        'sharp wins %': +((100 * sharpWins) / seeds).toFixed(1),
        churn: +(churn / (seeds * managers * 2)).toFixed(2),
        'tank Δ': +(tankDelta / seeds).toFixed(2),
        'tank pays %': +((100 * tankPays) / seeds).toFixed(1),
      });
    }
  }
}
console.log(`${seeds} seeds, ${managers} teams × ${roster}, 3 stages × 3 weeks. Random chance of winning: ${(100 / managers).toFixed(1)}%.`);
console.table(rows);

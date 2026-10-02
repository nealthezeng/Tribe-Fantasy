// Sweeps upset_k × tiredness over simulated tournament years (board t64, tournament mode §5). Usage:
//   npm run tune -- [seeds=200] [managers=6] [roster=4] [games=6]
// Per combo: how often the manager with the sharpest read wins the year, how much places churn between tournaments,
// whether throwing each tournament's last game pays (tank Δ = mean final place tanking − honest; > 0 = it hurts),
// and whether ignoring tiredness pays (repeat Δ, same sign: > 0 = always starting your best hurts).
import { simulateYear } from '../src/core/simulate';

const [seeds = 200, managers = 6, roster = 4, games = 6] = process.argv.slice(2).map(Number);
const UPSET_K = [0, 0.5, 1];
const TIREDNESS = [[0.5, 0.75], [0.4, 0.6], [0.3], [0.5], []];

const rows = [];
for (const upset_k of UPSET_K) {
  for (const tiredness_multipliers of TIREDNESS) {
    const settings = { upset_k, tiredness_multipliers, roster_size: roster, max_members: managers };
    let sharpWins = 0, churn = 0, tankDelta = 0, tankPays = 0, repeatDelta = 0, repeatPays = 0;
    for (let i = 0; i < seeds; i++) {
      const base = { managers, athletes: managers * roster, stages: 3, gamesPerStage: games, seed: `tune${i}`, settings };
      const honest = simulateYear(base);
      const sharp = honest.managerIds.reduce((a, b) => (honest.readNoise[a] <= honest.readNoise[b] ? a : b));
      const final = honest.placesByStage.at(-1)!;
      if (final[sharp] === 1) sharpWins++;
      for (let st = 1; st < honest.placesByStage.length; st++) {
        for (const m of honest.managerIds) churn += Math.abs(honest.placesByStage[st][m] - honest.placesByStage[st - 1][m]);
      }
      const who = i % managers;
      const id = honest.managerIds[who];
      const tank = simulateYear({ ...base, tanker: who }).placesByStage.at(-1)![id] - final[id];
      tankDelta += tank;
      if (tank < 0) tankPays++;
      const repeat = simulateYear({ ...base, repeater: who }).placesByStage.at(-1)![id] - final[id];
      repeatDelta += repeat;
      if (repeat < 0) repeatPays++;
    }
    rows.push({
      upset_k, tiredness: JSON.stringify(tiredness_multipliers),
      'sharp wins %': +((100 * sharpWins) / seeds).toFixed(1),
      churn: +(churn / (seeds * managers * 2)).toFixed(2),
      'tank Δ': +(tankDelta / seeds).toFixed(2),
      'tank pays %': +((100 * tankPays) / seeds).toFixed(1),
      'repeat Δ': +(repeatDelta / seeds).toFixed(2),
      'repeat pays %': +((100 * repeatPays) / seeds).toFixed(1),
    });
  }
}
console.log(`${seeds} seeds, ${managers} teams × ${roster}, 3 tournaments × ${games} games. ` +
  `Random chance of winning: ${(100 / managers).toFixed(1)}%.`);
console.table(rows);

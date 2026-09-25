import { simulateSeason } from '../src/core/simulate';

const [managers = '6', weeks = '10', seed = 'demo', settingsJson = '{}'] = process.argv.slice(2);
const n = Number(managers);
const result = simulateSeason({
  managers: n,
  athletes: n * 5,
  weeks: Number(weeks),
  seed,
  settings: JSON.parse(settingsJson),
  tournamentWeeks: [4, 8],
});

const table = [...result.standings]
  .sort((a, b) => b.points - a.points || b.totalScore - a.totalScore)
  .map((row, i) => ({ rank: i + 1, manager: row.managerId, points: +row.points.toFixed(2), score: +row.totalScore.toFixed(2) }));
console.table(table);

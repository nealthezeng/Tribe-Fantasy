import { describe, expect, it } from 'vitest';
import { isEcho, parseStats, whisperHint } from './voice';

const roster = [
  { id: 'toby', name: 'Toby Grant' }, { id: 'tobi', name: 'Tobi Lane' }, { id: 'bo', name: 'Bo Stone' },
  { id: 'maxO', name: 'Max Ortiz' }, { id: 'maxL', name: 'Max Lowe' }, { id: 'jl', name: 'Jean Luc Moreau' },
];
const stats = ['goal', 'assist', 'block', 'callahan', 'turnover'];
const parse = (text: string, s: readonly string[] = stats) => parseStats(text, roster, s).map((e) => `${e.athleteId} ${e.stat}`);

describe('parseStats', () => {
  it('reads everyday calls', () => {
    expect(parse('Grant gets a D.')).toEqual(['toby block']);
    expect(parse('Bo turns it over')).toEqual(['bo turnover']);
    expect(parse('Bo gets a D and scores, Ortiz drops it')).toEqual(['bo block', 'bo goal', 'maxO turnover']);
  });

  it('reads passes once, and a three-part name heard word by word', () => {
    expect(parse('Bo to Ortiz for the score.')).toEqual(['bo assist', 'maxO goal']);
    expect(parse('Bo turns it over to Ortiz')).toEqual(['bo turnover']);
    expect(parse('Bo throws to Jean Luc Moro for a score.')).toEqual(['bo assist', 'jl goal']);
  });

  it('needs a name only one player has, after the sound rule', () => {
    expect(parse('Max scores')).toEqual([]);
    expect(parse('Toby scores')).toEqual([]); // Toby and Tobi sound the same
    expect(parse('Lowe with the D, Lane assist')).toEqual(['maxL block', 'tobi assist']);
    expect(parse('Bow gets a dee')).toEqual([]); // no typo tolerance
  });

  it('drops a stat after a pass to a catcher it cannot name: it was the catcher’s, not the thrower’s', () => {
    expect(parse('Bo to Max for the score')).toEqual([]); // two Maxes
    expect(parse('Bo to Max, drop')).toEqual([]);
  });

  it('counts 1 to 5, always adding', () => {
    expect(parse('Bo gets two Ds')).toEqual(['bo block', 'bo block']);
    expect(parse('Ortiz 2 turnovers, Grant three goals')).toEqual(['maxO turnover', 'maxO turnover', 'toby goal', 'toby goal', 'toby goal']);
    expect(parse('Bo two Ortiz')).toEqual(['bo assist', 'maxO goal']); // a number before a name is a pass
    expect(parse('Bo 2 Ortiz')).toEqual(['bo assist', 'maxO goal']);
    expect(parse('Bo 20 turnovers')).toEqual(['bo turnover']); // above 5: the number is ignored
    expect(parse('Bo scores, Bo two goals')).toEqual(['bo goal', 'bo goal', 'bo goal']);
    expect(parse('Bo scores, two goals')).toEqual(['bo goal', 'bo goal', 'bo goal']); // a count is never deduped
  });

  it('reads plurals, ignores what the season does not count, and garbage', () => {
    expect(parse('Bo two dees, Ortiz two throwaways')).toEqual(['bo block', 'bo block', 'maxO turnover', 'maxO turnover']);
    expect(parse('Bo Callahan', ['goal', 'block'])).toEqual([]);
    // a count before a stat the season doesn't count is still a count, not a pass: both are ignored
    expect(parse('Bo two callahans, Ortiz D', ['goal', 'assist', 'block', 'turnover'])).toEqual(['maxO block']);
    expect(parse('Bo 2 Ds, Ortiz turns it over', ['goal', 'assist', 'turnover', 'callahan'])).toEqual(['maxO turnover']);
    expect(parse('Zorba Wadda, Q.Q. Q.Q. Q.Q. Q.Q. Q.Q.')).toEqual([]);
  });
});

describe('whisperHint', () => {
  it('builds the hint from real names and spots its echo', () => {
    const hint = whisperHint(['Bo Stone', 'Max Ortiz']);
    expect(hint).toBe('Bo Stone gets a D. Max Ortiz to Bo Stone for the goal. Max Ortiz turns it over. Bo Stone assist. '
      + 'Max Ortiz Callahan. Players: Bo Stone, Max Ortiz.');
    expect(isEcho(' Bo Stone gets a D. Max Ortiz to Bo Stone for the goal.', hint)).toBe(true);
    expect(isEcho('Bo Stone gets a D', hint)).toBe(false); // a real short call matches the hint's start: not an echo
    expect(isEcho('Bo Stone gets a D and Max Ortiz scores the goal', hint)).toBe(false); // not in the hint
    expect(isEcho('Players: Bo Stone, Max Ortiz.', hint)).toBe(true);
    // the hint's longest call, said for real, is not an echo, even with dots in a name
    expect(isEcho('Max Ortiz to Toby Grant for the goal.', whisperHint(['Bo Stone', 'Max Ortiz', 'Toby Grant']))).toBe(false);
    expect(isEcho('T.J. Lane to Bo Stone for the goal', whisperHint(['Bo Stone', 'T.J. Lane']))).toBe(false);
  });
});

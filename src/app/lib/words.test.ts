import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../core/settings';
import type { GameOutcome } from '../../core/tournament';
import type { LeagueTournament } from './tournament';
import { factorWords, gameName, heldNote, pctExact, restWords, rowStatus, statusWord, statWords } from './words';

describe('words', () => {
  it('names a game by number, with the real opponent once set', () => {
    expect(gameName(3)).toBe('Game 3');
    expect(gameName(3, null)).toBe('Game 3');
    expect(gameName(3, 'UNC')).toBe('Game 3 vs UNC');
  });

  it('says stats in words, in tally order, skipping zeros', () => {
    expect(statWords({ goal: 1, assist: 2, block: 1, turnover: 0 })).toBe('1 goal, 2 assists, 1 block');
    expect(statWords({ turnover: 2, callahan: 1 })).toBe('1 callahan, 2 turnovers');
    expect(statWords({ goal: 0 })).toBe('');
  });

  it('says rest as the game he was picked for and the part of the points it keeps', () => {
    const s = DEFAULT_SETTINGS;
    expect(restWords(0.5, 3, s)).toBe('picked for game 2: half points');
    expect(restWords(0.75, 3, s)).toBe('picked for game 1: ¾ points');
    expect(restWords(1, 3, s)).toBe('full points');
    expect(restWords(0.25, 4, { ...s, tiredness_multipliers: [0.25, 0.6] })).toBe('picked for game 3: ¼ points');
    expect(restWords(0.6, 4, { ...s, tiredness_multipliers: [0.25, 0.6] })).toBe('picked for game 2: 60% points');
  });

  it('leaves the game out when the rest could mean more than one game', () => {
    expect(restWords(0.5, 4, { ...DEFAULT_SETTINGS, tiredness_multipliers: [0.5, 0.5] })).toBe('half points');
    expect(restWords(0.5, 4, { ...DEFAULT_SETTINGS, tiredness_multipliers: [] })).toBe('half points');
  });

  it("says a player's share, rest and earlier tournaments for one game", () => {
    const side = { share: { a: 0.2, b: 1 }, rest: { a: 0.75, b: 1 }, decay: { a: 0.9, b: 1 } };
    expect(factorWords(side, 'a', 3, DEFAULT_SETTINGS)).toBe('20% · picked for game 1: ¾ points · earlier tournaments: 90%');
    expect(factorWords(side, 'b', 3, DEFAULT_SETTINGS)).toBe('100% · full points'); // no cut, no words for it
  });

  it('gives an exact percent to 3 significant figures', () => {
    expect(pctExact(0.125)).toBe('12.5%');
    expect(pctExact(0.2)).toBe('20%');
    expect(pctExact(0.5 * 0.75 * 0.9)).toBe('33.8%');
  });

  it('has one status word per game status; a game held back by another reads Final', () => {
    expect(statusWord({ status: 'upcoming', heldBy: null })).toBe('Not started');
    expect(statusWord({ status: 'live', heldBy: null })).toBe('Live');
    expect(statusWord({ status: 'pending', heldBy: 'g' })).toBe('Final');
    expect(statusWord({ status: 'pending', heldBy: null })).toBe('Finished · not verified');
    expect(statusWord({ status: 'final', heldBy: null })).toBe('Final');
    expect(statusWord({ status: 'void', heldBy: null })).toBe("Doesn't count");
  });

  it('notes which game a held-back game waits for', () => {
    const outcome = (id: string, stageId: string, number: number, heldBy: string | null) =>
      ({ game: { id, stageId, number, sessionId: null, startedAt: null, finishedAt: null }, status: 'pending', matchups: [], heldBy }) as GameOutcome;
    const holder = outcome('f4', 'F', 4, null);
    const held = outcome('w1', 'W', 1, 'f4');
    const y = { result: { games: [holder, held] }, stage: new Map([['F', 'Feasterns'], ['W', 'Winter']]) } as unknown as LeagueTournament;
    expect(heldNote(y, held)).toBe('counts once Feasterns game 4 is verified');
    expect(heldNote(y, holder)).toBeNull();
  });

  it('gives a Stats or tally row its status word', () => {
    const row = (over: Partial<Parameters<typeof rowStatus>[0]>) =>
      rowStatus({ started_at: null, finished_at: null, session_id: null, verified_at: null, ...over });
    expect(row({})).toBe('Not started');
    expect(row({ started_at: 'a', session_id: 's' })).toBe('Live');
    expect(row({ started_at: 'a', finished_at: 'b', session_id: 's' })).toBe('Finished · not verified');
    expect(row({ started_at: 'a', finished_at: 'b', session_id: 's', verified_at: 'c' })).toBe('Final');
    expect(row({ started_at: 'a', session_id: 's', verified_at: 'c' })).toBe('Final'); // verifying makes it final even unfinished
    expect(row({ started_at: 'a', finished_at: 'b' })).toBe("Doesn't count");
  });
});

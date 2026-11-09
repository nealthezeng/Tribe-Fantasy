import { describe, expect, it } from 'vitest';
import type { GameOutcome } from '../../core/tournament';
import type { LeagueTournament } from './tournament';
import { gameName, heldNote, pctExact, rowStatus, statusWord, statWords } from './words';

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

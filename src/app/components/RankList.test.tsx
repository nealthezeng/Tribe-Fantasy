// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAvatar } from '../lib/avatar';
import type { OverallStanding } from '../lib/tournament';
import { RankList } from './RankList';

const row = (n: number): OverallStanding => ({
  membershipId: `m${n}`, team: `Team ${n}`, owner: `Owner ${n}`, league: 'A', points: 20 - n, totalScore: 0, wins: 0, losses: 0, ties: 0,
  place: n, tied: false, avatar: resolveAvatar({ background: 'lilac' }, `m${n}`),
});
const show = (rows: OverallStanding[], membershipId = 'm1') =>
  render(<MemoryRouter><RankList rows={rows} membershipId={membershipId} showLeague={false} /></MemoryRouter>).container;

afterEach(cleanup);

describe('RankList avatars', () => {
  it('draws the team\'s own figure in each row', () => {
    const list = show([row(1), row(2), row(3)]);
    const items = [...list.querySelectorAll('li')];
    expect(items.map((li) => li.querySelectorAll('.figure').length)).toEqual([1, 1, 1]);
    expect(items[0].innerHTML).toContain('#c5b4f5');
  });

  it('draws no figure in a gap row', () => {
    const list = show(Array.from({ length: 12 }, (_, i) => row(i + 1)), 'm12');
    const gap = list.querySelector('li.gap')!;
    expect(gap.textContent).toMatch(/more teams/);
    expect(gap.querySelector('.figure')).toBeNull();
  });
});

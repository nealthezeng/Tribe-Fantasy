// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HashRouter, MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { StatTable, TournamentSwitch } from './StatTable';

afterEach(cleanup);
const ari6 = { key: 'a', label: 'Ari', counts: { goal: 6 }, points: 6 };
const bo9 = { key: 'b', label: 'Bo', counts: { goal: 2 }, points: 9 };
const names = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => r.firstElementChild!.textContent);

describe('StatTable', () => {
  it('sorts by points high first, flips on a second tap, and marks aria-sort', () => {
    render(<MemoryRouter><StatTable stats={['goal']} rows={[ari6, bo9]} /></MemoryRouter>);
    expect(names()).toEqual(['Bo', 'Ari']);
    expect(screen.getByRole('columnheader', { name: /Pts/ }).getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(screen.getByRole('button', { name: /Goal/ }));
    expect(names()).toEqual(['Ari', 'Bo']);
    fireEvent.click(screen.getByRole('button', { name: /Goal/ }));
    expect(names()).toEqual(['Bo', 'Ari']);
    expect(screen.getByRole('columnheader', { name: /Goal/ }).getAttribute('aria-sort')).toBe('ascending');
  });

  it('sorts the player column A to Z first', () => {
    render(<MemoryRouter><StatTable stats={['goal']} rows={[bo9, ari6]} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Player' }));
    expect(names()).toEqual(['Ari', 'Bo']);
  });

  it('links each player when href is given', () => {
    render(<HashRouter><StatTable stats={['goal']} rows={[ari6]} href={(r) => `/player/${r.key}?t=S1`} /></HashRouter>);
    expect(screen.getByRole('link', { name: 'Ari' }).getAttribute('href')).toBe('#/player/a?t=S1');
  });

  it('keeps row order and plain headers when not sortable', () => {
    render(<MemoryRouter><StatTable stats={['goal']} rows={[ari6, bo9]} sortable={false} /></MemoryRouter>);
    expect(names()).toEqual(['Ari', 'Bo']);
    expect(within(screen.getByRole('table')).queryAllByRole('button')).toHaveLength(0);
  });

  it('says so when there are no rows', () => {
    render(<MemoryRouter><StatTable stats={[]} rows={[]} /></MemoryRouter>);
    expect(screen.getByText('No stats recorded.')).toBeTruthy();
  });
});

describe('TournamentSwitch', () => {
  const stage = (id: string) => ({ id, name: `T ${id}`, starts_on: '2026-01-01', ends_on: '2026-01-02', auction_run_at: 'x' });
  const Search = () => <output>{useLocation().search}</output>;

  it('writes ?t= and renders nothing for a single tournament', () => {
    const { container, rerender } = render(<MemoryRouter><TournamentSwitch stages={[stage('S1')]} stage={stage('S1')} /></MemoryRouter>);
    expect(container.querySelector('select')).toBeNull();
    rerender(<MemoryRouter><TournamentSwitch stages={[stage('S2'), stage('S1')]} stage={stage('S2')} /><Search /></MemoryRouter>);
    fireEvent.change(screen.getByRole('combobox', { name: 'Tournament' }), { target: { value: 'S1' } });
    expect(screen.getByRole('status').textContent).toBe('?t=S1');
  });
});

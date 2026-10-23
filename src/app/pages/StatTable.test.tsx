// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HashRouter, MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { STAT_LEGEND } from '../lib/words';
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

  it('heads stat columns with short letters but keeps the full name accessible', () => {
    render(<MemoryRouter><StatTable stats={['goal', 'assist', 'block', 'callahan', 'turnover', 'other']} rows={[ari6]} /></MemoryRouter>);
    const heads = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Player', 'G', 'A', 'D', 'C', 'T', 'other', 'Pts']);
    expect(screen.getByRole('button', { name: 'Callahan' }).textContent).toBe('C');
    expect(screen.getByRole('columnheader', { name: 'Turnover' }).getAttribute('title')).toBe('Turnover');
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

  it('makes the whole row open the player', () => {
    const Where = () => <output>{useLocation().pathname}</output>;
    render(<MemoryRouter><StatTable stats={['goal']} rows={[ari6]} href={(r) => `/player/${r.key}`} /><Where /></MemoryRouter>);
    const row = screen.getByRole('cell', { name: 'Ari' }).closest('tr')!;
    expect(row.classList.contains('row-target')).toBe(true);
    expect(within(row).getByRole('link', { name: 'Ari' })).toBeTruthy();
    fireEvent.click(within(row).getAllByRole('cell')[1]); // a number, not the name: the sticky name cell stops the link's stretch
    expect(screen.getByRole('status').textContent).toBe('/player/a');
  });

  it('leaves rows plain without href', () => {
    render(<MemoryRouter><StatTable stats={['goal']} rows={[ari6]} /></MemoryRouter>);
    expect(screen.getByRole('cell', { name: 'Ari' }).closest('tr')!.classList.contains('row-target')).toBe(false);
  });

  it('shows the legend under the table', () => {
    render(<MemoryRouter><StatTable stats={['goal']} rows={[ari6]} /></MemoryRouter>);
    const legend = screen.getByText(STAT_LEGEND);
    expect(legend.className).toBe('hint');
    expect(screen.getByRole('table').compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leaves the legend out when asked', () => {
    render(<MemoryRouter><StatTable stats={['goal']} rows={[ari6]} legend={false} /></MemoryRouter>);
    expect(screen.queryByText(STAT_LEGEND)).toBeNull();
  });

  it('adds the total as the last row, outside the sort', () => {
    render(<MemoryRouter><StatTable stats={['goal']} rows={[ari6, bo9]} total={{ key: 't', label: 'Total', counts: { goal: 8 }, points: 15 }} /></MemoryRouter>);
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toEqual([['Bo', '2', '9'], ['Ari', '6', '6'], ['Total', '8', '15']]);
  });

  it('paints the sticky column only while scrolled', () => {
    const { container } = render(<MemoryRouter><StatTable stats={['goal']} rows={[ari6]} /></MemoryRouter>);
    const wrap = container.querySelector('.table-wrap')!;
    expect(wrap.classList.contains('scrolled')).toBe(false);
    fireEvent.scroll(wrap, { target: { scrollLeft: 40 } });
    expect(wrap.classList.contains('scrolled')).toBe(true);
    fireEvent.scroll(wrap, { target: { scrollLeft: 0 } });
    expect(wrap.classList.contains('scrolled')).toBe(false);
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

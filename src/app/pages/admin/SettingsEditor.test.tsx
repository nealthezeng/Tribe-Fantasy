// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../../core/settings';
import { api } from '../../lib/rpc';
import { SettingsEditor } from './SettingsEditor';

const db = vi.hoisted(() => ({ settings: {} as unknown }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const builder = {
        select: () => builder, eq: () => builder,
        single: () => Promise.resolve({ data: { settings: structuredClone(db.settings) }, error: null }),
      };
      return builder;
    },
  },
}));
vi.mock('../../lib/rpc', () => ({ api: {
  updateSeasonSettings: vi.fn((_season: string, s: unknown) => { db.settings = s; return Promise.resolve(); }),
} }));

const STORED = { venmo_handle: 'tribe-fund', allowance_base: 90, stat_weights: { goal: 3, assist: 3, block: 5, callahan: 12, turnover: -1 } };
const saveCalls = () => vi.mocked(api.updateSeasonSettings).mock.calls;
const field = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;
const json = () => screen.getByLabelText('Season settings JSON') as HTMLTextAreaElement;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
async function open() {
  render(<SettingsEditor seasonId="s1" />);
  await screen.findByRole('spinbutton', { name: 'Goal' });
}

beforeEach(() => { db.settings = structuredClone(STORED); vi.mocked(api.updateSeasonSettings).mockClear(); });
afterEach(cleanup);

describe('SettingsEditor', () => {
  it('shows the stat points and the credit and pick settings as labelled number fields', async () => {
    await open();
    const shown = Object.fromEntries(['Goal', 'Assist', 'Block', 'Callahan', 'Turnover', 'Credits for the team in first',
      'Extra for the last-placed team', 'Players a team can own', 'Picks each game'].map((n) => [n, field(n).value]));
    expect(shown).toEqual({
      Goal: '3', Assist: '3', Block: '5', Callahan: '12', Turnover: '-1', 'Credits for the team in first': '90',
      'Extra for the last-placed team': '30', 'Players a team can own': '6', 'Picks each game': '2',
    });
    expect(['Goal', 'Assist', 'Block', 'Callahan', 'Turnover'].map((n) => field(n).step)).toEqual(Array(5).fill('any'));
    expect(field('Credits for the team in first').hasAttribute('step')).toBe(false);
    expect(screen.queryByRole('spinbutton', { name: 'Free credits each tournament' })).toBeNull(); // ruling 79
    expect(screen.getByRole('heading', { name: 'Points for stats' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Credits and picks' })).toBeTruthy();
  });

  it('merges the fields into the saved settings and saves once', async () => {
    await open();
    type(field('Goal'), '4');
    type(field('Credits for the team in first'), '120');
    type(field('Picks each game'), '3');
    save();
    await screen.findByText('Saved.');
    const base = parseSettings(STORED);
    expect(saveCalls()).toEqual([['s1', { ...base, allowance_base: 120, picks_per_game: 3, stat_weights: { ...base.stat_weights, goal: 4 } }]]);
  });

  it('keeps the JSON under Advanced, and saving from there still checks it', async () => {
    await open();
    expect(json().closest('details')!.querySelector('summary')!.textContent).toBe('Advanced (all settings as JSON)');
    type(json(), JSON.stringify({ ...parseSettings(STORED), roster_size: 0 }));
    save();
    expect((await screen.findByRole('alert')).textContent).toContain('roster_size must be between 1 and 30');
    type(json(), '{ nope');
    save();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/^Not valid JSON/));
    type(json(), JSON.stringify({ ...parseSettings(STORED), roster_size: 8 }));
    save();
    await screen.findByText('Saved.');
    expect(saveCalls()).toEqual([['s1', { ...parseSettings(STORED), roster_size: 8 }]]);
  });

  it('shows what a field is missing instead of saving', async () => {
    await open();
    type(field('Credits for the team in first'), '');
    save();
    expect((await screen.findByRole('alert')).textContent).toContain('allowance_base must be a finite number');
    type(field('Credits for the team in first'), '100');
    type(field('Players a team can own'), '1');
    save();
    expect((await screen.findByRole('alert')).textContent).toContain('picks_per_game must be at most roster_size');
    expect(saveCalls()).toEqual([]);
  });

  it('puts the JSON back when a field changes, and the fields back when the JSON changes', async () => {
    await open();
    const saved = json().value;
    type(json(), JSON.stringify({ ...parseSettings(STORED), roster_size: 8 }));
    type(field('Goal'), '4');
    expect(json().value).toBe(saved);
    type(json(), JSON.stringify({ ...parseSettings(STORED), roster_size: 9 }));
    expect(field('Goal').value).toBe('3');
    type(field('Block'), '6');
    save();
    await screen.findByText('Saved.');
    const base = parseSettings(STORED);
    expect(saveCalls()).toEqual([['s1', { ...base, stat_weights: { ...base.stat_weights, block: 6 } }]]);
  });

  it('starts the next edit from what was just saved', async () => {
    await open();
    type(field('Goal'), '4');
    save();
    await screen.findByText('Saved.');
    await waitFor(() => expect(json().value).toContain('"goal": 4'));
    type(json(), json().value.replace('"roster_size": 6', '"roster_size": 7'));
    expect(field('Goal').value).toBe('4');
  });

  it('leaves out a stat the season has no points for unless the field is filled in', async () => {
    db.settings = { ...STORED, stat_weights: { goal: 3, assist: 3, block: 5, turnover: -1 } };
    await open();
    expect(field('Callahan').value).toBe('');
    type(field('Goal'), '4');
    save();
    await screen.findByText('Saved.');
    expect(saveCalls()[0][1]).toMatchObject({ stat_weights: { goal: 4, assist: 3, block: 5, turnover: -1 } });
    expect(Object.keys((saveCalls()[0][1] as { stat_weights: object }).stat_weights)).not.toContain('callahan');
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../core/settings';
import type { CurrentSeason } from '../lib/stats';
import { RulesPage } from './RulesPage';

let current: CurrentSeason | null = null;
vi.mock('../lib/stats', async (orig) => ({
  ...(await orig<typeof import('../lib/stats')>()),
  loadCurrentSeason: () => Promise.resolve(current),
}));

afterEach(() => { cleanup(); current = null; });

describe('RulesPage', () => {
  it('computes its numbers from the default settings', () => {
    render(<RulesPage />);
    const text = document.body.textContent ?? '';
    // Allowance: 100 for first, 130 for last. Example game: (6+3−4)×2 = 10, ×0.5 tired = 5.
    expect(text).toContain('100 for the team in first, up to 130 for the team in last');
    expect(text).toMatch(/game score 10\. If you also started them the game before, it's 10 × 0\.5 = 5\./);
    // Stat points already include the tournament ×2: a goal is +6, a turnover −4.
    expect(screen.getByText('Goal').parentElement?.textContent).toBe('Goal+6');
    expect(screen.getByText('Turnover').parentElement?.textContent).toBe('Turnover-4');
    expect(text).not.toMatch(/practice/i);
    expect(text).toContain('Picks lock when a stat keeper starts the game');
    expect(text).toContain('4 players: 3 active and 1 on the bench');
    expect(screen.getByText('2 games before').parentElement?.textContent).toBe('2 games before×0.75');
    // Last beats 1st with upset_k 0.5: 3 × (1 + 0.5) = +4.5 for the winner, −1 × 1.5 = −1.5 for the loser.
    expect(screen.getByText('Last beats 1st').parentElement?.textContent).toBe('Last beats 1st+4.5-1.5');
  });

  it('says donations go to the team fund and credits have no cash value', () => {
    render(<RulesPage />);
    expect(screen.getByText(/A donation is a donation to the team fund/).textContent).toMatch(/no cash value/);
    expect(document.body.textContent).toContain('merch prize');
  });

  it('says donations are not open while they are off', () => {
    render(<RulesPage />);
    expect(document.body.textContent).toContain("Donations aren't open yet.");
    expect(document.body.textContent).not.toMatch(/Venmo/);
  });

  it('says donations are not open when they are on but there is no Venmo handle', async () => {
    current = { id: 'se', name: 'Spring 2027', settings: parseSettings({ donations_enabled: true }) };
    render(<RulesPage />);
    await screen.findByText(/Spring 2027's settings/);
    expect(document.body.textContent).toContain("Donations aren't open yet.");
    expect(document.body.textContent).not.toMatch(/Venmo @/);
    expect(document.querySelector('.notice')?.textContent).toContain("they aren't open yet");
  });

  it('explains how to donate by Venmo once donations are on', async () => {
    current = { id: 'se', name: 'Spring 2027', settings: parseSettings({ donations_enabled: true, venmo_handle: 'tribe-fund' }) };
    render(<RulesPage />);
    expect(await screen.findByText(/Venmo @tribe-fund/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/4-letter code/);
    expect(document.body.textContent).not.toContain("Donations aren't open yet.");
  });

  it('says bids may not total more than your credits', () => {
    render(<RulesPage />);
    expect(document.body.textContent).toContain("Your bids together can't be more than your credits");
  });

  it("shows the current season's settings when they load", async () => {
    current = { id: 'se', name: 'Spring 2027', settings: parseSettings({ stat_weights: { goal: 3, block: 5, turnover: -1 } }) };
    render(<RulesPage />);
    expect(await screen.findByText(/Spring 2027's settings/)).toBeTruthy();
    // D: 5 × 2 = +10. Example: 2 goals 12 + 1 D 10 − 2 turnovers 4 = 18.
    expect(screen.getByText('D').parentElement?.textContent).toBe('D+10');
    expect(document.body.textContent).toMatch(/game score 18\./);
  });
});

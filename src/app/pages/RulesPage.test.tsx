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
    // Allowance: 100 for first, 130 for last. Example: 2 goals = 12, a half share, started the game before (×0.5).
    expect(text).toContain('100 for the team in first, up to 130 for the team in last');
    expect(text).toContain('2 Goal by a player you own half of, started the game before: 12 × 50% × 0.5 = 3');
    // Split example under the 200-share floor: 100 + 50 credits leave a quarter of the player unowned.
    expect(text).toContain('he has 200 shares: you own 50%, they own 25%, and the other 25% scores for nobody.');
    // Stat points already include the tournament ×2: a goal is +6, a D +10, a turnover −2.
    expect(screen.getByText('Goal').parentElement?.textContent).toBe('Goal+6');
    expect(screen.getByText('D').parentElement?.textContent).toBe('D+10');
    expect(screen.getByText('Turnover').parentElement?.textContent).toBe('Turnover-2');
    expect(text).not.toMatch(/practice/i);
    expect(text).toContain('Picks lock when a stat keeper starts the game');
    expect(text).toContain('Each roster holds up to 6 players');
    expect(text).toContain('Each game you start 2 of your players');
    expect(text).toContain('Up to 12 teams');
    expect(text).toContain('most rested healthy players, then the ones scoring best lately');
    expect(text).not.toMatch(/\b(bench|bids?|bidding|auction)\b/i);
    expect(text).toContain('Resting a player for 2 games between starts never does.');
    expect(text).toContain('and earlier tournaments (below)');
    expect(text).not.toMatch(/repeat|Rotating/);
    expect(text).toContain("Other teams can't see your picks until the game starts");
    expect(screen.getByText('2 games before').parentElement?.textContent).toBe('2 games before×0.75');
    // Last beats 1st with upset_k 0.5: 3 × (1 + 0.5) = +4.5 for the winner, −1 × 1.5 = −1.5 for the loser.
    expect(screen.getByText('Last beats 1st').parentElement?.textContent).toBe('Last beats 1st+4.5-1.5');
  });

  it('derives the resting sentence from the tiredness steps', async () => {
    current = { id: 'se', name: 'Spring 2027', settings: parseSettings({ tiredness_multipliers: [0.5] }) };
    render(<RulesPage />);
    await screen.findByText(/Spring 2027's settings/);
    expect(document.body.textContent).toContain('Resting a player for 1 game between starts never does.');
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

  it('says your buys may not total more than your credits and that every credit is spent', () => {
    render(<RulesPage />);
    expect(document.body.textContent).toContain("Your buys together can't be more than your credits");
    expect(document.body.textContent).toContain('Every credit you put in is spent');
  });

  it('heads the standings-points table for the league size', () => {
    render(<RulesPage />);
    expect(screen.getByText('In a 12-team league')).toBeTruthy();
  });

  it("shows the current season's settings when they load", async () => {
    current = { id: 'se', name: 'Spring 2027', settings: parseSettings({ stat_weights: { goal: 3, block: 5, turnover: -1 } }) };
    render(<RulesPage />);
    expect(await screen.findByText(/Spring 2027's settings/)).toBeTruthy();
    // D: 5 × 2 = +10. Example: 2 goals × 3 × 2 = 12.
    expect(screen.getByText('D').parentElement?.textContent).toBe('D+10');
    expect(document.body.textContent).toContain('12 × 50% × 0.5 = 3');
  });
});

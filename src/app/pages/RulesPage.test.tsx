// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
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
    // Allowance: 100 for first, 130 for last. Example: 2 goals = 6, a half share, picked for the game before (×0.5).
    expect(text).toContain('100 for the team in first, up to 130 for the team in last');
    expect(text).toContain('2 goals by a player you own half of, picked for the game before: 6 × 50% × 0.5 = 1.5');
    // Split example under the 200-share floor: 100 + 50 credits leave a quarter of the player unowned.
    expect(text).toContain('he has 200 shares: you own 50%, they own 25%, and the other 25% scores for nobody.');
    // Stat points are the weights as stored: a goal is +3, a block (D) +5, a turnover −1.
    expect(screen.getByText('Goal').parentElement?.textContent).toBe('Goal+3');
    expect(screen.getByText('Block (D)').parentElement?.textContent).toBe('Block (D)+5');
    expect(screen.getByText('Turnover').parentElement?.textContent).toBe('Turnover-1');
    expect(text).not.toMatch(/practice/i);
    expect(text).toContain('Picks lock when a stat keeper starts the game');
    expect(text).toContain('Live scores during a game are unofficial and can shift until a keeper verifies the stats.');
    expect(text).toContain('Each roster holds up to 6 players');
    expect(text).toContain('Each game you start 2 of your players');
    expect(text).toContain('Up to 12 teams');
    expect(text).toContain("Forgot to pick, or a pick is out? We pick for you: players who aren't out and you picked least "
      + 'recently, then the ones scoring best lately');
    expect(text).toContain("Keepers mark a player Out for a tournament; an Out player can't be picked.");
    expect(text).not.toMatch(/\b(bench|bids?|bidding|auction)\b/i);
    expect(text).toContain('Leaving a player out for 2 games between picks never does.');
    expect(text).toContain('and earlier tournaments (below)');
    // What ships: the pick card says the factors in words; there is no combined factor to tap open.
    expect(text).toContain('The pick card shows each player\'s share and tiredness in words, e.g. "Your 20% · picked for game 1: ¾ points".');
    expect(text).not.toContain('combined factor');
    expect(text).not.toMatch(/repeat|Rotating/);
    expect(text).toContain("Other teams can't see your picks until the game starts");
    expect(screen.getByText('2 games before').parentElement?.textContent).toBe('2 games before×0.75');
    // Tiredness and earlier tournaments follow the pick, not the field (X5).
    expect(screen.getByText('You last picked them')).toBeTruthy();
    expect(screen.getByText('Earlier tournaments you picked them')).toBeTruthy();
    expect(text).toContain("Stats from a player you've picked in earlier tournaments count a little less");
    expect(text).not.toMatch(/rested|resting|you('ve)? started|started the game/i);
    // Last beats 1st with upset_k 0.5: 3 × (1 + 0.5) = +4.5 for the winner, −1 × 1.5 = −1.5 for the loser.
    expect(screen.getByText('Last beats 1st').parentElement?.textContent).toBe('Last beats 1st+4.5-1.5');
    const standings = screen.getByRole('heading', { name: 'Standings points' }).closest('details')!;
    expect(standings.textContent).toContain('Level on points, the team that scored more over all its games goes first; '
      + 'level on both, they share the place.');
  });

  it('derives the resting sentence from the tiredness steps', async () => {
    current = { id: 'se', name: 'Spring 2027', settings: parseSettings({ tiredness_multipliers: [0.5] }) };
    render(<RulesPage />);
    await screen.findByText(/Spring 2027's settings/);
    expect(document.body.textContent).toContain('Leaving a player out for 1 game between picks never does.');
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

  it('shows Callahan at +12 and the repeat factor from the first repeat', () => {
    render(<RulesPage />);
    expect(screen.getByText('Callahan').parentElement?.textContent).toBe('Callahan+12');
    const decay = screen.getByRole('heading', { name: 'Picking the same player every tournament' }).closest('details')!;
    expect(within(decay).getByRole('cell', { name: '1' }).nextElementSibling?.textContent).toBe('×0.9');
  });

  it('says upsets weigh more only when they do', async () => {
    const upsets = 'Beating a team above you in the standings pays more, and losing to one costs less.';
    const { unmount } = render(<RulesPage />);
    expect(document.body.textContent).toContain(upsets); // default: rank-weighted, upset_k 0.5
    unmount();
    for (const over of [{ points_mode: 'fixed' }, { upset_k: 0 }]) {
      current = { id: 'se', name: 'Spring 2027', settings: parseSettings(over) };
      const { unmount: done } = render(<RulesPage />);
      await screen.findByText(/Spring 2027's settings/);
      expect(document.body.textContent).toContain('Winning earns points and losing costs points.');
      expect(document.body.textContent).not.toContain('Beating a team above you');
      done();
    }
  });

  it('heads the standings-points table for the league size', () => {
    render(<RulesPage />);
    expect(screen.getByText('In a 12-team league')).toBeTruthy();
  });

  it("shows the current season's settings when they load", async () => {
    current = { id: 'se', name: 'Spring 2027', settings: parseSettings({ stat_weights: { goal: 3, block: 5, turnover: -1 } }) };
    render(<RulesPage />);
    expect(await screen.findByText(/Spring 2027's settings/)).toBeTruthy();
    // Block (D): +5. Example: 2 goals × 3 = 6.
    expect(screen.getByText('Block (D)').parentElement?.textContent).toBe('Block (D)+5');
    expect(document.body.textContent).toContain('6 × 50% × 0.5 = 1.5');
  });

  it('leads with the four steps, then six closed folds', () => {
    const { container } = render(<RulesPage />);
    const page = container.querySelector('section.page')!;
    expect(page.children[0].tagName).toBe('H1');
    expect(page.children[1].matches('ol.guide-steps')).toBe(true);
    expect(page.children[1].querySelectorAll('li').length).toBe(4);
    const folds = [...page.querySelectorAll('details.card')];
    expect(folds.map((d) => d.querySelector(':scope > summary > h2')?.textContent)).toEqual(
      ['The season', 'Credits and shares', 'Picks', 'Scoring', 'Standings points', 'Questions']);
    expect(folds.some((d) => d.hasAttribute('open'))).toBe(false);
  });

  it('keeps the visible part short', () => {
    const { container } = render(<RulesPage />);
    const words = [...container.querySelector('section.page')!.children]
      .filter((c) => c.tagName !== 'DETAILS')
      .reduce((sum, c) => sum + c.innerHTML.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length, 0);
    expect(words).toBeLessThanOrEqual(120);
  });

  it('moves creating and leaving a league into Questions', () => {
    render(<RulesPage />);
    const fold = (name: string) => screen.getByRole('heading', { name, level: 2 }).closest('details')!;
    const q = within(fold('Questions'));
    expect(q.getByRole('heading', { name: 'Can I create or leave a league?' })).toBeTruthy();
    expect(fold('Questions').textContent).toContain('You can create one league a season');
    expect(fold('The season').textContent).not.toMatch(/leave/i);
  });

  it('states the roster size once', () => {
    render(<RulesPage />);
    expect((document.body.textContent ?? '').match(/up to 6 players/g)?.length).toBe(1);
  });

  it("uses the season's numbers everywhere (t325)", async () => {
    current = {
      id: 'se', name: 'Spring 2027',
      settings: parseSettings({
        picks_per_game: 3, roster_size: 5, stat_weights: { goal: 4, assist: 3, block: 5, callahan: 10, turnover: -1 },
        tiredness_multipliers: [0.6], decay_floor: 0.5, stat_lock_hours: 24, min_shares: 100, max_members: 8,
      }),
    };
    render(<RulesPage />);
    await screen.findByText(/Spring 2027's settings/);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Pick 3 each game');
    expect(text).toContain('Each game you start 3');
    expect(text).toContain('up to 5 players');
    expect(screen.getByText('Goal').parentElement?.textContent).toBe('Goal+4');
    expect(screen.getByText('Callahan').parentElement?.textContent).toBe('Callahan+10');
    expect(screen.getByText('The game before').parentElement?.textContent).toBe('The game before×0.6');
    expect(text).toContain('Leaving a player out for 1 game');
    expect(text).toContain('never drops below ×0.5');
    expect(text).toContain('reopened for 24 hours');
    expect(text).toContain('In a 8-team league');
    expect(text).toContain('2 goals by a player you own half of, picked for the game before: 8 × 50% × 0.6 = 2.4');
  });
});

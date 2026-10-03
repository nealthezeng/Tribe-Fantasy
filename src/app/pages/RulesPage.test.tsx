// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RulesPage } from './RulesPage';

afterEach(cleanup);

describe('RulesPage', () => {
  it('computes its numbers from the default settings', () => {
    render(<RulesPage />);
    const text = document.body.textContent ?? '';
    // Allowance: 100 for first, 130 for last. Example game: (6+3−4)×2 = 10, ×0.5 tired = 5.
    expect(text).toContain('100 for the team in first, up to 130 for the team in last');
    expect(text).toMatch(/Game score: 10\. If you also started them the game before, it's 10 × 0\.5 = 5\./);
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

  it('says bids may not total more than your credits', () => {
    render(<RulesPage />);
    expect(document.body.textContent).toContain("Your bids together can't be more than your credits");
  });
});

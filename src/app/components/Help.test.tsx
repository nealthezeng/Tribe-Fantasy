// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../../core/settings';
import { FactorHelp, Help, SharesHelp, VerifiedHelp } from './Help';

afterEach(cleanup);
const text = (label: string) => screen.getByRole('button', { name: label }).nextElementSibling!.textContent!;

describe('Help', () => {
  it('opens its text in a popover tied to a labelled ? button', () => {
    render(<Help label="What is X?">Text</Help>);
    const button = screen.getByRole('button', { name: 'What is X?' });
    const pop = button.nextElementSibling!;
    expect(button.textContent).toBe('?');
    expect(button.getAttribute('popovertarget')).toBe(pop.id);
    expect(pop.id).not.toBe('');
    expect(pop.getAttribute('popover')).toBe('auto');
    expect(pop.textContent).toBe('Text');
  });

  it('says the share, tired and lock numbers of the season', () => {
    const S = parseSettings({ min_shares: 100, tiredness_multipliers: [0.6], decay_floor: 0.5, stat_lock_hours: 24 });
    render(<><SharesHelp settings={S} /><FactorHelp settings={S} /><VerifiedHelp hours={S.stat_lock_hours} /></>);
    expect(text('How buying shares works')).toBe('Your credits buy a slice of a player. Each player is 100 shares: a credit '
      + 'buys a share. If teams put more than 100 credits on one player, every slice shrinks to fit. Free credits arrive '
      + 'before each tournament; unspent ones carry over.');
    expect(text('What the × means')).toContain('Tired: ×0.6 if they started the game before.');
    expect(text('What the × means')).toContain('never below ×0.5');
    expect(text('What unofficial and verified mean')).toContain('reopened for 24 hours');
  });

  it('gives the 40-credit example at the default 200 shares', () => {
    render(<SharesHelp settings={DEFAULT_SETTINGS} />);
    expect(text('How buying shares works')).toBe('Your credits buy a slice of a player. Each player is 200 shares: 40 '
      + 'credits buys 40 of them, so you own 20% and score 20% of his points. If teams put more than 200 credits on one '
      + 'player, every slice shrinks to fit. Free credits arrive before each tournament; unspent ones carry over.');
  });

  it('says 1 hour, not 1 hours', () => {
    render(<VerifiedHelp hours={1} />);
    expect(text('What unofficial and verified mean')).toContain('reopened for 1 hour,');
  });

  it('reads the default tired steps, and never for none', () => {
    const { unmount } = render(<FactorHelp settings={DEFAULT_SETTINGS} />);
    expect(text('What the × means')).toContain('×0.5 if they started the game before, ×0.75 if 2 games before');
    unmount();
    render(<FactorHelp settings={{ ...DEFAULT_SETTINGS, tiredness_multipliers: [] }} />);
    expect(text('What the × means')).toContain('Tired: never.');
  });
});

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
    expect(text('How buying shares works')).toContain('A player has 100 shares');
    expect(text('What the × means')).toContain('Tired: ×0.6 if they started the game before.');
    expect(text('What the × means')).toContain('never below ×0.5');
    expect(text('What unofficial and verified mean')).toContain('reopened for 24 hours');
  });

  it('reads the default tired steps, and never for none', () => {
    const { unmount } = render(<FactorHelp settings={DEFAULT_SETTINGS} />);
    expect(text('What the × means')).toContain('×0.5 if they started the game before, ×0.75 if 2 games before');
    unmount();
    render(<FactorHelp settings={{ ...DEFAULT_SETTINGS, tiredness_multipliers: [] }} />);
    expect(text('What the × means')).toContain('Tired: never.');
  });
});

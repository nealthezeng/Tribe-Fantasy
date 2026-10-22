// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Guide, GuideSteps } from './Guide';

vi.mock('../lib/stats', () => ({ loadCurrentSeason: () => Promise.resolve(null) }));

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const show = (uid = 'u1') => render(<MemoryRouter><Guide uid={uid} /></MemoryRouter>);
const guide = () => screen.findByRole('complementary', { name: 'How it works' });

describe('first-visit guide (t320)', () => {
  it('lists the four steps with the pick count', () => {
    const { container } = render(<GuideSteps picks={3} />);
    expect(container.querySelectorAll('li').length).toBe(4);
    expect(container.textContent).toContain('Pick 3 each game.');
    expect(container.textContent).toContain('choose 3 of your players');
  });

  it('shows once, then stays hidden after Got it', async () => {
    const first = show();
    await guide();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('complementary', { name: 'How it works' })).toBeNull();
    expect(localStorage.getItem('tribe.guide.u1')).toBe('1');
    first.unmount();
    show();
    expect(screen.queryByRole('complementary', { name: 'How it works' })).toBeNull();
  });

  it('is per account', async () => {
    localStorage.setItem('tribe.guide.u1', '1');
    show('u2');
    await guide();
  });

  it('shows when storage is blocked and hides for the visit on Got it', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    show();
    await guide();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('complementary', { name: 'How it works' })).toBeNull();
  });

  it('links to the rules', async () => {
    show();
    await guide();
    expect(screen.getByRole('link', { name: 'All the rules' }).getAttribute('href')).toMatch(/\/rules$/);
  });
});

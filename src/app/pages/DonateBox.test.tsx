// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DonateBox } from './DonateBox';

afterEach(cleanup);

describe('DonateBox', () => {
  it('shows the team code and a Venmo link with the code already in the note', () => {
    render(<DonateBox code="BKRT" handle="tribe-fund" creditsPerDollar={20} />);
    fireEvent.click(screen.getByText(/Donate to the team/));
    const link = screen.getByRole('link', { name: /@tribe-fund/ }) as HTMLAnchorElement;
    const url = new URL(link.href);
    expect(url.searchParams.get('recipients')).toBe('tribe-fund');
    expect(url.searchParams.get('note')).toBe('Tribe Fantasy BKRT');
    expect(url.searchParams.get('audience')).toBe('private');
    expect(document.body.textContent).toMatch(/team fund/);
    expect(document.body.textContent).toMatch(/no cash value/);
    expect(document.body.textContent).toMatch(/\$1 = 20 credits/);
  });

  it('copies the code', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DonateBox code="BKRT" handle="tribe-fund" creditsPerDollar={20} />);
    fireEvent.click(screen.getByText(/Donate to the team/));
    fireEvent.click(screen.getByRole('button', { name: /copy bkrt/i }));
    expect(writeText).toHaveBeenCalledWith('BKRT');
    await waitFor(() => expect(screen.getByRole('button', { name: /copied/i })).toBeTruthy());
  });

  it("doesn't throw when the clipboard is unavailable", () => {
    Object.assign(navigator, { clipboard: undefined });
    render(<DonateBox code="BKRT" handle="tribe-fund" creditsPerDollar={20} />);
    fireEvent.click(screen.getByText(/Donate to the team/));
    expect(() => fireEvent.click(screen.getByRole('button', { name: /copy bkrt/i }))).not.toThrow();
    expect(screen.getByRole('button', { name: /copy bkrt/i })).toBeTruthy();
  });
});

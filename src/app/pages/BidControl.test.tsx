// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BidControl } from './AuctionCard';

afterEach(cleanup);

const athlete = { id: 'a1', name: 'Sam', user_id: null, opted_in: true };

function setup(available: number, bid: number | null = null) {
  const onSave = vi.fn(async () => {});
  const onOverBudget = vi.fn();
  render(<BidControl athlete={athlete} bid={bid} minBid={1} available={available} onOverBudget={onOverBudget}
    onSave={onSave} onRemove={async () => {}} />);
  const input = screen.getByLabelText('Credits for shares in Sam');
  return { onSave, onOverBudget, input };
}

describe('BidControl', () => {
  it('locks the row with a hint when the team already holds the most players', () => {
    render(<BidControl athlete={athlete} bid={null} minBid={1} available={50} cap={6} onOverBudget={vi.fn()}
      onSave={async () => {}} onRemove={async () => {}} />);
    expect((screen.getByLabelText('Credits for shares in Sam') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Buy' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Up to 6 players. Remove one first.')).toBeTruthy();
  });

  it('shows the saved line it is given, in green words under the row', () => {
    render(<BidControl athlete={athlete} bid={40} minBid={1} available={50} saved="Saved: 40 credits on Sam."
      onOverBudget={vi.fn()} onSave={async () => {}} onRemove={async () => {}} />);
    const line = screen.getByText('Saved: 40 credits on Sam.');
    expect(line.tagName).toBe('SMALL');
    expect(line.className).toBe('success');
  });

  it('refuses a buy over what you have left: no save, flash, and a message', () => {
    const { onSave, onOverBudget, input } = setup(15);
    fireEvent.change(input, { target: { value: '16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onOverBudget).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe('Not enough credits: you have 15 credits left.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('saves a buy that fits exactly, and clears the message when you type', () => {
    const { onSave, onOverBudget, input } = setup(15);
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
    fireEvent.change(input, { target: { value: '15' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
    expect(onSave).toHaveBeenCalledWith(15);
    expect(onOverBudget).toHaveBeenCalledTimes(1);
  });
});

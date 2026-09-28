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
  const input = screen.getByLabelText('Your bid on Sam, in credits');
  return { onSave, onOverBudget, input };
}

describe('BidControl', () => {
  it('refuses a bid over what you have left: no save, flash, and a message', () => {
    const { onSave, onOverBudget, input } = setup(15);
    fireEvent.change(input, { target: { value: '16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bid' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onOverBudget).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe('Not enough credits: you have 15 credits left.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('saves a bid that fits exactly, and clears the message when you type', () => {
    const { onSave, onOverBudget, input } = setup(15);
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bid' }));
    fireEvent.change(input, { target: { value: '15' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bid' }));
    expect(onSave).toHaveBeenCalledWith(15);
    expect(onOverBudget).toHaveBeenCalledTimes(1);
  });
});

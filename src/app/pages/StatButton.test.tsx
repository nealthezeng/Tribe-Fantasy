// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatButton } from './TallyPage';

const setup = () => {
  const onAdd = vi.fn();
  const onSubtract = vi.fn();
  render(<StatButton athlete="Sam" stat="goal" count={2} weight={3} disabled={false} onAdd={onAdd} onSubtract={onSubtract} />);
  return { onAdd, onSubtract, button: screen.getByRole('button') };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('StatButton', () => {
  it('adds one on a tap', () => {
    const { onAdd, onSubtract, button } = setup();
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    act(() => { vi.advanceTimersByTime(1000); });
    expect([onAdd.mock.calls.length, onSubtract.mock.calls.length]).toEqual([1, 0]);
  });

  it('takes one off on a 500 ms hold and never also adds one when the finger lifts', () => {
    const { onAdd, onSubtract, button } = setup();
    fireEvent.pointerDown(button);
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    expect([onAdd.mock.calls.length, onSubtract.mock.calls.length]).toEqual([0, 1]);
    // The next ordinary tap adds again.
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('cancels the hold when the finger slides off early', () => {
    const { onSubtract, button } = setup();
    fireEvent.pointerDown(button);
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.pointerLeave(button);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onSubtract).not.toHaveBeenCalled();
  });

  it('subtracts from the keyboard with minus, and says so in its label', () => {
    const { onAdd, onSubtract, button } = setup();
    fireEvent.keyDown(button, { key: '-' });
    expect([onAdd.mock.calls.length, onSubtract.mock.calls.length]).toEqual([0, 1]);
    expect(button.getAttribute('aria-label')).toMatch(/hold, or press minus, Delete or Backspace, to take one off/);
    expect(button.getAttribute('aria-keyshortcuts')).toBe('- Delete Backspace');
  });
});

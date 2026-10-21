// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePoll } from './useLoad';

function Poller({ reload, on }: { reload: () => void; on: boolean }) {
  usePoll(reload, on);
  return null;
}

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('usePoll', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); setVisibility('visible'); vi.useRealTimers(); });

  it('reloads every 15 s while on and visible', () => {
    const reload = vi.fn();
    render(<Poller reload={reload} on />);
    act(() => { vi.advanceTimersByTime(45_000); });
    expect(reload).toHaveBeenCalledTimes(3);
  });

  it('stops when hidden and reloads at once when visible again', () => {
    const reload = vi.fn();
    render(<Poller reload={reload} on />);
    setVisibility('hidden');
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(reload).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('never polls when off, and stops on unmount', () => {
    const reload = vi.fn();
    const off = render(<Poller reload={reload} on={false} />);
    act(() => { vi.advanceTimersByTime(45_000); });
    expect(reload).not.toHaveBeenCalled();
    off.unmount();
    const on = render(<Poller reload={reload} on />);
    on.unmount();
    act(() => { vi.advanceTimersByTime(45_000); });
    expect(reload).not.toHaveBeenCalled();
  });
});

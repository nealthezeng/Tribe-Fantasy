// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoad, usePoll } from './useLoad';

describe('useLoad', () => {
  afterEach(cleanup);

  it('settles reload() only when a load it asked for lands: a replaced load never answers it, a failed one does', async () => {
    const loads: { ok: (n: number) => void; fail: (e: Error) => void }[] = [];
    const { result } = renderHook(() => useLoad(() => new Promise<number>((ok, fail) => { loads.push({ ok, fail }); }), []));
    const settled: (boolean | null)[] = [null, null, null]; // null = not settled; else whether fresh data came
    act(() => { void result.current.reload().then((fresh) => { settled[0] = fresh; }); });
    act(() => { void result.current.reload().then((fresh) => { settled[1] = fresh; }); });
    expect(loads).toHaveLength(3); // the first load, then one per reload
    await act(async () => { loads[0].ok(0); loads[1].ok(1); }); // both replaced by the last reload's load
    expect(settled).toEqual([null, null, null]);
    expect(result.current.data).toBeUndefined();
    await act(async () => { loads[2].fail(new Error('offline')); });
    expect(settled).toEqual([false, false, null]); // answered, but no fresh data
    expect(result.current.error).not.toBeNull();
    act(() => { void result.current.reload().then((fresh) => { settled[2] = fresh; }); });
    await act(async () => { loads[3].ok(3); });
    expect(settled[2]).toBe(true);
  });
});

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

  it('never polls on a timer when off, and stops on unmount', () => {
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

  it('reloads when the tab shows again, polling or not', () => {
    const reload = vi.fn();
    const off = render(<Poller reload={reload} on={false} />);
    setVisibility('hidden');
    expect(reload).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(45_000); });
    expect(reload).toHaveBeenCalledTimes(1); // still no timer
    off.unmount();
    setVisibility('hidden');
    setVisibility('visible');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

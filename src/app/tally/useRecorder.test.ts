// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecorder } from './useRecorder';

class FakeRecorder {
  static made: FakeRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(readonly stream: unknown) { FakeRecorder.made.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['sound']) }); this.onstop?.(); }
}

const PRESS = '2026-11-16T18:00:00.000Z';
let streams: { tracks: { stop: () => void }[] }[];
const newStream = () => {
  const s = { tracks: [{ stop: vi.fn() }, { stop: vi.fn() }] };
  streams.push(s);
  return { getTracks: () => s.tracks };
};
const getUserMedia = vi.fn();
const vibrate = vi.fn();
const setVisibility = async (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); // tracks stop a microtask later
};
const tracksStopped = (i: number) => streams[i].tracks.every((t) => vi.mocked(t.stop).mock.calls.length === 1);

function setup() {
  const onClip = vi.fn();
  const hook = renderHook(() => useRecorder(onClip));
  const hold = async (ms: number) => {
    await act(async () => { hook.result.current.start(); });
    act(() => { vi.advanceTimersByTime(ms); });
    act(() => { hook.result.current.stop(); });
  };
  return { onClip, hold, ...hook };
}

describe('useRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(PRESS));
    FakeRecorder.made = [];
    streams = [];
    getUserMedia.mockReset().mockImplementation(async () => newStream());
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  });
  afterEach(async () => {
    cleanup();
    await setVisibility('visible');
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vibrate.mockReset();
  });

  it('hands over a clip held 0.5 s with the press time, buzzing when it starts, and keeps the mic for the next hold', async () => {
    const { onClip, hold, result } = setup();
    await act(async () => { result.current.start(); });
    expect(result.current.listening).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(20);
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { result.current.stop(); });
    expect(result.current.listening).toBe(false);
    expect(onClip).toHaveBeenCalledTimes(1);
    expect(onClip).toHaveBeenCalledWith(expect.any(Blob), PRESS);
    expect((onClip.mock.calls[0][0] as Blob).type).toBe('audio/webm');
    await hold(500);
    expect(onClip).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(tracksStopped(0)).toBe(false);
  });

  it('drops a clip under 0.4 s and says to hold', async () => {
    const { onClip, hold, result } = setup();
    await hold(300);
    expect(onClip).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Hold the button while you talk.');
    act(() => { result.current.clearError(); });
    expect(result.current.error).toBeNull();
  });

  it('stops by itself at 15 s', async () => {
    const { onClip, result } = setup();
    await act(async () => { result.current.start(); });
    act(() => { vi.advanceTimersByTime(14_999); });
    expect(onClip).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onClip).toHaveBeenCalledTimes(1);
    expect(result.current.listening).toBe(false);
    act(() => { result.current.stop(); }); // the late let-go adds nothing
    expect(onClip).toHaveBeenCalledTimes(1);
  });

  it('asks again after the microphone is refused', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const { onClip, hold, result } = setup();
    await act(async () => { result.current.start(); });
    expect(result.current.error).toBe('Allow the microphone for this site to use voice.');
    expect(result.current.listening).toBe(false);
    expect(FakeRecorder.made).toHaveLength(0);
    await hold(500);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(onClip).toHaveBeenCalledTimes(1);
  });

  it('records nothing when let go during the permission prompt, then records the next hold', async () => {
    let allow!: () => void;
    getUserMedia.mockImplementationOnce(() => new Promise((ok) => { allow = () => ok(newStream()); }));
    const { onClip, hold, result } = setup();
    act(() => { result.current.start(); });
    act(() => { result.current.stop(); });
    await act(async () => { allow(); });
    expect(FakeRecorder.made).toHaveLength(0);
    expect(result.current.listening).toBe(false);
    await hold(500);
    expect(FakeRecorder.made).toHaveLength(1);
    expect(onClip).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('releases the mic when the app hides (dropping a hold in progress) and on unmount', async () => {
    const { onClip, hold, result, unmount } = setup();
    await act(async () => { result.current.start(); });
    act(() => { vi.advanceTimersByTime(500); });
    await setVisibility('hidden');
    expect(tracksStopped(0)).toBe(true);
    expect(result.current.listening).toBe(false);
    expect(onClip).not.toHaveBeenCalled();
    await setVisibility('visible');
    await hold(500); // opens the mic again
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(onClip).toHaveBeenCalledTimes(1);
    await act(async () => { unmount(); });
    expect(tracksStopped(1)).toBe(true);
  });

  it('closes a mic that arrives after unmount', async () => {
    let allow!: () => void;
    getUserMedia.mockImplementationOnce(() => new Promise((ok) => { allow = () => ok(newStream()); }));
    const { result, unmount } = setup();
    act(() => { result.current.start(); });
    unmount();
    await act(async () => { allow(); });
    expect(tracksStopped(0)).toBe(true);
    expect(FakeRecorder.made).toHaveLength(0);
  });
});

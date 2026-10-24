// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hearClip, type Heard } from '../tally/hear';
import type { VoiceNote } from '../tally/waiting';
import { VoiceMic } from './VoiceMic';

const PRESS = '2026-11-07T15:00:00.000Z';
const LABEL = 'Hold to talk. Say a player and a stat.';
const LISTENING = 'Listening… let go when done';

// The recorder stands in for the microphone: stop() hands over a clip pressed at PRESS, raise() is its error.
const rec = vi.hoisted(() => ({ can: true, starts: 0, on: false, raise: (() => {}) as (error: string) => void }));
vi.mock('../tally/useRecorder', async () => {
  const { useState: state } = await import('react');
  return {
    canRecord: () => rec.can,
    useRecorder: (onClip: (clip: Blob, startedAt: string) => void) => {
      const [listening, setListening] = state(false);
      const [error, setError] = state<string | null>(null);
      rec.raise = setError;
      return {
        listening, error, clearError: () => setError(null),
        start: () => { rec.starts++; rec.on = true; setListening(true); },
        stop: () => {
          if (!rec.on) return;
          rec.on = false;
          setListening(false);
          onClip(new Blob(['sound']), PRESS);
        },
      };
    },
  };
});
vi.mock('../tally/hear', () => ({ hearClip: vi.fn() }));

const onNote = vi.fn();
const onHeard = vi.fn();
const onAdd = vi.fn();
const onDiscard = vi.fn();

/** The board's side of it: holds the note VoiceMic asks for and shows it back. */
function Board({ online = true, waiting = null }: { online?: boolean; waiting?: number | null }) {
  const [note, setNote] = useState<VoiceNote | null>(null);
  return (
    <VoiceMic names={['Bo Stone', 'Max Ortiz']} online={online} waiting={waiting} note={note}
      onNote={(n) => { onNote(n); setNote(n); }} onHeard={onHeard} onAdd={onAdd} onDiscard={onDiscard} />
  );
}
const mic = () => screen.getByRole('button', { name: LABEL }) as HTMLButtonElement;
const noteText = () => screen.queryByRole('alert')?.textContent ?? screen.queryByRole('status')?.textContent;
/** One hold and let go, answered with `heard`. */
async function call(heard: Heard) {
  vi.mocked(hearClip).mockResolvedValueOnce(heard);
  fireEvent.pointerDown(mic());
  fireEvent.pointerUp(mic());
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
  rec.can = true;
  rec.starts = 0;
  rec.on = false;
  vi.mocked(hearClip).mockReset();
  for (const f of [onNote, onHeard, onAdd, onDiscard]) f.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('VoiceMic (M16 §5.1, §5.4–5.6)', () => {
  it('is not there when the browser cannot record', () => {
    rec.can = false;
    const { container } = render(<Board waiting={2} />);
    expect(container.innerHTML).toBe('');
  });

  it('listens while held, shows it is hearing after the let go, then hands over the words and the press time', async () => {
    let answer!: (h: Heard) => void;
    vi.mocked(hearClip).mockReturnValueOnce(new Promise((done) => { answer = done; }));
    render(<Board />);
    fireEvent.pointerDown(mic());
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(LISTENING);
    fireEvent.pointerUp(mic());
    expect(screen.queryByText(LISTENING)).toBeNull();
    expect((screen.getByRole('button', { name: 'Hearing…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(hearClip).toHaveBeenCalledWith(expect.any(Blob), ['Bo Stone', 'Max Ortiz']);
    await act(async () => answer({ text: 'Bo gets a D' }));
    expect(onHeard).toHaveBeenCalledWith('Bo gets a D', PRESS);
    expect(mic().disabled).toBe(false);
    expect(onNote).not.toHaveBeenCalled();
  });

  it('holds on Space too, without restarting on key repeat', async () => {
    vi.mocked(hearClip).mockResolvedValueOnce({ text: 'Bo gets a D' });
    render(<Board />);
    fireEvent.keyDown(mic(), { key: ' ' });
    fireEvent.keyDown(mic(), { key: ' ', repeat: true });
    expect(screen.getByRole('status').textContent).toBe(LISTENING);
    fireEvent.keyUp(mic(), { key: ' ' });
    await act(async () => {});
    expect(rec.starts).toBe(1);
    expect(onHeard).toHaveBeenCalledWith('Bo gets a D', PRESS);
  });

  it('offline: greyed, and a press says voice needs signal without listening', () => {
    render(<Board online={false} />);
    expect(mic().getAttribute('aria-disabled')).toBe('true');
    fireEvent.pointerDown(mic());
    fireEvent.pointerUp(mic());
    expect(rec.starts).toBe(0);
    expect(hearClip).not.toHaveBeenCalled();
    expect(noteText()).toBe('Voice needs signal. The buttons still work.');
  });

  it.each([
    ['timeout', "Voice didn't answer. Try again, or tap."],
    ['busy', 'Voice is busy. Wait a few seconds, or tap.'],
    ['broken', "Voice isn't working right now. The buttons still work."],
  ] as const)('a %s answer is an alert by the mic, and nothing is heard', async (error, text) => {
    render(<Board />);
    await call({ error });
    expect(screen.getByRole('alert').textContent).toBe(text);
    expect(onHeard).not.toHaveBeenCalled();
  });

  it('two empty calls in a row say the mic is no use here; a good call in between starts the count again', async () => {
    const nothing = "Didn't hear anything. Hold the button while you talk.";
    const noUse = "Voice can't use the microphone here. Try Safari, or tap.";
    render(<Board />);
    await call({ text: '' });
    expect(noteText()).toBe(nothing);
    await call({ text: '' });
    expect(noteText()).toBe(noUse);
    expect(mic().disabled).toBe(false); // still usable
    await call({ text: 'Bo gets a D' });
    expect(onHeard).toHaveBeenCalledTimes(1);
    await call({ error: 'unreadable' });
    expect(noteText()).toBe(nothing);
    await call({ error: 'unreadable' });
    expect(noteText()).toBe(noUse);
    expect(onHeard).toHaveBeenCalledTimes(1);
  });

  it("shows the recorder's own trouble as an alert note", () => {
    render(<Board />);
    act(() => rec.raise('Allow the microphone for this site to use voice.'));
    expect(screen.getByRole('alert').textContent).toBe('Allow the microphone for this site to use voice.');
    expect(onNote).toHaveBeenCalledTimes(1);
  });

  it('while stats wait: Discard, Add N stats (singular at 1, off at 0), and the mic still there', () => {
    const { rerender } = render(<Board waiting={null} />);
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    rerender(<Board waiting={2} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 stats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(mic()).toBeTruthy();
    rerender(<Board waiting={1} />);
    expect(screen.getByRole('button', { name: 'Add 1 stat' })).toBeTruthy();
    rerender(<Board waiting={0} />);
    expect((screen.getByRole('button', { name: 'Add 0 stats' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mic()).toBeTruthy();
  });

  it('a note clears itself after 6 s, and a new board render does not restart the clock', () => {
    const note = { text: 'Added 2 stats.' };
    const { rerender } = render(<VoiceMic names={[]} online waiting={null} note={note} onNote={onNote} onHeard={onHeard} onAdd={onAdd} onDiscard={onDiscard} />);
    expect(screen.getByRole('status').textContent).toBe('Added 2 stats.');
    act(() => { vi.advanceTimersByTime(3000); });
    rerender(<VoiceMic names={[]} online waiting={null} note={note} onNote={(n) => onNote(n)} onHeard={onHeard} onAdd={onAdd} onDiscard={onDiscard} />);
    act(() => { vi.advanceTimersByTime(2999); });
    expect(onNote).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onNote).toHaveBeenCalledWith(null);
  });

  it('a note with Undo shows the button and clears after 5 s', () => {
    const undo = vi.fn();
    const note = { text: 'Dropped 2 stats.', undo };
    const { rerender } = render(<VoiceMic names={[]} online waiting={null} note={note} onNote={onNote} onHeard={onHeard} onAdd={onAdd} onDiscard={onDiscard} />);
    act(() => { vi.advanceTimersByTime(4999); });
    expect(onNote).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onNote).toHaveBeenCalledWith(null);
    onNote.mockReset();
    rerender(<VoiceMic names={[]} online waiting={null} note={{ ...note }} onNote={onNote} onHeard={onHeard} onAdd={onAdd} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(onNote).toHaveBeenCalledWith(null);
  });
});

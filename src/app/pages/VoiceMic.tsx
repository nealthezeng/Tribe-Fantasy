import { useEffect, useRef, useState } from 'react';
import { hearClip, type Heard } from '../tally/hear';
import { canRecord, useRecorder } from '../tally/useRecorder';
import type { VoiceNote } from '../tally/waiting';

interface Props {
  names: string[]; // the board's players, picked ones first
  online: boolean;
  waiting: number | null; // null: nothing waits; else how many Add would send
  note: VoiceNote | null;
  onNote(note: VoiceNote | null): void;
  onHeard(text: string, startedAt: string): void;
  onAdd(): void;
  onDiscard(): void;
}

const FAILED = {
  timeout: "Voice didn't answer. Try again, or tap.",
  busy: 'Voice is busy. Wait a few seconds, or tap.',
  broken: "Voice isn't working right now. The buttons still work.",
};
const HOLD_KEYS = [' ', 'Enter'];

/** The tally board's hold-to-talk mic (M16 §5.1): the mic, the listening bar, the Discard / Add bar and the notes. */
export function VoiceMic(props: Props) {
  return canRecord() ? <Mic {...props} /> : null;
}

function Mic({ names, online, waiting, note, onNote, onHeard, onAdd, onDiscard }: Props) {
  const [hearing, setHearing] = useState(false);
  const empties = useRef(0); // empty or unreadable calls in a row (ruling 6)
  const latest = useRef({ names, onNote, onHeard });
  useEffect(() => { latest.current = { names, onNote, onHeard }; });

  const answered = (heard: Heard, startedAt: string) => {
    setHearing(false);
    const { onNote, onHeard } = latest.current;
    if ('text' in heard && heard.text) {
      empties.current = 0;
      onHeard(heard.text, startedAt);
    } else if ('error' in heard && heard.error !== 'unreadable') {
      empties.current = 0;
      onNote({ text: FAILED[heard.error], alert: true });
    } else {
      empties.current += 1;
      onNote(empties.current > 1
        ? { text: "Voice can't use the microphone here. Try Safari, or tap.", alert: true }
        : { text: "Didn't hear anything. Hold the button while you talk." });
    }
  };
  const { listening, error, start, stop, clearError } = useRecorder((clip, startedAt) => {
    setHearing(true);
    void hearClip(clip, latest.current.names).then((heard) => answered(heard, startedAt));
  });

  useEffect(() => {
    if (!error) return;
    latest.current.onNote({ text: error, alert: true });
    clearError();
  }, [error, clearError]);

  // Ruling 7: a note goes after 6 s, one with Undo after 5 s; a new note starts its own clock.
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => latest.current.onNote(null), note.undo ? 5000 : 6000);
    return () => clearTimeout(timer);
  }, [note]);

  const press = () => {
    if (online) start();
    else onNote({ text: 'Voice needs signal. The buttons still work.' });
  };
  return (
    <>
      {note && (
        <p className="voice-note" role={note.alert ? 'alert' : 'status'}>
          {note.text}
          {note.undo && <button className="linklike" onClick={() => { note.undo?.(); onNote(null); }}>Undo</button>}
        </p>
      )}
      {waiting !== null && (
        <div className="voice-bar">
          <button className="secondary" onClick={onDiscard}>Discard</button>
          <button disabled={waiting === 0} onClick={onAdd}>Add {waiting} {waiting === 1 ? 'stat' : 'stats'}</button>
        </div>
      )}
      {listening && <p className="voice-listen" role="status">Listening… let go when done</p>}
      {/* Last and always here, so the bar coming or going never remounts it mid-hold. */}
      <button className={listening ? 'voice-mic on' : 'voice-mic'} disabled={hearing} aria-disabled={!online || undefined}
        aria-label={hearing ? undefined : 'Hold to talk. Say a player and a stat.'}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); press(); }}
        onPointerUp={stop} onPointerCancel={stop} onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (!HOLD_KEYS.includes(e.key)) return;
          e.preventDefault(); // Enter would click
          if (!e.repeat) press();
        }}
        onKeyUp={(e) => { if (HOLD_KEYS.includes(e.key)) stop(); }}>
        {hearing ? 'Hearing…' : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
          </svg>
        )}
      </button>
    </>
  );
}

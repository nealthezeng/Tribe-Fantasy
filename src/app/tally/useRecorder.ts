import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_MS = 15_000; // a hold stops itself here
const MIN_MS = 400; // shorter is a tap, not a call

/** The browser can record a clip (the board shows the mic only then). */
export const canRecord = (): boolean =>
  typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined';

const close = (mic: Promise<MediaStream> | null) => void mic?.then((s) => s.getTracks().forEach((t) => t.stop()), () => {});

/**
 * Hold to talk: start() on press, stop() on let go; `onClip` gets each clip of 0.4 s or more and the press's ISO time.
 * The mic opens on the first start() and stays open, so later holds don't wait for it, until unmount or the app goes to
 * the background (the phone's mic indicator doesn't stay on).
 */
export function useRecorder(onClip: (clip: Blob, startedAt: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(onClip);
  useEffect(() => { latest.current = onClip; });
  const mic = useRef<Promise<MediaStream> | null>(null); // asked for, or open
  const press = useRef<object | null>(null); // the hold in progress
  const recorder = useRef<MediaRecorder | null>(null); // recording, or stopping: until its stop event
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const stop = useCallback(() => {
    press.current = null;
    clearTimeout(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  const start = useCallback(function start() {
    // Holding, or the last hold hasn't sent its stop event yet: a new recorder now would have that event end its bar.
    if (press.current || recorder.current) return;
    const me = {};
    press.current = me;
    const startedAt = new Date().toISOString();
    setError(null);
    const kept = mic.current;
    const asked = (mic.current ??= navigator.mediaDevices.getUserMedia({ audio: true }));
    asked.then((stream) => {
      if (press.current !== me) return; // let go (or the mic was released) during the permission prompt
      if (kept && stream.getAudioTracks().every((t) => t.readyState !== 'live' || t.muted)) {
        // The kept mic died (a phone call took it, say): open a fresh one, with no prompt once allowed. Only a kept
        // one, so a fresh mic that is dead too goes on (and records silence) instead of asking again forever.
        close(asked);
        mic.current = null;
        press.current = null;
        start();
        return;
      }
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const began = Date.now();
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        recorder.current = null;
        setListening(false);
        if (Date.now() - began < MIN_MS) setError('Hold the button while you talk.');
        else latest.current(new Blob(chunks, { type: rec.mimeType }), startedAt);
      };
      rec.start();
      recorder.current = rec;
      setListening(true);
      navigator.vibrate?.(20);
      timer.current = setTimeout(stop, MAX_MS);
    }).catch((e: unknown) => {
      // Refused, or a mic that can't be used (in use, missing, a stream start() throws on): the next hold asks again.
      if (press.current === me) press.current = null;
      if (mic.current === asked) { close(asked); mic.current = null; }
      setError((e as { name?: unknown } | null)?.name === 'NotAllowedError'
        ? 'Allow the microphone for this site to use voice.'
        : "Voice can't use the microphone here. Try Safari, or tap.");
    });
  }, [stop]);

  useEffect(() => {
    const release = () => {
      if (recorder.current) recorder.current.onstop = null; // never let go: the clip is dropped
      stop();
      recorder.current = null;
      setListening(false);
      close(mic.current);
      mic.current = null;
    };
    const onHide = () => { if (document.visibilityState === 'hidden') release(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); release(); };
  }, [stop]);

  const clearError = useCallback(() => setError(null), []);
  return { listening, error, start, stop, clearError };
}

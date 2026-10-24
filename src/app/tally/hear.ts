import { isEcho, whisperHint } from '../../core/voice';
import { supabase } from '../lib/supabase';
import { toWav } from '../lib/wav';

/** What a call came back as: the words heard ('' = nothing), or why there are none. */
export type Heard = { text: string } | { error: 'timeout' | 'busy' | 'broken' | 'unreadable' };

// Calibration knob: a silent hold makes Whisper echo its prompt, so a clip whose loudest sample (0…1) is below this
// is heard as nothing without being sent.
export const SILENT_PEAK = 0.01;
const ANSWER_MS = 10_000;

/** Asks the `voice` Edge Function what was said in `clip`; `names` are the board's players, picked ones first. */
export async function hearClip(clip: Blob, names: string[]): Promise<Heard> {
  let audio: { wav: Blob; peak: number };
  try {
    audio = await toWav(clip);
  } catch {
    return { error: 'unreadable' };
  }
  if (audio.peak < SILENT_PEAK) return { text: '' };
  if (!supabase) return { error: 'broken' };
  const prompt = whisperHint(names);
  const body = new FormData();
  body.append('audio', audio.wav, 'clip.wav');
  body.append('names', JSON.stringify(names));
  body.append('prompt', prompt);
  // Raced, not only aborted: invoke first waits for the session, which an aborted fetch doesn't cut short.
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), ANSWER_MS);
  const late = new Promise<null>((done) => stop.signal.addEventListener('abort', () => done(null)));
  const answer = await Promise.race([supabase.functions.invoke('voice', { body, signal: stop.signal }), late]);
  clearTimeout(timer);
  if (!answer) return { error: 'timeout' };
  if (answer.error) {
    if ((answer.error as { context?: Response }).context?.status === 429) return { error: 'busy' };
    console.error('voice', answer.error);
    return { error: 'broken' };
  }
  const text = (answer.data as { text?: unknown } | null)?.text;
  return { text: typeof text === 'string' && !isEcho(text, prompt) ? text.trim() : '' };
}

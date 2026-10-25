import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { whisperHint } from '../../core/voice';
import { supabase } from '../lib/supabase';
import { toWav } from '../lib/wav';
import { hearClip } from './hear';

vi.mock('../lib/wav', () => ({ toWav: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }));

const invoke = vi.mocked(supabase!.functions.invoke);
const names = ['Bo Reyes', 'Kit Ortiz', 'Lu Park'];
const clip = new Blob(['webm']);
const httpError = (status: number) => ({ data: null, error: Object.assign(new Error('non-2xx'), { context: new Response('{}', { status }) }) });
const sent = () => invoke.mock.calls[0][1] as { body: FormData; signal: AbortSignal };

describe('hearClip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(toWav).mockResolvedValue({ wav: new Blob(['wav']), peak: 0.5 });
  });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks(); });

  it('sends the WAV with the names and the hint, and returns what was heard', async () => {
    invoke.mockResolvedValue({ data: { text: ' Bo gets a D ' }, error: null });
    expect(await hearClip(clip, names)).toEqual({ text: 'Bo gets a D' });
    expect(invoke).toHaveBeenCalledWith('voice', expect.anything());
    const { body } = sent();
    expect((body.get('audio') as File).name).toBe('clip.wav');
    expect(JSON.parse(body.get('names') as string)).toEqual(names);
    expect(body.get('prompt')).toBe(whisperHint(names));
    expect(vi.getTimerCount()).toBe(0); // the 10 s timeout is cleared once the answer lands
  });

  it('says busy on a 429 and broken on any other failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    invoke.mockResolvedValueOnce(httpError(429));
    expect(await hearClip(clip, names)).toEqual({ error: 'busy' });
    invoke.mockResolvedValueOnce(httpError(500));
    expect(await hearClip(clip, names)).toEqual({ error: 'broken' });
    expect(log).toHaveBeenCalledTimes(1); // the detail goes to the console only
  });

  it('gives up after 10 s without an answer and aborts the call', async () => {
    invoke.mockReturnValue(new Promise(() => {}));
    let heard: unknown;
    void hearClip(clip, names).then((h) => { heard = h; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(heard).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(heard).toEqual({ error: 'timeout' });
    expect(sent().signal.aborted).toBe(true);
  });

  it('says unreadable when the clip will not convert', async () => {
    vi.mocked(toWav).mockRejectedValue(new Error('EncodingError'));
    expect(await hearClip(clip, names)).toEqual({ error: 'unreadable' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('hears nothing in a silent clip without asking Whisper', async () => {
    vi.mocked(toWav).mockResolvedValue({ wav: new Blob(['wav']), peak: 0.005 });
    expect(await hearClip(clip, names)).toEqual({ text: '' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('hears nothing when Whisper echoes its prompt or returns no text', async () => {
    const echo = whisperHint(names).split('. ').slice(0, 2).join('. ') + '.';
    invoke.mockResolvedValueOnce({ data: { text: echo }, error: null });
    expect(await hearClip(clip, names)).toEqual({ text: '' });
    invoke.mockResolvedValueOnce({ data: { text: '' }, error: null });
    expect(await hearClip(clip, names)).toEqual({ text: '' });
    invoke.mockResolvedValueOnce({ data: { text: ' . ' }, error: null }); // no letter or digit: nothing said
    expect(await hearClip(clip, names)).toEqual({ text: '' });
  });
});

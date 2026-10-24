// Voice tally (spec docs/superpowers/specs/2026-10-24-m16-voice-tally-design.md §5.2): the tally board posts a short
// 16 kHz WAV clip, the board's player names and a Whisper prompt built on the phone; this asks Groq's
// whisper-large-v3 what was said and returns { text }. Only signed-in keepers and admins get an answer. Writes
// nothing, and logs only timing and status, never what was said. Deployed by pasting into the dashboard; Verify JWT
// may stay on (docs/setup-supabase.md "Voice tally"). Secret: GROQ_API_KEY.

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };

const MAX_AUDIO = 2_000_000; // bytes: about a minute of the phone's 16 kHz WAV (the phone stops at 15 s)
const SITE = /^(https:\/\/nealthezeng\.github\.io|http:\/\/localhost:\d+)$/;

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

// The board's names: 1–80, each 1–60 characters, no <, > or line breaks. Checked only; the phone built the prompt.
const list = (v: FormDataEntryValue | null) => {
  try {
    const a: unknown = JSON.parse(String(v ?? ''));
    return Array.isArray(a) && a.length > 0 && a.length <= 80 && a.every((s) => typeof s === 'string' && /^[^<>\r\n]{1,60}$/.test(s));
  } catch {
    return false;
  }
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const headers = SITE.test(origin) ? { ...cors, 'Access-Control-Allow-Origin': origin } : cors;
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  const t0 = performance.now();
  // Anything that throws (a network error, a reply that isn't JSON) is an upstream failure, still with CORS.
  const [status, body] = await answer(req).catch((): Answer => [502, { error: 'UPSTREAM' }]);
  console.log(JSON.stringify({ ms: Math.round(performance.now() - t0), status }));
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
});

type Answer = [number, { text: string } | { error: string }];

async function answer(req: Request): Promise<Answer> {
  // Keepers only, before anything reaches Groq. Asked of the database with the caller's own token, so it holds
  // whether or not "Verify JWT" is on.
  const keeper = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/is_keeper`, {
    method: 'POST',
    headers: {
      authorization: req.headers.get('authorization') ?? '',
      apikey: req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (!keeper.ok || (await keeper.json()) !== true) return [403, { error: 'FORBIDDEN' }];

  const form = await req.formData().catch(() => null);
  const audio = form?.get('audio');
  const prompt = form?.get('prompt');
  if (!(audio instanceof File) || audio.size === 0 || audio.size > MAX_AUDIO || !list(form?.get('names') ?? null)
    || typeof prompt !== 'string' || prompt.length > 4000) {
    return [400, { error: 'BAD_REQUEST' }];
  }

  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) return [502, { error: 'UPSTREAM' }];
  const r = await transcribe(audio, prompt, key);
  if (r.status === 429) return [429, { error: 'BUSY' }];
  if (!r.ok) return [502, { error: 'UPSTREAM' }];
  return [200, { text: ((await r.json()) as { text?: string }).text ?? '' }];
}

// Not -turbo: in local tries turbo once looped on a name and misheard others.
// ponytail: Whisper's prompt is capped at 224 tokens (about 700 characters), so a roster past about 35 names is cut;
// the phone puts the likeliest names first.
function transcribe(audio: File, prompt: string, key: string) {
  const body = new FormData();
  body.append('file', audio, 'clip.wav');
  for (const [k, v] of [['model', 'whisper-large-v3'], ['prompt', prompt.slice(0, 700)], ['language', 'en'], ['temperature', '0'], ['response_format', 'json']]) {
    body.append(k, v);
  }
  return fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body });
}

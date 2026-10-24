/** A stat heard in a spoken call: "Toby gets a D" → { athleteId: <Toby>, stat: 'block' }. */
export interface VoiceEvent {
  athleteId: string;
  stat: string;
}

// What keepers say for each stat. Longest phrase wins, so "turns it over" is one turnover, not "turn" + noise.
const PHRASES: [string[], string][] = ([
  ['turns it over', 'turnover'], ['turned it over', 'turnover'], ['throws it away', 'turnover'], ['threw it away', 'turnover'],
  ['throw away', 'turnover'], ['turn over', 'turnover'], ['turnover', 'turnover'], ['turnovers', 'turnover'],
  ['turn', 'turnover'], ['turns', 'turnover'], ['turf', 'turnover'], ['turfs', 'turnover'], ['drop', 'turnover'],
  ['drops', 'turnover'], ['dropped', 'turnover'], ['throwaway', 'turnover'], ['throwaways', 'turnover'],
  ['stall', 'turnover'], ['stalled', 'turnover'],
  ['d', 'block'], ['ds', 'block'], ['dee', 'block'], ['dees', 'block'], ['block', 'block'], ['blocks', 'block'],
  ['blocked', 'block'],
  ['goal', 'goal'], ['goals', 'goal'], ['score', 'goal'], ['scores', 'goal'], ['scored', 'goal'], ['point', 'goal'],
  ['assist', 'assist'], ['assists', 'assist'],
  ['callahan', 'callahan'], ['callahans', 'callahan'],
] as [string, string][]).map(([p, s]): [string[], string] => [p.split(' '), s]).sort((a, b) => b[0].length - a[0].length);

// "Bo to Ortiz": Bo's assist, Ortiz's goal.
const PASS = new Set(['to', 'two', '2', 'too', 'hits', 'finds']);

// "two Ds": how many, said right before a stat. Bigger numbers are ignored (likelier a mishearing); "a D" is just one.
const COUNTS = new Map(Object.entries({ one: 1, two: 2, three: 3, four: 4, five: 5, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }));

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
// Spellings that sound alike read the same: Tobie, Tobey, Toby → "tobi".
const sound = (w: string) => w.replace(/(.)\1+/g, '$1').replace(/(ie|ey|ee|y)$/, 'i');

/**
 * Stats in a transcript, in the order said. A stat goes to the player named before it; "A to B" is A's assist and
 * B's goal; a player is found by full name, or by a first or last name only they have.
 * ponytail: naive word matcher (names must sound-match exactly, no typo tolerance: it turned "then" into a player's
 * name; the stat must follow the name). A model that returns events is the upgrade if keepers talk freely.
 */
export function parseStats(text: string, roster: { id: string; name: string }[], stats: readonly string[]): VoiceEvent[] {
  const said = words(text);
  const full = roster.map((a) => ({ id: a.id, parts: words(a.name).map(sound) })).filter((a) => a.parts.length > 1)
    .sort((a, b) => b.parts.length - a.parts.length);
  const owners = new Map<string, Set<string>>();
  for (const a of roster) for (const p of words(a.name)) owners.set(sound(p), (owners.get(sound(p)) ?? new Set()).add(a.id));
  const single = new Map([...owners].filter(([, ids]) => ids.size === 1).map(([p, ids]) => [p, [...ids][0]]));

  const fullAt = (i: number) => full.find((a) => a.parts.every((p, k) => said[i + k] !== undefined && sound(said[i + k]) === p));
  // Every stat word is read, so "two callahans" is a count even when the season doesn't count Callahans.
  const statAt = (i: number) => PHRASES.find(([p]) => p.every((w, k) => said[i + k] === w));

  const out: VoiceEvent[] = [];
  let cur: string | null = null; // the player the next stat belongs to
  let last: string | null = null; // cur's last stat, so "Bo to Ortiz for the score" is still one goal for Ortiz
  let thrower: string | null = null; // "Bo to …", waiting for the catcher
  let nameEnd = -1; // where the last name ended: "Jean Luc Moro" heard word by word (full name misspelt) is one naming
  const named = (id: string, at: number, end: number) => {
    const again = id === cur && at === nameEnd;
    nameEnd = end;
    if (again) return;
    if (thrower && stats.includes('assist') && stats.includes('goal')) {
      out.push({ athleteId: thrower, stat: 'assist' }, { athleteId: id, stat: 'goal' });
      last = 'goal';
    } else last = null;
    thrower = null;
    cur = id;
  };
  for (let i = 0; i < said.length;) {
    const f = fullAt(i);
    if (f) { named(f.id, i, i + f.parts.length); i += f.parts.length; continue; }
    const n = statAt(i + 1) && COUNTS.get(said[i]); // a count only before a stat: "Bo two Ortiz" is a pass
    const s = statAt(n ? i + 1 : i);
    if (s) {
      if (cur) {
        // a count always adds; the stat again without one is not a second; a stat the season doesn't count adds nothing
        const times = !stats.includes(s[1]) ? 0 : n || (s[1] === last ? 0 : 1);
        for (let k = 0; k < times; k++) out.push({ athleteId: cur, stat: s[1] });
        last = s[1];
      }
      thrower = null;
      i += (n ? 1 : 0) + s[0].length;
      continue;
    }
    const id = single.get(sound(said[i]));
    if (id) named(id, i, i + 1);
    else if (PASS.has(said[i]) && cur && last === null) thrower = cur; // not "Bo turns it over to Ortiz"
    i++;
  }
  return out;
}

// Whisper copies spelling best from a prompt that reads like the transcript it should write: made-up calls in our
// words with real names, then the whole roster.
export function whisperHint(names: string[]): string {
  const n = (i: number) => names[i % names.length];
  return `${n(0)} gets a D. ${n(1)} to ${n(2)} for the goal. ${n(3)} turns it over. ${n(4)} assist. ${n(5)} Callahan. `
    + `Players: ${names.join(', ')}.`;
}

/**
 * Whisper sometimes returns its prompt for a silent clip: a run of the hint's words that holds "Players" or is longer
 * than any one made-up call (a real call can be word for word one of them).
 */
export function isEcho(text: string, hint: string): boolean {
  const said = words(text);
  // Cut where whisperHint ends each call, not at every dot: a name can have dots ("T.J.").
  const calls = hint.split('Players:')[0].split(/(?<=gets a D|for the goal|turns it over|assist|Callahan)\./);
  return ` ${words(hint).join(' ')} `.includes(` ${said.join(' ')} `)
    && (said.includes('players') || said.length > Math.max(...calls.map((c) => words(c).length)));
}

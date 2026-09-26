import { parseSettings, type SeasonSettings } from '../../core/settings';
import { supabase } from './supabase';

const STAT_LABELS: Record<string, string> = { goal: 'Goal', assist: 'Assist', block: 'D', callahan: 'Callahan', turnover: 'Turnover' };
export const statLabel = (key: string) => STAT_LABELS[key] ?? key;

export interface CurrentSeason {
  id: string;
  name: string;
  settings: SeasonSettings;
}

/** ponytail: the newest season is "current"; add a season picker if two ever run at once. */
export async function loadCurrentSeason(): Promise<CurrentSeason | null> {
  const { data, error } = await supabase!
    .from('seasons')
    .select('id, name, settings')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, name: data.name, settings: parseSettings(data.settings) } : null;
}

export interface SessionRow {
  id: string;
  season_id: string;
  kind: 'practice' | 'tournament';
  held_on: string;
  counts: boolean;
  verified_by: string | null;
  verified_at: string | null;
}
export const SESSION_COLUMNS = 'id, season_id, kind, held_on, counts, verified_by, verified_at';

export type SessionState = 'open' | 'verified' | 'locked';

export function sessionState(s: Pick<SessionRow, 'verified_at'>, lockHours: number, now = Date.now()): SessionState {
  if (!s.verified_at) return 'open';
  return Date.parse(s.verified_at) + lockHours * 3_600_000 <= now ? 'locked' : 'verified';
}

export function lockTime(s: Pick<SessionRow, 'verified_at'>, lockHours: number): string {
  return new Date(Date.parse(s.verified_at!) + lockHours * 3_600_000).toLocaleString();
}

/** '2026-09-25' → 'Fri, Sep 25'. Parsed as a local date so it never shifts a day across time zones. */
export function formatDay(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export const kindLabel = (kind: SessionRow['kind']) => (kind === 'tournament' ? 'Tournament' : 'Practice');

/** A session's title everywhere it's listed: 'Fri, Sep 25 · Practice'. */
export const sessionTitle = (s: Pick<SessionRow, 'held_on' | 'kind'>) => `${formatDay(s.held_on)} · ${kindLabel(s.kind)}`;

/** Today in the phone's time zone, as YYYY-MM-DD for <input type="date">. */
export function todayLocal(now = new Date()): string {
  const off = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - off).toISOString().slice(0, 10);
}

/** RFC 4180 CSV. Text starting with = + - @ gets a leading ' so spreadsheets don't run it as a formula. */
export function toCsv(rows: (string | number | boolean)[][]): string {
  const cell = (v: string | number | boolean) => {
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

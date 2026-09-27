import { supabase } from './supabase';

export interface AuctionStage {
  id: string;
  name: string;
  starts_on: string;
  bid_close_at: string | null;
  auction_seed: string | null;
  auction_run_at: string | null;
}
export const AUCTION_STAGE_COLUMNS = 'id, name, starts_on, bid_close_at, auction_seed, auction_run_at';

/** The stage whose auction opened most recently; before any opens, the latest by start date. Creating next stage
 * early must not hide this stage's rosters. */
export function pickAuctionStage(stages: AuctionStage[]): AuctionStage | null {
  const opened = stages.filter((s) => s.bid_close_at).sort((a, b) => b.bid_close_at!.localeCompare(a.bid_close_at!));
  return opened[0] ?? [...stages].sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0] ?? null;
}

export interface BidRow { membership_id: string; athlete_id: string; amount: number }
export interface SlotRow { membership_id: string; athlete_id: string; price: number; via: 'bid' | 'fill' }

export type AuctionPhase = 'not_open' | 'open' | 'closed' | 'run';

export function auctionPhase(s: Pick<AuctionStage, 'bid_close_at' | 'auction_run_at'>, now = Date.now()): AuctionPhase {
  if (s.auction_run_at) return 'run';
  if (!s.bid_close_at) return 'not_open';
  return new Date(s.bid_close_at).getTime() > now ? 'open' : 'closed';
}

/** 'in 1 d 4 h', 'in 3 h 5 min', 'in 4 min', 'in under a minute'. */
export function timeLeft(closeAt: string, now = Date.now()): string {
  const min = Math.floor((new Date(closeAt).getTime() - now) / 60_000);
  if (min < 1) return 'in under a minute';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `in ${d} d ${h} h`;
  if (h > 0) return `in ${h} h ${m} min`;
  return `in ${m} min`;
}

export const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Athletes on `userId`'s rosters in the latest stage of the season whose auction has run (mirrors owns_athlete). */
export async function loadOwnedAthletes(userId: string, seasonId: string): Promise<Set<string>> {
  const stage = await supabase!.from('stages').select('id').eq('season_id', seasonId)
    .not('auction_run_at', 'is', null).order('starts_on', { ascending: false }).limit(1).maybeSingle();
  if (stage.error) throw stage.error;
  if (!stage.data) return new Set();
  const mine = await supabase!.from('memberships').select('id').eq('user_id', userId);
  if (mine.error) throw mine.error;
  const slots = await supabase!.from('roster_slots').select('athlete_id').eq('stage_id', stage.data.id)
    .in('membership_id', (mine.data ?? []).map((m) => m.id));
  if (slots.error) throw slots.error;
  return new Set((slots.data ?? []).map((s) => s.athlete_id as string));
}

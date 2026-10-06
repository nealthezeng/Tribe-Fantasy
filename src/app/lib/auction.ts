import { todayLocal } from './stats';
import { supabase } from './supabase';

export interface AuctionStage {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  bid_close_at: string | null;
  auction_seed: string | null;
  auction_run_at: string | null;
}
export const AUCTION_STAGE_COLUMNS = 'id, name, starts_on, ends_on, bid_close_at, auction_seed, auction_run_at';

/** The stage whose auction opened most recently; before any opens, the latest by start date. Creating next stage
 * early must not hide this stage's rosters. */
export function pickAuctionStage<T extends Pick<AuctionStage, 'bid_close_at' | 'starts_on'>>(stages: T[]): T | null {
  const opened = stages.filter((s) => s.bid_close_at).sort((a, b) => b.bid_close_at!.localeCompare(a.bid_close_at!));
  return opened[0] ?? [...stages].sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0] ?? null;
}

/** The tournament being played: the earliest auctioned stage whose last day hasn't passed; else the latest auctioned
 * one (so a game still live after the last day can be finished). Opening a later stage's auction never hides it. */
export function pickPlayingStage<T extends Pick<AuctionStage, 'id' | 'starts_on' | 'ends_on' | 'auction_run_at'>>(stages: T[], today: string): T | null {
  const run = stages.filter((s) => s.auction_run_at).sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.id.localeCompare(b.id));
  return run.find((s) => s.ends_on >= today) ?? run.at(-1) ?? null;
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

/**
 * Stages whose rosters count as "owning" (mirrors private.owns_athlete, 0009): the latest auctioned stage, plus any
 * auctioned stage that ended in the last week. The window is a day wider than the database's, so the tally screen
 * greys out at least every athlete the server would refuse (one refused tap drops its whole batch).
 */
export function ownershipStages(stages: { id: string; starts_on: string; ends_on: string }[], today: string): string[] {
  if (stages.length === 0) return [];
  const latest = [...stages].sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0];
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 8);
  const cutoff = d.toISOString().slice(0, 10);
  return stages.filter((s) => s.id === latest.id || s.ends_on >= cutoff).map((s) => s.id);
}

/** Athletes `userId` owns in the season (see ownershipStages). */
export async function loadOwnedAthletes(userId: string, seasonId: string, today = todayLocal()): Promise<Set<string>> {
  const stages = await supabase!.from('stages').select('id, starts_on, ends_on').eq('season_id', seasonId)
    .not('auction_run_at', 'is', null);
  if (stages.error) throw stages.error;
  const ids = ownershipStages(stages.data ?? [], today);
  if (ids.length === 0) return new Set();
  const slots = await supabase!.from('roster_slots').select('athlete_id, memberships!inner(user_id)')
    .in('stage_id', ids).eq('memberships.user_id', userId);
  if (slots.error) throw slots.error;
  return new Set((slots.data ?? []).map((s) => s.athlete_id as string));
}

import { describe, expect, it } from 'vitest';
import { auctionPhase, ownershipStages, pickAuctionStage, timeLeft, type AuctionStage } from './auction';

const now = Date.parse('2026-10-18T12:00:00Z');

describe('auctionPhase', () => {
  it('follows the stage columns and the clock', () => {
    expect(auctionPhase({ bid_close_at: null, auction_run_at: null }, now)).toBe('not_open');
    expect(auctionPhase({ bid_close_at: '2026-10-18T12:00:01Z', auction_run_at: null }, now)).toBe('open');
    expect(auctionPhase({ bid_close_at: '2026-10-18T12:00:00Z', auction_run_at: null }, now)).toBe('closed');
    expect(auctionPhase({ bid_close_at: '2026-10-18T11:00:00Z', auction_run_at: '2026-10-18T11:30:00Z' }, now)).toBe('run');
  });
});

describe('timeLeft', () => {
  it('rounds down to days and hours, hours and minutes, or minutes', () => {
    expect(timeLeft('2026-10-19T16:30:00Z', now)).toBe('in 1 d 4 h');
    expect(timeLeft('2026-10-18T15:05:30Z', now)).toBe('in 3 h 5 min');
    expect(timeLeft('2026-10-18T12:04:00Z', now)).toBe('in 4 min');
    expect(timeLeft('2026-10-18T12:00:30Z', now)).toBe('in under a minute');
    expect(timeLeft('2026-10-18T11:00:00Z', now)).toBe('in under a minute');
  });
});

describe('pickAuctionStage', () => {
  const stage = (id: string, starts_on: string, bid_close_at: string | null): AuctionStage =>
    ({ id, name: id, starts_on, ends_on: starts_on, bid_close_at, auction_seed: null, auction_run_at: null });

  it('keeps showing the stage whose auction opened last when a later stage is created early', () => {
    const fall = stage('fall', '2026-10-18', '2026-10-19T20:00:00Z');
    const spring = stage('spring', '2027-02-01', null);
    expect(pickAuctionStage([fall, spring])?.id).toBe('fall');
    const springOpen = { ...spring, bid_close_at: '2027-01-31T20:00:00Z' };
    expect(pickAuctionStage([fall, springOpen])?.id).toBe('spring');
  });

  it('falls back to the latest stage before any auction opens, and to null with no stages', () => {
    expect(pickAuctionStage([stage('a', '2026-10-18', null), stage('b', '2027-02-01', null)])?.id).toBe('b');
    expect(pickAuctionStage([])).toBeNull();
  });
});

describe('ownershipStages', () => {
  const st = (id: string, starts_on: string, ends_on: string) => ({ id, starts_on, ends_on });
  it('keeps the latest stage and any that ended in the last 8 days', () => {
    const stages = [st('old', '2026-09-01', '2026-10-01'), st('fall', '2026-10-18', '2026-11-08'), st('next', '2026-11-09', '2026-11-29')];
    expect(ownershipStages(stages, '2026-11-10')).toEqual(['fall', 'next']);
    expect(ownershipStages(stages, '2026-11-16')).toEqual(['fall', 'next']);
    expect(ownershipStages(stages, '2026-11-17')).toEqual(['next']);
    expect(ownershipStages([], '2026-11-17')).toEqual([]);
  });
});

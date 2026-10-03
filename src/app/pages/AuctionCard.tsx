import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { parseSettings } from '../../core/settings';
import {
  AUCTION_STAGE_COLUMNS, auctionPhase, formatWhen, pickAuctionStage, timeLeft,
  type AuctionStage, type BidRow, type SlotRow,
} from '../lib/auction';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { balance as sumLedger, credits } from '../lib/wallet';

interface Athlete { id: string; name: string; user_id: string | null; opted_in: boolean }
interface Team { id: string; team_name: string }

/**
 * The team card and the auction for one team, in the stage pickAuctionStage chooses. While bidding is open they are
 * one block with a sticky header (players bid on, credits left); otherwise the team card, then the auction collapsed.
 */
export function AuctionCard({ membershipId, leagueId, seasonId, userId, joinedAt, teamName, team, wallet }: {
  membershipId: string; leagueId: string; seasonId: string; userId: string; joinedAt: string;
  teamName: string;
  /** The team card as it looks outside bidding. */
  team: ReactNode;
  /** Credit history, shown inside the combined block while bidding is open. */
  wallet: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const { data, error: loadError, reload } = useLoad(async () => {
    const st = await supabase!.from('stages').select(AUCTION_STAGE_COLUMNS).eq('season_id', seasonId);
    if (st.error) throw st.error;
    const stage = pickAuctionStage((st.data ?? []) as AuctionStage[]);
    if (!stage) return null;
    const [season, athletes, injuries, bids, slots, teams, ledger] = await Promise.all([
      supabase!.from('seasons').select('settings').eq('id', seasonId).single(),
      // All of them, not just opted in: a rostered player who opts out later still needs a name.
      supabase!.from('athletes').select('id, name, user_id, opted_in').eq('season_id', seasonId).order('name'),
      supabase!.from('injuries').select('athlete_id').is('cleared_at', null).not('confirmed_at', 'is', null),
      supabase!.from('bids').select('membership_id, athlete_id, amount').eq('stage_id', stage.id).eq('league_id', leagueId)
        .order('amount', { ascending: false }),
      supabase!.from('roster_slots').select('membership_id, athlete_id, price, via').eq('stage_id', stage.id).eq('league_id', leagueId),
      supabase!.from('memberships').select('id, team_name').eq('league_id', leagueId).order('team_name'),
      // Fetched fresh (not passed as a prop) so a donation credited while the tab is open doesn't leave the client
      // refusing bids with a stale balance.
      supabase!.from('credit_ledger').select('amount').eq('membership_id', membershipId),
    ]);
    for (const r of [season, athletes, injuries, bids, slots, teams, ledger]) if (r.error) throw r.error;
    const settings = parseSettings(season.data!.settings);
    return {
      stage,
      minBid: settings.min_bid,
      rosterSize: settings.roster_size,
      athletes: (athletes.data ?? []) as Athlete[],
      injured: new Set((injuries.data ?? []).map((i) => i.athlete_id as string)),
      bids: (bids.data ?? []) as BidRow[],
      slots: (slots.data ?? []) as SlotRow[],
      teams: (teams.data ?? []) as Team[],
      balance: sumLedger((ledger.data ?? []) as { amount: number }[]),
    };
  }, [seasonId, leagueId, membershipId]);

  // Re-render while bidding is open so the countdown moves and the card flips to "closed" on time.
  const [now, setNow] = useState(Date.now);
  const closeAt = data && !data.stage.auction_run_at ? data.stage.bid_close_at : null;
  useEffect(() => {
    if (!closeAt) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [closeAt]);

  // Over-budget feedback: each bump re-keys the credits number, restarting its flash; 0 = not flashing.
  const [flash, setFlash] = useState(0);
  const flashTimer = useRef<number | undefined>(undefined);
  function overBudget() {
    setFlash((n) => n + 1);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(0), 1200);
    reload(); // a stale balance (e.g. a donation credited while the tab was open) is the likely cause
  }
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  if (loadError) return <>{team}<p className="error" role="alert">{loadError}</p></>;
  if (!data) return <>{team}</>; // loading, or no stage yet
  const { stage, minBid, rosterSize, athletes, injured, bids, slots, teams, balance } = data;
  const phase = auctionPhase(stage, now);
  const name = new Map(athletes.map((a) => [a.id, a.name]));
  const mine = bids.filter((b) => b.membership_id === membershipId);
  const total = mine.reduce((s, b) => s + b.amount, 0);

  async function act(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      if ((err as { message?: string } | null)?.message === 'INSUFFICIENT_CREDITS') overBudget();
      setError(errorMessage(err));
    }
    reload();
  }

  if (phase === 'open') {
    return (
      <article className="card" aria-label={`${teamName}: ${stage.name} auction`}>
        <div className={flash ? 'bid-header over' : 'bid-header'}>
          <div className="head">
            <h2>{stage.name} auction</h2>
            <span className="pill ok">Closes {timeLeft(stage.bid_close_at!, now)}</span>
          </div>
          <div className="bid-sums">
            <p><strong className="big">{mine.length}</strong> <span>{mine.length === 1 ? 'player' : 'players'} bid on · roster {rosterSize}</span></p>
            <p>
              <strong key={flash} className={flash ? 'big flash-bad' : 'big'}>{balance - total}</strong>{' '}
              <span>credits left of {balance}</span>
            </p>
          </div>
        </div>
        <p className="muted">
          Sealed until {formatWhen(stage.bid_close_at!)}. Highest bid wins each player; your bids can't add up to more
          than your credits.
        </p>
        <BidList open={mine.length === 0}
          summary={<>Bid on players <span className="muted">· {athletes.filter((a) => a.opted_in && a.user_id !== userId).length}</span></>}>
          <ul className="list">
            {athletes.filter((a) => a.opted_in).map((a) => {
              const bid = mine.find((b) => b.athlete_id === a.id)?.amount ?? null;
              return (
                <li key={a.id} className="bid-row">
                  <span className="meta">
                    <span className="title">{a.name}</span>
                    {injured.has(a.id) && <span className="pill bad">Injured</span>}
                  </span>
                  {a.user_id === userId ? <span className="muted">That's you</span> : (
                    <BidControl key={`${a.id}:${bid ?? ''}`} athlete={a} bid={bid} minBid={minBid}
                      available={balance - total + (bid ?? 0)} onOverBudget={overBudget}
                      onSave={(amount) => act(() => api.placeBid(stage.id, membershipId, a.id, amount))}
                      onRemove={() => act(() => api.deleteBid(stage.id, membershipId, a.id))} />
                  )}
                </li>
              );
            })}
          </ul>
        </BidList>
        {wallet}
        {error && <p className="error" role="alert">{error}</p>}
      </article>
    );
  }

  return (
    <>
      {team}
      <details className="card" aria-label={`${stage.name} auction`}>
        <summary>
          <h2>{stage.name} auction</h2>
          <span className={phase === 'run' ? 'pill' : 'pill info'}>
            {{ not_open: 'Not open yet', closed: 'Bids closed', run: 'Done' }[phase]}
          </span>
        </summary>

        {phase === 'not_open' && <p className="muted">Bidding hasn't opened for this tournament yet.</p>}

        {phase === 'closed' && <p className="notice">Bids are closed. Rosters appear here once the auction runs.</p>}

        {phase === 'run' && (() => {
          const roster = slots.filter((s) => s.membership_id === membershipId);
          return (
            <>
              <h3>Your roster</h3>
              {roster.length === 0 ? (
                <p className="muted">
                  {new Date(joinedAt) > new Date(stage.auction_run_at!)
                    ? "You joined after this tournament's auction. Your roster starts next tournament."
                    : 'No players this tournament.'}
                </p>
              ) : <SlotList slots={roster} name={name} />}
            </>
          );
        })()}

        {(phase === 'closed' || phase === 'run') && (
          <div className="section">
            <h3>Every team</h3>
            {teams.map((t) => {
              const roster = slots.filter((s) => s.membership_id === t.id);
              const theirBids = bids.filter((b) => b.membership_id === t.id);
              return (
                <details key={t.id}>
                  <summary>{t.team_name} <span className="muted">· {theirBids.length} bids</span></summary>
                  {phase === 'run' && <SlotList slots={roster} name={name} />}
                  <ul className="list">
                    {theirBids.length === 0 && <li className="muted">No bids.</li>}
                    {theirBids.map((b) => (
                      <li key={b.athlete_id}><span>Bid on {name.get(b.athlete_id) ?? 'a player'}</span><strong className="num">{b.amount}</strong></li>
                    ))}
                  </ul>
                </details>
              );
            })}
            {phase === 'run' && (
              <p className="muted"><small>Open spots were filled at random with seed <code>{stage.auction_seed}</code>, never with an injured player.</small></p>
            )}
          </div>
        )}

        {error && <p className="error" role="alert">{error}</p>}
      </details>
    </>
  );
}

/** Starts open or closed once, on mount: a later `open` change (your first bid) must not snap it shut. */
function BidList({ open, summary, children }: { open: boolean; summary: ReactNode; children: ReactNode }) {
  const [startOpen] = useState(open);
  return (
    <details className="section" open={startOpen}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

export function BidControl({ athlete, bid, minBid, available, onOverBudget, onSave, onRemove }: {
  athlete: Athlete; bid: number | null; minBid: number;
  /** Most this bid may be: your balance minus your other bids. */
  available: number;
  onOverBudget: () => void; onSave: (amount: number) => Promise<void>; onRemove: () => Promise<void>;
}) {
  const [value, setValue] = useState(bid === null ? '' : String(bid));
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const amount = Number(value);
  const entered = value.trim() !== '';
  const valid = entered && Number.isInteger(amount) && amount >= minBid;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    if (amount > available) {
      setOver(true);
      onOverBudget();
      return;
    }
    setBusy(true);
    await onSave(amount);
    setBusy(false);
  }

  return (
    <form className="bid" onSubmit={save}>
      <input type="number" inputMode="numeric" min={minBid} step={1} value={value}
        onChange={(e) => { setValue(e.target.value); setOver(false); }}
        aria-label={`Your bid on ${athlete.name}, in credits`} placeholder="Bid" aria-invalid={(entered && !valid) || over} />
      <button disabled={busy || !valid || amount === bid}>{bid === null ? 'Bid' : 'Save'}</button>
      {bid !== null && (
        <button type="button" className="secondary icon" disabled={busy} aria-label={`Remove your bid on ${athlete.name}`}
          onClick={() => { setBusy(true); void onRemove().finally(() => setBusy(false)); }}>
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
        </button>
      )}
      {entered && !valid && <small className="error">Bid at least {minBid}, in whole credits.</small>}
      {over && <small className="error" role="alert">Not enough credits: you have {credits(available)} left.</small>}
    </form>
  );
}

function SlotList({ slots, name }: { slots: SlotRow[]; name: Map<string, string> }) {
  return (
    <ul className="list">
      {slots.map((s) => (
        <li key={s.athlete_id}>
          <span className="title">{name.get(s.athlete_id) ?? 'A player'}</span>
          <span className="muted">{s.via === 'bid' ? credits(s.price) : 'Random fill'}</span>
        </li>
      ))}
    </ul>
  );
}

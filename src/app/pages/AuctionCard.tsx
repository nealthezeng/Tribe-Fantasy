import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { parseSettings } from '../../core/settings';
import { repeatFactor } from '../../core/tournament';
import {
  AUCTION_STAGE_COLUMNS, auctionPhase, pickAuctionStage, timeLeft,
  type AuctionStage, type BidRow,
} from '../lib/auction';
import { SharesHelp } from '../components/Help';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { loadLeagueTournament, loadOpenOuts, type LeagueTournament } from '../lib/tournament';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { balance as sumLedger, credits } from '../lib/wallet';

interface Athlete { id: string; name: string; user_id: string | null; opted_in: boolean }

/**
 * Share buying for one team, in the stage pickAuctionStage chooses: a card with a sticky header (players, credits
 * left) while buying is open, nothing otherwise.
 */
export function AuctionCard({ membershipId, leagueId, seasonId, userId, teamName, getCredits }: {
  membershipId: string; leagueId: string; seasonId: string; userId: string;
  teamName: string;
  /** While buying and the season takes donations, "Get more credits" links to the Credits page. */
  getCredits?: boolean;
}) {
  // A refused buy's message shows on that player's row.
  const [error, setError] = useState<{ athleteId: string; text: string } | null>(null);
  const { data, error: loadError, reload } = useLoad(async () => {
    const st = await supabase!.from('stages').select(AUCTION_STAGE_COLUMNS).eq('season_id', seasonId);
    if (st.error) throw st.error;
    const stage = pickAuctionStage((st.data ?? []) as AuctionStage[]);
    if (!stage) return null;
    const [season, athletes, outs, bids, ledger] = await Promise.all([
      supabase!.from('seasons').select('settings').eq('id', seasonId).single(),
      // All of them, not just opted in: a rostered player who opts out later still needs a name.
      supabase!.from('athletes').select('id, name, user_id, opted_in').eq('season_id', seasonId).order('name'),
      loadOpenOuts(stage.id),
      supabase!.from('bids').select('membership_id, athlete_id, amount').eq('stage_id', stage.id).eq('league_id', leagueId)
        .order('amount', { ascending: false }),
      // Fetched fresh (not passed as a prop) so a donation credited while the tab is open doesn't leave the client
      // refusing buys with a stale balance.
      supabase!.from('credit_ledger').select('amount').eq('membership_id', membershipId),
    ]);
    for (const r of [season, athletes, bids, ledger]) if (r.error) throw r.error;
    const settings = parseSettings(season.data!.settings);
    return {
      stage,
      settings,
      minBid: settings.min_bid,
      rosterSize: settings.roster_size,
      athletes: (athletes.data ?? []) as Athlete[],
      out: new Set(outs.keys()),
      bids: (bids.data ?? []) as BidRow[],
      balance: sumLedger((ledger.data ?? []) as { amount: number }[]),
    };
  }, [seasonId, leagueId, membershipId]);

  // Re-render while buying is open so the countdown moves and the card flips to "closed" on time.
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

  // Your buys as the page loaded them sort first (t237). Fixed for this visit, so a row never jumps as you buy.
  const [kept, setKept] = useState<Set<string> | null>(null);
  const bidOn = (bids: BidRow[]) => new Set(bids.filter((b) => b.membership_id === membershipId).map((b) => b.athlete_id));
  const pinned = kept ?? (data ? bidOn(data.bids) : null);
  useEffect(() => { if (!kept && data) setKept(bidOn(data.bids)); }, [kept, data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) return <p className="error" role="alert">{loadError}</p>;
  if (!data) return null; // loading, or no stage yet
  const { stage, settings, minBid, rosterSize, athletes, out, bids, balance } = data;
  const phase = auctionPhase(stage, now);
  if (phase !== 'open') return null;
  const mine = bids.filter((b) => b.membership_id === membershipId);
  const total = mine.reduce((s, b) => s + b.amount, 0);

  async function act(athleteId: string, action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      if ((err as { message?: string } | null)?.message === 'INSUFFICIENT_CREDITS') overBudget();
      setError({ athleteId, text: errorMessage(err, String(rosterSize)) });
    }
    reload();
  }

  return (
    <article className="card" aria-label={`${teamName}: ${stage.name}, buy shares`}>
      <div className={flash ? 'bid-header over' : 'bid-header'}>
        <div className="head">
          <h2>{stage.name}: buy shares</h2>
          <SharesHelp settings={settings} />
          <span className="pill info">Closes {timeLeft(stage.bid_close_at!, now)}</span>
        </div>
        <div className="bid-sums">
          <p><strong className="big">{mine.length}</strong> <span>of {rosterSize} players</span></p>
          <p>
            <strong key={flash} className={flash ? 'big flash-bad' : 'big'}>{balance - total}</strong>{' '}
            <span>{balance - total === 1 ? 'credit' : 'credits'} left of {balance}</span>
          </p>
          {getCredits && (
            // Running low (under 10% of your balance, or 2 minimum buys): the way to more credits turns gold (t234).
            <Link to="/credits" className={balance - total < Math.max(2 * minBid, balance / 10, 1) ? 'button' : undefined}>
              Get more credits
            </Link>
          )}
        </div>
      </div>
      {total > balance && (
        <p className="notice" role="alert">
          Buys are {credits(total - balance)} over your balance.
        </p>
      )}
      <BidList open={mine.length === 0} loud={mine.length === 0}
        summary={<>Buy shares <span className="muted">· {athletes.filter((a) => a.opted_in && a.user_id !== userId).length} players</span></>}>
        <WithTournament seasonId={seasonId} leagueId={leagueId}>{(tournament) => (
          <ul className="list">
            {/* Players you've bought first, so your buys are findable among the rest (t237). A player who opted out
                after you bought stays until you remove him: he still counts toward the limit. */}
            {athletes.filter((a) => a.opted_in || mine.some((b) => b.athlete_id === a.id))
              .sort((a, b) => Number(!!pinned?.has(b.id)) - Number(!!pinned?.has(a.id)))
              .map((a) => {
              const bid = mine.find((b) => b.athlete_id === a.id)?.amount ?? null;
              // Rounded as the Rules page does; no chip until (or unless) the tournament has loaded.
              const factor = tournament ? +repeatFactor(tournament.result, membershipId, a.id, stage.id, settings).toFixed(2) : 1;
              return (
                <li key={a.id} className="bid-row">
                  <span className="meta">
                    <span className="title">{a.name}</span>
                    {factor < 1 && (
                      <span className="pill warn" aria-label={`Repeat factor ×${factor}: you started them in an earlier tournament`}>×{factor}</span>
                    )}
                    {out.has(a.id) && <span className="pill bad">Out</span>}
                    {!a.opted_in && <span className="pill">Opted out</span>}
                  </span>
                  {a.user_id === userId ? <span className="muted">That's you</span> : (
                    <BidControl key={`${a.id}:${bid ?? ''}`} athlete={a} bid={bid} minBid={minBid}
                      cap={bid === null && mine.length >= rosterSize ? rosterSize : undefined}
                      available={balance - total + (bid ?? 0)} onOverBudget={overBudget}
                      error={error?.athleteId === a.id ? error.text : null}
                      onSave={(amount) => act(a.id, () => api.placeBid(stage.id, membershipId, a.id, amount))}
                      onRemove={() => act(a.id, () => api.deleteBid(stage.id, membershipId, a.id))} />
                  )}
                </li>
              );
            })}
          </ul>
        )}</WithTournament>
      </BidList>
    </article>
  );
}

/**
 * The repeat chips' data, loaded only while the buy list is on screen and apart from the card's own load, so a bid's
 * reload() never re-runs it and a failure only drops the chips (`tournament` stays undefined).
 * ponytail: a second league load on the League tab; share the TournamentCard's if it ever matters.
 */
function WithTournament({ seasonId, leagueId, children }: {
  seasonId: string; leagueId: string; children: (tournament: LeagueTournament | undefined) => ReactNode;
}) {
  return <>{children(useLoad(() => loadLeagueTournament(seasonId, leagueId), [seasonId, leagueId]).data)}</>;
}

/** Starts open or closed once, on mount: a later `open` change (your first buy) must not snap it shut. */
/** Closed, its summary reads as a button: solid gold until you've bought (`loud`), outlined after. */
function BidList({ open, loud, summary, children }: { open: boolean; loud: boolean; summary: ReactNode; children: ReactNode }) {
  const [startOpen] = useState(open);
  return (
    <details className={loud ? 'section bid-cta loud' : 'section bid-cta'} open={startOpen}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

export function BidControl({ athlete, bid, minBid, available, cap, error = null, onOverBudget, onSave, onRemove }: {
  athlete: Athlete; bid: number | null; minBid: number;
  /** Most this buy may be: your balance minus your other buys. */
  available: number;
  /** Set when the team already holds this many players: a new one can't be added, so the row is locked. */
  cap?: number;
  /** The server's refusal of this row's last save or remove. */
  error?: string | null;
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
      <input type="number" inputMode="numeric" min={minBid} step={1} value={value} disabled={cap !== undefined}
        onChange={(e) => { setValue(e.target.value); setOver(false); }}
        aria-label={`Credits for shares in ${athlete.name}`} placeholder="Credits" aria-invalid={(entered && !valid) || over} />
      <button disabled={cap !== undefined || busy || !valid || amount === bid}>{bid === null ? 'Buy' : 'Save'}</button>
      {bid !== null && (
        <button type="button" className="secondary icon" disabled={busy} aria-label={`Remove ${athlete.name}`}
          onClick={() => { setBusy(true); void onRemove().finally(() => setBusy(false)); }}>
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
        </button>
      )}
      {cap !== undefined && <small className="hint">Up to {cap} players. Remove one first.</small>}
      {entered && !valid && <small className="error">Put in at least {minBid}, in whole credits.</small>}
      {over && (
        <small className="error" role="alert">
          {available >= 0 ? `Not enough credits: you have ${credits(available)} left.`
            : 'Not enough credits: your other buys already add up to more than your balance.'}
        </small>
      )}
      {error && !over && <small className="error" role="alert">{error}</small>}
    </form>
  );
}

import { useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import { fmt, lastTournamentForm, loadLeagueTournament, loadOpenOuts, type LeagueTournament } from '../lib/tournament';
import { supabase } from '../lib/supabase';
import { useLoad, usePoll, useReloadOnShow } from '../lib/useLoad';
import { balance as sumLedger, credits, pct, type LedgerEntry } from '../lib/wallet';
import { BuyingContext, Own } from './TournamentCard';

interface Athlete { id: string; name: string; user_id: string | null; opted_in: boolean }
type LedgerRow = Pick<LedgerEntry, 'amount'>;

/**
 * Share buying for one team, in the stage pickAuctionStage chooses: a card with a sticky header (roster slots, credits
 * left) over the player list while buying is open, nothing otherwise. It tells the League tab (BuyingContext) while open.
 */
export function AuctionCard({ membershipId, leagueId, seasonId, userId, teamName, getCredits }: {
  membershipId: string; leagueId: string; seasonId: string; userId: string;
  teamName: string;
  /** While buying and the season takes donations, "Get more credits" links to the Credits page. */
  getCredits?: boolean;
}) {
  // A refused buy's message shows on that player's row.
  const [error, setError] = useState<{ athleteId: string; text: string } | null>(null);
  // A saved buy's confirmation shows on that player's row until the next save anywhere.
  const [saved, setSaved] = useState<{ athleteId: string; text: string } | null>(null);
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
      ledger: (ledger.data ?? []) as LedgerRow[],
    };
  }, [seasonId, leagueId, membershipId]);
  // Re-render while buying is open so the countdown moves and the card flips to "closed" on time.
  const [now, setNow] = useState(Date.now);
  // No poll here: back from another app, a credited donation or a close (even one passed while away) shows at once (X11).
  useReloadOnShow(() => { setNow(Date.now()); reload(); });
  const closeAt = data && !data.stage.auction_run_at ? data.stage.bid_close_at : null;
  useEffect(() => {
    if (!closeAt) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [closeAt]);

  // The league's live share totals while buying is open: polled, so others' buys show within 15 s.
  const stageId = data?.stage.id ?? null;
  const buying = !!data && auctionPhase(data.stage, now) === 'open';
  const shares = useLoad(async () => (stageId && buying ? api.shareTotals(stageId, leagueId) : null), [stageId, leagueId, buying]);
  usePoll(() => void shares.reload(), buying);

  // The League tab's Buy step and Roster dot: time left, and whether the roster still has room.
  const report = useContext(BuyingContext);
  const left = buying && data.stage.bid_close_at ? timeLeft(data.stage.bid_close_at, now) : null;
  const need = !!data && data.bids.filter((b) => b.membership_id === membershipId).length < data.rosterSize;
  useEffect(() => { report(left ? { left, need } : null); }, [report, left, need]);
  useEffect(() => () => report(null), [report]);

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
  const { stage, settings, minBid, rosterSize, athletes, out, bids, ledger } = data;
  const balance = sumLedger(ledger);
  const phase = auctionPhase(stage, now);
  if (phase === 'closed') return <p className="notice">{stage.name}: buying closed</p>;
  if (phase !== 'open') return null;
  const mine = bids.filter((b) => b.membership_id === membershipId);
  const total = mine.reduce((s, b) => s + b.amount, 0);
  async function act(athleteId: string, action: () => Promise<void>, done?: string) {
    setError(null);
    setSaved(null);
    try {
      await action();
      if (done) setSaved({ athleteId, text: done });
    } catch (err) {
      if ((err as { message?: string } | null)?.message === 'INSUFFICIENT_CREDITS') overBudget();
      setError({ athleteId, text: errorMessage(err, String(rosterSize)) });
    }
    reload();
    void shares.reload();
  }

  return (
    <article className="card" aria-label={`${teamName}: ${stage.name}, buy shares`}>
      <div className={flash ? 'bid-header over' : 'bid-header'}>
        <div className="head">
          <h2>{stage.name}: buy shares</h2>
          <SharesHelp settings={settings} />
          <span className="pill info">Closes {timeLeft(stage.bid_close_at!, now)}</span>
        </div>
        {/* The sentences are for screen readers; the eye gets the slots, the number and the bar. */}
        <span className="sr-only">{mine.length} of {rosterSize} players</span>
        <div className="slots" aria-hidden="true">
          {Array.from({ length: Math.max(rosterSize, mine.length) }, (_, i) => {
            const a = mine[i] && athletes.find((x) => x.id === mine[i].athlete_id);
            return <span key={i} className={mine[i] ? 'slot on' : 'slot'}>{a ? initials(a.name) : mine[i] ? '?' : ''}</span>;
          })}
        </div>
        <div className="bid-sums">
          <p>
            <span className="sr-only">{credits(balance - total)} left of {balance}</span>
            <strong key={flash} className={flash ? 'big flash-bad' : 'big'} aria-hidden="true">{balance - total}</strong>
            <span className="bar" aria-hidden="true"><i style={{ width: `${balance > 0 ? Math.max(0, Math.min(100, ((balance - total) / balance) * 100)) : 0}%` }} /></span>
            <span aria-hidden="true">{balance}</span>
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
      <WithTournament seasonId={seasonId} leagueId={leagueId}>{(tournament) => {
        const form = tournament ? lastTournamentForm(tournament, stage.id) : null;
        return (
          <ul className="list">
            {/* Players you've bought first, so your buys are findable among the rest (t237). A player who opted out
                after you bought stays until you remove him: he still counts toward the limit. */}
            {athletes.filter((a) => a.opted_in || mine.some((b) => b.athlete_id === a.id))
              .sort((a, b) => Number(!!pinned?.has(b.id)) - Number(!!pinned?.has(a.id)))
              .map((a) => {
                const bid = mine.find((b) => b.athlete_id === a.id)?.amount ?? null;
                const pool = shares.data ? shares.data[a.id] ?? settings.min_shares : null;
                // Rounded as the Rules page does; no number until (or unless) the tournament has loaded.
                const perGame = form?.perGame.get(a.id);
                const factor = tournament ? +repeatFactor(tournament.result, membershipId, a.id, stage.id, settings).toFixed(2) : 1;
                // "about": the live total can still grow before buying closes, and every slice shrinks with it (X4).
                const own = bid === null ? null : Math.min(1, bid / (pool ?? settings.min_shares));
                return (
                  <li key={a.id} className="bid-row">
                    <span className="meta">
                      {form ? <Link className="title" to={`/player/${a.id}?t=${form.stageId}`}>{a.name}</Link> : <span className="title">{a.name}</span>}
                      {factor < 1 && (
                        <span className="pill warn" aria-label={`picked in an earlier tournament: ${pct(factor)}`}>×{factor}</span>
                      )}
                      {out.has(a.id) && <span className="pill bad">Out</span>}
                      {!a.opted_in && <span className="pill">Opted out</span>}
                      {own !== null && <Own share={own} label={`You own ${pool !== null ? 'about' : 'up to'} ${pct(own)}`} />}
                      {/* The pool only shows once the league has put more on a player than the floor: your slice is shrinking. */}
                      {pool !== null && pool > settings.min_shares && <small>{pool} shares</small>}
                      {/* A phone has no room for a points column beside the buy controls: the number sits under the name. */}
                      {perGame !== undefined && <small title={form?.name}>{fmt(perGame)} pts/g</small>}
                    </span>
                    {a.user_id === userId ? <span className="muted">You</span> : (
                      <BidControl key={`${a.id}:${bid ?? ''}`} athlete={a} bid={bid} minBid={minBid}
                        cap={bid === null && mine.length >= rosterSize ? rosterSize : undefined}
                        available={balance - total + (bid ?? 0)} onOverBudget={overBudget}
                        error={error?.athleteId === a.id ? error.text : null}
                        saved={saved?.athleteId === a.id ? saved.text : null}
                        onSave={(amount) => act(a.id, () => api.placeBid(stage.id, membershipId, a.id, amount),
                          `Saved: ${credits(amount)} on ${a.name}.`)}
                        onRemove={() => act(a.id, () => api.deleteBid(stage.id, membershipId, a.id))} />
                    )}
                  </li>
                );
              })}
          </ul>
        );
      }}</WithTournament>
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

/** "Ari Banks" -> "AB": a bought player in a roster slot. */
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export function BidControl({ athlete, bid, minBid, available, cap, error = null, saved = null, onOverBudget, onSave, onRemove }: {
  athlete: Athlete; bid: number | null; minBid: number;
  /** Most this buy may be: your balance minus your other buys. */
  available: number;
  /** Set when the team already holds this many players: a new one can't be added, so the row is locked. */
  cap?: number;
  /** The server's refusal of this row's last save or remove. */
  error?: string | null;
  /** "Saved: 40 credits on Ari Banks." after this row's last save. */
  saved?: string | null;
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
      {entered && !valid && <small className="error">Put in at least {minBid}, in whole credits.</small>}
      {over && (
        <small className="error" role="alert">
          {available >= 0 ? `Not enough credits: you have ${credits(available)} left.`
            : 'Not enough credits: your other buys already add up to more than your balance.'}
        </small>
      )}
      {error && !over && <small className="error" role="alert">{error}</small>}
      {saved && <small className="success" role="status">{saved}</small>}
    </form>
  );
}

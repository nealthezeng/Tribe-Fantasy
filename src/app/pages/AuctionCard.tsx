import { useState, type FormEvent } from 'react';
import {
  AUCTION_STAGE_COLUMNS, auctionPhase, formatWhen, pickAuctionStage, timeLeft,
  type AuctionStage, type BidRow, type SlotRow,
} from '../lib/auction';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { credits } from '../lib/wallet';

interface Athlete { id: string; name: string; user_id: string | null; opted_in: boolean }
interface Team { id: string; team_name: string }

/** The auction for one team, in the stage pickAuctionStage chooses. */
export function AuctionCard({ membershipId, leagueId, seasonId, userId, balance, joinedAt }: {
  membershipId: string; leagueId: string; seasonId: string; userId: string; balance: number; joinedAt: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const { data, error: loadError, reload } = useLoad(async () => {
    const st = await supabase!.from('stages').select(AUCTION_STAGE_COLUMNS).eq('season_id', seasonId);
    if (st.error) throw st.error;
    const stage = pickAuctionStage((st.data ?? []) as AuctionStage[]);
    if (!stage) return null;
    const [athletes, injuries, bids, slots, teams] = await Promise.all([
      // All of them, not just opted in: a rostered player who opts out later still needs a name.
      supabase!.from('athletes').select('id, name, user_id, opted_in').eq('season_id', seasonId).order('name'),
      supabase!.from('injuries').select('athlete_id').is('cleared_at', null).not('confirmed_at', 'is', null),
      supabase!.from('bids').select('membership_id, athlete_id, amount').eq('stage_id', stage.id).eq('league_id', leagueId)
        .order('amount', { ascending: false }),
      supabase!.from('roster_slots').select('membership_id, athlete_id, price, via').eq('stage_id', stage.id).eq('league_id', leagueId),
      supabase!.from('memberships').select('id, team_name').eq('league_id', leagueId).order('team_name'),
    ]);
    for (const r of [athletes, injuries, bids, slots, teams]) if (r.error) throw r.error;
    return {
      stage,
      athletes: (athletes.data ?? []) as Athlete[],
      injured: new Set((injuries.data ?? []).map((i) => i.athlete_id as string)),
      bids: (bids.data ?? []) as BidRow[],
      slots: (slots.data ?? []) as SlotRow[],
      teams: (teams.data ?? []) as Team[],
    };
  }, [seasonId, leagueId]);

  if (loadError) return <p className="error" role="alert">{loadError}</p>;
  if (!data) return null; // loading, or no stage yet
  const { stage, athletes, injured, bids, slots, teams } = data;
  const phase = auctionPhase(stage);
  const name = new Map(athletes.map((a) => [a.id, a.name]));
  const mine = bids.filter((b) => b.membership_id === membershipId);

  async function act(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
    reload();
  }

  return (
    <article className="card" aria-label={`${stage.name} auction`}>
      <div className="head">
        <h2>{stage.name} auction</h2>
        <span className={phase === 'open' ? 'pill ok' : phase === 'run' ? 'pill' : 'pill info'}>
          {{ not_open: 'Not open yet', open: 'Bidding open', closed: 'Bids closed', run: 'Done' }[phase]}
        </span>
      </div>

      {phase === 'not_open' && <p className="muted">Bidding hasn't opened for this season yet.</p>}

      {phase === 'open' && (
        <>
          <p>Bids close <strong>{timeLeft(stage.bid_close_at!)}</strong> · {formatWhen(stage.bid_close_at!)}</p>
          <p className="muted">
            Bids are sealed: nobody sees them until bidding closes. You're bidding on {mine.length} players,{' '}
            {credits(mine.reduce((s, b) => s + b.amount, 0))} in total, with {credits(balance)} to spend. Your total can go
            over that, but the auction only gives you what you can afford, highest bids first.
          </p>
          <ul className="list">
            {athletes.filter((a) => a.opted_in).map((a) => (
              <li key={a.id}>
                <span className="meta">
                  <span className="title">{a.name}</span>
                  {injured.has(a.id) && <span className="pill bad">Injured</span>}
                </span>
                {a.user_id === userId ? <span className="muted">That's you</span> : (
                  <BidControl key={`${a.id}:${mine.find((b) => b.athlete_id === a.id)?.amount ?? ''}`}
                    athlete={a} bid={mine.find((b) => b.athlete_id === a.id)?.amount ?? null}
                    onSave={(amount) => act(() => api.placeBid(stage.id, membershipId, a.id, amount))}
                    onRemove={() => act(() => api.deleteBid(stage.id, membershipId, a.id))} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {phase === 'closed' && <p className="notice">Bids are closed. Rosters appear here once the auction runs.</p>}

      {phase === 'run' && (() => {
        const roster = slots.filter((s) => s.membership_id === membershipId);
        return (
          <>
            <h3>Your roster</h3>
            {roster.length === 0 ? (
              <p className="muted">
                {new Date(joinedAt) > new Date(stage.auction_run_at!)
                  ? "You joined after this stage's auction. Your roster starts next stage."
                  : 'No players this stage.'}
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
    </article>
  );
}

function BidControl({ athlete, bid, onSave, onRemove }: {
  athlete: Athlete; bid: number | null; onSave: (amount: number) => Promise<void>; onRemove: () => Promise<void>;
}) {
  const [value, setValue] = useState(bid === null ? '' : String(bid));
  const [busy, setBusy] = useState(false);
  const amount = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(amount) && amount >= 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    await onSave(amount);
    setBusy(false);
  }

  return (
    <form className="bid" onSubmit={save}>
      <input type="number" inputMode="numeric" min={0} step={1} value={value} onChange={(e) => setValue(e.target.value)}
        aria-label={`Your bid on ${athlete.name}, in credits`} placeholder="Bid" />
      <button disabled={busy || !valid || amount === bid}>{bid === null ? 'Bid' : 'Save'}</button>
      {bid !== null && (
        <button type="button" className="secondary" disabled={busy}
          onClick={() => { setBusy(true); void onRemove().finally(() => setBusy(false)); }}>
          Remove
        </button>
      )}
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

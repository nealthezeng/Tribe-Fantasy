import { useState } from 'react';
import { Link } from 'react-router';
import { fmt, record, shortRows, type OverallStanding } from '../lib/tournament';

/**
 * Ranked rows: place, team (league, owner and record under it), points; all tied at first is fine here (t239), since the card only shows rows once a game counts (t323).
 * A long list shows the top 5 (with everyone tied with 5th) and your row, if that hides at least 4 teams. `short` (the
 * League tab's table): the top 3 and your neighbours (ruling 8), never a Show all. Each run of hidden rows is one gap row.
 */
export function RankList({ rows, membershipId, showLeague, linkable, short = false }: {
  rows: OverallStanding[]; membershipId: string; showLeague: boolean;
  /** Membership ids whose names link to their team page (your own league's; other leagues' teams stay plain text). */
  linkable?: Set<string>;
  short?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const top = rows.filter((r) => r.place <= (rows[Math.min(4, rows.length - 1)]?.place ?? 0) || r.membershipId === membershipId);
  const cut = !short && !open && rows.length - top.length >= 4;
  const shown = short ? shortRows(rows, membershipId) : (cut ? top : rows).flatMap((r, i, a) => {
    const skipped = i > 0 ? rows.indexOf(r) - rows.indexOf(a[i - 1]) - 1 : 0;
    return skipped > 0 ? [{ gap: skipped }, r] : [r];
  });
  return (
    <>
      <ol className="ranks">
        {shown.map((r, i) => {
          if ('gap' in r) return <li key={`gap${i}`} className="gap">{r.gap} more {r.gap === 1 ? 'team' : 'teams'}</li>;
          const me = r.membershipId === membershipId;
          return (
            <li key={r.membershipId} aria-current={me ? 'true' : undefined}>
              <span className="rank">{r.tied ? 'T' : ''}{r.place}</span>
              <span className="who">
                <strong>
                  {linkable?.has(r.membershipId) ? <Link className="team-link" to={`/team/${r.membershipId}`}>{r.team}{me && ' (you)'}</Link> : <>{r.team}{me && ' (you)'}</>}
                </strong>
                <small>{[showLeague && r.league, r.owner, record(r)].filter(Boolean).join(' · ')}</small>
              </span>
              <span className="points">{fmt(r.points)}<span className="sr-only"> points</span></span>
            </li>
          );
        })}
      </ol>
      {cut && <button type="button" className="secondary" onClick={() => setOpen(true)}>Show all {rows.length} teams</button>}
    </>
  );
}

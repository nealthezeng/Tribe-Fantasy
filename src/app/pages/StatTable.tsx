import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { sortRows, type SortKey, type StatRow, type StatsStage } from '../lib/statsTable';
import { statLabel } from '../lib/stats';

/** Totals table, best first; tap a header to sort by it, tap again to flip. */
export function StatTable({ stats, rows, first = 'Player', href, sortable = true }: {
  stats: string[]; rows: StatRow[]; first?: string; href?: (row: StatRow) => string; sortable?: boolean;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'points', desc: true });
  if (rows.length === 0) return <p className="muted">No stats recorded.</p>;
  const shown = sortable ? sortRows(rows, sort.key, sort.desc) : rows;
  const head = (key: SortKey, text: string) => (
    <th key={key} aria-sort={sortable && sort.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      {sortable
        ? <button className="linklike" onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key !== 'label' })}>{text}</button>
        : text}
    </th>
  );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{head('label', first)}{stats.map((s) => head(s, statLabel(s)))}{head('points', 'Pts')}</tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key}>
              <td>{href ? <Link to={href(r)}>{r.label}</Link> : r.label}</td>
              {stats.map((s) => <td key={s}>{r.counts[s] ?? 0}</td>)}
              <td>{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Picks the tournament the page shows (`?t=`); nothing to pick from with one. */
export function TournamentSwitch({ stages, stage }: { stages: StatsStage[]; stage: StatsStage }) {
  const [, setParams] = useSearchParams();
  if (stages.length < 2) return null;
  return (
    <select aria-label="Tournament" value={stage.id} onChange={(e) => setParams({ t: e.target.value })}>
      {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

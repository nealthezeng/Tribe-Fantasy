import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { sortRows, type SortKey, type StatRow, type StatsStage } from '../lib/statsTable';
import { statLabel } from '../lib/stats';
import { inStatOrder, STAT_LEGEND, type StatusWord } from '../lib/words';

// Short column heads keep a five-stat table inside a phone; the full name stays the accessible one.
const SHORT: Record<string, string> = { goal: 'G', assist: 'A', block: 'D', callahan: 'C', turnover: 'T' };

/**
 * Totals table, best first; tap a header to sort by it, tap again to flip. With `href` the whole row opens it (rule 1).
 * `total` is a last row outside the sort; the legend spells out the letter heads (ruling 3).
 */
export function StatTable({ stats: keys, rows, first = 'Player', href, sortable = true, legend = true, total }: {
  stats: string[]; rows: StatRow[]; first?: string; href?: (row: StatRow) => string; sortable?: boolean;
  legend?: boolean; total?: StatRow;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'points', desc: true });
  // The sticky first column is see-through until the table scrolls under it (papercut 1).
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  if (rows.length === 0) return <p className="muted">No stats recorded.</p>;
  const shown = sortable ? sortRows(rows, sort.key, sort.desc) : rows;
  const stats = inStatOrder(keys); // G A D C T, as the legend reads, whatever order the settings keys come in
  const head = (key: SortKey, text: string, full = text) => (
    <th key={key} title={full} aria-label={full} aria-sort={sortable && sort.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      {sortable
        ? <button className="linklike" aria-label={full} onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key !== 'label' })}>{text}</button>
        : text}
    </th>
  );
  const cells = (r: StatRow) => <>{stats.map((s) => <td key={s}>{r.counts[s] ?? 0}</td>)}<td>{r.points}</td></>;
  return (
    <>
      <div className={scrolled ? 'table-wrap stat-table scrolled' : 'table-wrap stat-table'} onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}>
        <table>
          <thead>
            <tr>{head('label', first)}{stats.map((s) => head(s, SHORT[s] ?? statLabel(s), statLabel(s)))}{head('points', 'Pts')}</tr>
          </thead>
          <tbody>
            {shown.map((r) => (href ? (
              // The name cell is sticky, so its link's stretch stops at that cell: a plain tap elsewhere follows it
              // (not a new-tab click, another button, or the end of a text selection).
              <tr key={r.key} className="row-target" onClick={(e) => {
                if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || window.getSelection()?.toString() || (e.target as Element).closest('a')) return;
                navigate(href(r));
              }}>
                <td><Link to={href(r)}>{r.label}</Link></td>{cells(r)}
              </tr>
            ) : (
              <tr key={r.key}><td>{r.label}</td>{cells(r)}</tr>
            )))}
          </tbody>
          {total && <tfoot><tr><td>{total.label}</td>{cells(total)}</tr></tfoot>}
        </table>
      </div>
      {legend && <p className="hint">{STAT_LEGEND}</p>}
    </>
  );
}

/** A game's status word (rule 5): Live with the red dot, any other word plain. */
export const Status = ({ word }: { word: StatusWord }) =>
  (word === 'Live' ? <span className="live"><span className="dot" aria-hidden="true" />Live</span> : <span>{word}</span>);

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

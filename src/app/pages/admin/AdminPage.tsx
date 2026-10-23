import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { Loading } from '../../components/Loading';
import { useAuth } from '../../auth/AuthProvider';
import { loadAdminWarnings, type StuckGame } from '../../lib/adminWarnings';
import { supabase } from '../../lib/supabase';
import { rowsOf } from '../../lib/tournament';
import { useLoad } from '../../lib/useLoad';
import { AthletesPanel } from './AthletesPanel';
import { BackupPanel } from './BackupPanel';
import { HistoryPanel } from './HistoryPanel';
import { LeaguesPanel } from './LeaguesPanel';
import { SeasonsPanel, type SeasonRow } from './SeasonsPanel';
import { SettingsEditor } from './SettingsEditor';
import { StagesPanel } from './StagesPanel';
import { UsersPanel } from './UsersPanel';
import { WalletsPanel } from './WalletsPanel';

type Tab = 'stages' | 'leagues' | 'wallets' | 'users' | 'athletes' | 'settings' | 'history' | 'backup' | 'season';
/**
 * Four groups, most-used first, each with its sections (P9 ruling 17); the address is `#/admin?tab=<id>`. Each section
 * mounts fresh, so Wallets always shows balances after a grant on Tournaments.
 */
const GROUPS: [string, [Tab, string][]][] = [
  ['Tournaments', [['stages', 'Tournaments']]],
  ['Teams', [['leagues', 'Leagues'], ['wallets', 'Wallets']]],
  ['People', [['users', 'Accounts'], ['athletes', 'Players']]],
  ['More', [['settings', 'Settings'], ['history', 'History'], ['backup', 'Backup'], ['season', 'Season']]],
];
/** The admin scrolling by hand: the page stops following a loading section back to its saved spot. */
const INPUT = ['wheel', 'touchstart', 'keydown'] as const;

export function AdminPage() {
  const { isAdmin, loading } = useAuth();
  if (loading) return <Loading />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <Admin />;
}

function Admin() {
  const [params, setParams] = useSearchParams();
  const [group, tabs] = GROUPS.find(([, t]) => t.some(([id]) => id === params.get('tab'))) ?? GROUPS[0];
  const tab = tabs.find(([id]) => id === params.get('tab'))?.[0] ?? 'stages';

  const seasons = useLoad(() => rowsOf<SeasonRow>(supabase!.from('seasons').select('id, name, status').order('created_at', { ascending: false })), []);
  // The newest season, unless the admin picked another in More › Season (a deleted pick falls back to the newest).
  const [picked, setPicked] = useState<string | null>(null);
  const season = seasons.data?.find((s) => s.id === picked) ?? seasons.data?.[0] ?? null;
  const stuck = useLoad(async () => (season ? loadAdminWarnings(season.id) : []), [season?.id]);

  // Each section's scroll for this visit. A section loads after it mounts, so the page follows it as it grows back to
  // the saved spot, until it gets there or the admin scrolls first.
  const scrolls = useRef(new Map<Tab, number>());
  const keep = () => scrolls.current.set(tab, window.scrollY);
  useLayoutEffect(() => {
    const y = scrolls.current.get(tab) ?? 0;
    window.scrollTo(0, y);
    if (window.scrollY + 1 >= y || typeof ResizeObserver === 'undefined') return;
    const follow = new ResizeObserver(() => { window.scrollTo(0, y); if (window.scrollY + 1 >= y) stop(); });
    function stop() { follow.disconnect(); for (const e of INPUT) window.removeEventListener(e, stop); }
    follow.observe(document.body);
    for (const e of INPUT) window.addEventListener(e, stop, { passive: true });
    return stop;
  }, [tab]);

  const error = seasons.error ?? stuck.error;
  function section(): ReactNode {
    if (!seasons.data) return !error && <Loading />;
    if (tab === 'users') return <UsersPanel />;
    if (tab === 'history') return <HistoryPanel />;
    if (tab === 'season') return <SeasonsPanel seasons={seasons.data} selected={season?.id ?? null} onSelect={setPicked} reload={seasons.reload} />;
    if (!season) return <p className="notice">Create a season in <Link to="?tab=season">More › Season</Link>.</p>;
    const Panel = { stages: StagesPanel, leagues: LeaguesPanel, wallets: WalletsPanel, athletes: AthletesPanel, settings: SettingsEditor, backup: BackupPanel }[tab];
    // Keyed by season: switching seasons remounts the panel, so SettingsEditor never saves one season's settings onto another.
    return <Panel key={season.id} seasonId={season.id} />;
  }

  return (
    <section className="page">
      <h1>Admin{season && <> <small>{season.name}</small></>}</h1>
      <div className="subnav">
        <nav aria-label="Admin sections">
          {GROUPS.map(([name, [[first]]]) => (
            <button key={name} type="button" aria-pressed={name === group}
              onClick={() => { if (name !== group) { keep(); setParams({ tab: first }); } }}>{name}</button>
          ))}
        </nav>
        {tabs.length > 1 && (
          <nav aria-label={group}>
            {tabs.map(([id, label]) => (
              <Link key={id} to={`?tab=${id}`} aria-current={id === tab ? 'page' : undefined} onClick={keep}>{label}</Link>
            ))}
          </nav>
        )}
      </div>
      {stuck.data?.map((g) => <Stuck key={g.sessionId} g={g} />)}
      {error && <p className="error" role="alert">{error}</p>}
      {section()}
    </section>
  );
}

/** A game holding back every later result (P9 ruling 18); verifying it on its page makes it final, even unfinished. */
function Stuck({ g }: { g: StuckGame }) {
  const name = `${g.stage} game ${g.number}`;
  return (
    <div className="notice warn stack">
      <p><strong>{name} {g.live ? 'is still live.' : "isn't verified."}</strong> Later results won't count until it's verified.</p>
      <p><Link to={`/stats/${g.sessionId}`}>Open {name}</Link></p>
    </div>
  );
}

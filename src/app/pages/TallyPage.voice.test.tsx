// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../core/settings';
import { loadQueue, storeQueue, type QueuedTap } from '../tally/queue';
import { TallyPage } from './TallyPage';

// Voice on the tally board (M16 §5.4–5.8). The mic is a stub: "Hear" hands the board a call that started at AT.
const AT = '2026-11-07T15:00:00.000Z';
type MicProps = Parameters<typeof import('./VoiceMic').VoiceMic>[0];
type ControlProps = { sessionId?: string; unsaved?: Map<string, number> };

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'k1' } }, isAdmin: false, isKeeper: true, loading: false }),
}));
vi.mock('../lib/stats', async (orig) => ({
  ...(await orig<typeof import('../lib/stats')>()),
  loadCurrentSeason: () => Promise.resolve({ id: 'se', name: 'Fall', settings: parseSettings({}) }),
}));
const db = vi.hoisted(() => ({
  settings: {} as unknown, athletes: null as { id: string; name: string }[] | null, starters: [] as string[],
  owned: false, verified: false, taps: [] as unknown[], can: true,
  mic: { say: '', names: [] as string[] }, controls: null as ControlProps | null,
}));
vi.mock('./GameControls', () => ({
  GameControls: (props: ControlProps) => {
    if (props.sessionId) db.controls = props;
    return null;
  },
}));
vi.mock('./OutList', () => ({ OutList: () => <p>Out list</p> }));
vi.mock('../lib/rpc', () => ({ api: { setOut: vi.fn(), clearOut: vi.fn(), saveTaps: vi.fn(() => new Promise(() => {})) } }));
vi.mock('../tally/useRecorder', () => ({ canRecord: () => db.can }));
vi.mock('./VoiceMic', () => ({
  VoiceMic: ({ names, waiting, note, onNote, onHeard, onAdd, onDiscard }: MicProps) => {
    db.mic.names = names;
    return (
      <div>
        <button onClick={() => onHeard(db.mic.say, AT)}>Hear</button>
        {waiting !== null && <p>Bar {waiting}</p>}
        <button onClick={onAdd}>Add</button>
        <button onClick={onDiscard}>Discard</button>
        {note && <p className="stub-note">{note.text}{note.undo && <button onClick={() => { note.undo?.(); onNote(null); }}>Undo</button>}</p>}
      </div>
    );
  },
}));
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadCurrentGame: () => Promise.resolve(null),
  loadStarters: () => Promise.resolve(new Set(db.starters)),
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const session = {
        id: 'game', season_id: 'se', kind: 'tournament', held_on: '2026-11-07', counts: true, created_by: 'k1',
        verified_by: db.verified ? 'k2' : null, verified_at: db.verified ? '2000-01-01T00:00:00Z' : null,
      };
      const rows = table === 'sessions' ? [session] : table === 'games' ? [{ session_id: 'game', stage_id: 's1', number: 2 }]
        : table === 'athletes' ? db.athletes ?? [{ id: 'b', name: 'Bo Stone' }, { id: 'm', name: 'Max Ortiz' }, { id: 't', name: 'Toby Grant' }]
        : table === 'seasons' ? [{ id: 'se', settings: db.settings }] : table === 'stat_taps' ? db.taps
        : table === 'roster_slots' ? (db.owned ? [{ athlete_id: 'm' }] : [])
        : table === 'stages' ? [{ id: 's1', starts_on: '2000-01-01', ends_on: '2099-01-01' }] : [];
      const builder = {
        single: () => Promise.resolve({ data: rows[0], error: null }), maybeSingle: () => Promise.resolve({ data: rows[0], error: null }),
        select: () => builder, not: () => builder, is: () => builder, or: () => builder, order: () => builder, in: () => builder, eq: () => builder,
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  },
}));

let scrollTo: ReturnType<typeof vi.spyOn>;
beforeEach(() => { scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
afterEach(() => {
  vi.useRealTimers();
  Object.assign(db, { settings: {}, athletes: null, starters: [], owned: false, verified: false, taps: [], can: true, controls: null });
  cleanup();
  localStorage.clear();
  scrollTo.mockRestore();
});

async function board(wait = 'Bo Stone') {
  const router = createMemoryRouter(
    [{ path: '/tally', element: <TallyPage /> }, { path: '/', element: <p>Home</p> }],
    { initialEntries: ['/tally?game=game'] },
  );
  const view = render(<RouterProvider router={router} />);
  await screen.findByText(wait);
  return view.container;
}
const hear = (text: string) => {
  db.mic.say = text;
  fireEvent.click(screen.getByRole('button', { name: 'Hear' }));
};
const tile = (who: string, stat: string) =>
  screen.getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith(`${who}, ${stat}:`))!;
/** A stat button's count and its waiting mark (null: none). */
const shows = (who: string, stat: string) => {
  const b = tile(who, stat);
  return [b.querySelector('.tally-count')!.textContent, b.querySelector('.tally-new')?.textContent ?? null];
};
/** The heard line and the player names, in page order. */
const order = (c: HTMLElement) => [...c.querySelectorAll('.voice-heard, .tally-card strong')].map((e) => e.textContent);
const note = (c: HTMLElement) => c.querySelector('.stub-note')?.firstChild?.textContent ?? null;

describe('TallyBoard voice', () => {
  it('builds the Heard group from a call, first on the board, and queues nothing', async () => {
    const c = await board();
    hear('Ortiz gets a D');
    expect(order(c)).toEqual(['“Ortiz gets a D”', 'Max Ortiz', 'Bo Stone', 'Toby Grant']);
    expect(c.querySelector('.voice-heard')!.getAttribute('role')).toBe('status');
    expect(shows('Max Ortiz', 'D')).toEqual(['1', '+1']);
    expect(tile('Max Ortiz', 'D').className).toContain('waiting');
    expect(tile('Max Ortiz', 'D').getAttribute('aria-label')).toMatch(/^Max Ortiz, D: 1, 1 waiting\. Tap to add one/);
    expect(shows('Max Ortiz', 'Goal')).toEqual(['0', null]);
    expect(screen.getByText('Not added yet. Tap a stat to add one, hold to take one off.')).toBeTruthy();
    expect(screen.getByText('Bar 1')).toBeTruthy();
    expect(loadQueue('k1', 'game')).toEqual([]);
    expect(screen.getByText('Saved ✓')).toBeTruthy();
  });

  it('fixes the call on the card: tap adds a waiting stat, hold takes one off, never below zero', async () => {
    await board();
    hear('Ortiz gets a D');
    fireEvent.click(tile('Max Ortiz', 'D'));
    expect(shows('Max Ortiz', 'D')).toEqual(['2', '+2']);
    fireEvent.keyDown(tile('Max Ortiz', 'D'), { key: '-' });
    fireEvent.keyDown(tile('Max Ortiz', 'D'), { key: '-' });
    expect(shows('Max Ortiz', 'D')).toEqual(['0', null]);
    expect(tile('Max Ortiz', 'D').className).not.toContain('waiting');
    expect(screen.queryByText(/^Nothing waiting to take off\./)).toBeNull();
    fireEvent.keyDown(tile('Max Ortiz', 'D'), { key: '-' });
    expect(screen.getByText(/^Nothing waiting to take off\./)).toBeTruthy();
    expect(screen.getByText('Bar 0')).toBeTruthy();
    expect(loadQueue('k1', 'game')).toEqual([]);
  });

  it('adds every waiting stat as taps at the start of the call, then the group goes', async () => {
    const c = await board();
    hear('Ortiz gets a D');
    fireEvent.click(tile('Max Ortiz', 'D'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const q = loadQueue('k1', 'game');
    expect(q.map((t) => [t.athlete_id, t.stat, t.tapped_at, t.undoes])).toEqual([['m', 'block', AT, null], ['m', 'block', AT, null]]);
    expect(new Set(q.map((t) => t.id)).size).toBe(2);
    expect(c.querySelector('.voice-heard')).toBeNull();
    expect(order(c)).toEqual(['Bo Stone', 'Max Ortiz', 'Toby Grant']);
    expect(shows('Max Ortiz', 'D')).toEqual(['2', null]);
    expect(note(c)).toBe('Added 2 stats.');
    expect(screen.queryByText(/^Bar /)).toBeNull();
  });

  it("shows what Add will make: a waiting stat merges with another keeper's tap of the same play", async () => {
    db.taps = [{ id: 'x1', athlete_id: 'm', stat: 'block', keeper_id: 'k2', tapped_at: '2026-11-07T15:00:02.000Z', undoes: null }];
    await board();
    expect(shows('Max Ortiz', 'D')).toEqual(['1', null]);
    hear('Ortiz gets a D');
    expect(shows('Max Ortiz', 'D')).toEqual(['1', '+1']); // not 2: the same play
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(shows('Max Ortiz', 'D')).toEqual(['1', null]);
  });

  it('discards the waiting stats with an Undo that puts back the same set', async () => {
    const c = await board();
    hear('Ortiz gets a D');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(c.querySelector('.voice-heard')).toBeNull();
    expect(order(c)).toEqual(['Bo Stone', 'Max Ortiz', 'Toby Grant']);
    expect(note(c)).toBe('Dropped 1 stat.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(order(c)).toEqual(['“Ortiz gets a D”', 'Max Ortiz', 'Bo Stone', 'Toby Grant']);
    expect(shows('Max Ortiz', 'D')).toEqual(['1', '+1']);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(loadQueue('k1', 'game').map((t) => [t.athlete_id, t.stat, t.tapped_at])).toEqual([['m', 'block', AT]]);
  });

  it("takes a Discard's Undo away once a new call shows, so it can't wipe that call", async () => {
    const c = await board();
    hear('Ortiz gets a D');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    hear('Bo gets a D');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(order(c)).toEqual(['“Bo gets a D”', 'Bo Stone', 'Max Ortiz', 'Toby Grant']);
  });

  it('says what it heard when it found no player and stat, and leaves the board as it was', async () => {
    const c = await board();
    hear('nice huck');
    expect(note(c)).toBe('Heard “nice huck” but no player and stat. Try “Bo gets a D”.'); // the first A→Z
    expect(c.querySelector('.voice-heard')).toBeNull();
    expect(screen.queryByText(/^Bar /)).toBeNull();
    cleanup();
    db.starters = ['t'];
    const d = await board();
    expect(db.mic.names).toEqual(['Toby Grant', 'Bo Stone', 'Max Ortiz']); // picked first, for the hint
    hear('nice huck');
    expect(note(d)).toBe('Heard “nice huck” but no player and stat. Try “Toby gets a D”.'); // the first picked
  });

  it('waits for a quiet board before the Heard group moves in, then scrolls to the top', async () => {
    db.starters = ['t'];
    const c = await board();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const bo = screen.getByText('Bo Stone').closest('li')!; // in "Everyone else"
    fireEvent.pointerDown(bo);
    hear('Ortiz gets a D');
    expect(c.querySelector('.voice-heard')).toBeNull();
    fireEvent.pointerUp(bo);
    act(() => { vi.advanceTimersByTime(999); });
    expect(c.querySelector('.voice-heard')).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(order(c)).toEqual(['“Ortiz gets a D”', 'Max Ortiz', 'Toby Grant', 'Bo Stone']);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it('asks before leaving with stats waiting: Stay keeps them, Drop and leave goes without them', async () => {
    await board();
    hear('Ortiz gets a D');
    fireEvent.click(screen.getByRole('button', { name: '← Games' }));
    const ask = await screen.findByRole('alertdialog', { name: "Leave and drop 1 stat you haven't added: Max Ortiz D?" });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stay' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(ask.isConnected).toBe(false);
    expect(screen.getByRole('button', { name: '← Games' })).toBeTruthy();
    expect(shows('Max Ortiz', 'D')).toEqual(['1', '+1']);
    fireEvent.click(screen.getByRole('button', { name: '← Games' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Drop and leave' }));
    expect(await screen.findByText('Out list')).toBeTruthy();
    expect(loadQueue('k1', 'game')).toEqual([]);
  });

  it('names the stats top to bottom, as the Heard group shows them', async () => {
    await board();
    hear('Toby to Ortiz');
    fireEvent.keyDown(tile('Toby Grant', 'Assist'), { key: '-' }); // Toby's only stat off: he stays first, at zero
    fireEvent.click(tile('Toby Grant', 'D')); // now after Ortiz's goal in the waiting set
    fireEvent.click(screen.getByRole('button', { name: '← Games' }));
    expect(await screen.findByRole('alertdialog', { name: "Leave and drop 2 stats you haven't added: Toby Grant D, Max Ortiz Goal?" })).toBeTruthy();
  });

  it("marks a player who can't take stats, and leaves his stats out of Add and Finish", async () => {
    db.owned = true;
    await board();
    hear('Ortiz gets a D');
    const card = screen.getByText('Max Ortiz').closest('li')!;
    expect(card.querySelector('.pill.warn')!.textContent).toBe('Not added');
    expect(screen.getByText('Bar 0')).toBeTruthy();
    expect(db.controls!.unsaved!.get('game')).toBe(0);
  });

  it("keeps Finish off while stats wait: GameControls' unsaved counts them", async () => {
    storeQueue('k1', 'game', [{ id: 'q1', athlete_id: 'b', stat: 'goal', tapped_at: AT, undoes: null } as QueuedTap]);
    await board();
    expect(db.controls!.unsaved!.get('game')).toBe(1);
    hear('Ortiz gets a D and Bo gets a D');
    expect(db.controls!.unsaved!.get('game')).toBe(3);
  });

  it('says how to use the mic under the search box when voice is on', async () => {
    const c = await board();
    const hint = screen.getByText('Or hold the mic and say “Bo gets a D”. Nothing is added until you tap Add.');
    expect(c.querySelector('input[type="search"]')!.nextElementSibling).toBe(hint);
  });

  it('has no mic or hint when voice is off, the game is closed, the board is empty or the phone cannot record', async () => {
    const none = () => {
      expect(screen.queryByRole('button', { name: 'Hear' })).toBeNull();
      expect(screen.queryByText(/^Or hold the mic/)).toBeNull();
    };
    db.settings = { voice_tally: false };
    await board();
    none();
    cleanup();
    db.settings = {};
    db.verified = true;
    await board();
    none();
    cleanup();
    db.verified = false;
    db.athletes = [];
    await board('← Games');
    none();
    cleanup();
    db.athletes = null;
    db.can = false;
    await board();
    expect(screen.queryByText(/^Or hold the mic/)).toBeNull();
  });
});

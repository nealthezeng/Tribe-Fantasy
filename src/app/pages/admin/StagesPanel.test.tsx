// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLateJoiners } from '../../lib/adminWarnings';
import { formatWhen } from '../../lib/auction';
import { api } from '../../lib/rpc';
import { seasonRanks } from '../../lib/tournament';
import { StagesPanel } from './StagesPanel';

type Row = Record<string, unknown>;
type Late = { stage: { id: string; name: string }; teams: { id: string; team: string; league: string }[] };

const db = vi.hoisted(() => ({
  stages: [] as Row[], games: [] as Row[], audit_log: [] as Row[], credit_ledger: [] as Row[], late: null as Late | null,
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      // eq filters only apply to columns the fixture rows actually carry (e.g. credit_ledger.kind).
      const rows = () => ((db as unknown as Record<string, Row[]>)[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === undefined || r[c] === v));
      const builder = {
        select: () => builder,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return builder; },
        in: () => builder,
        order: () => builder,
        then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows(), error: null }),
      };
      return builder;
    },
  },
}));

vi.mock('../../lib/rpc', () => ({
  api: {
    resetGame: vi.fn(), deleteStage: vi.fn(), runAuction: vi.fn(async () => ({ by_bid: 3, empty: 69 })), openAuction: vi.fn(),
    openTournament: vi.fn(), setGameCount: vi.fn(), closeShareBuying: vi.fn(), grantStageAllowance: vi.fn(async () => 1),
    updateStage: vi.fn(), createStage: vi.fn(),
  },
}));

vi.mock('../../lib/adminWarnings', () => ({ loadLateJoiners: vi.fn(async () => db.late) }));

const pairings = [{ league_id: 'L', home: 'm1', away: 'm2' }];
const provisional = [{ league_id: 'L', order: ['m1', 'm2'], meetings: {}, season_meetings: {} }];
vi.mock('../../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../../lib/tournament')>()),
  seasonPairings: () => Promise.resolve({
    pairings, provisional, league: new Map([['L', 'League A']]), team: new Map([['m1', 'Zeal'], ['m2', 'Flow']]),
  }),
  seasonRanks: vi.fn(async () => ({ ranks: { m1: 1 }, unsettled: 0 })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  db.games = [];
  db.audit_log = [];
  db.credit_ledger = [];
  db.late = null;
});
const show = () => render(<MemoryRouter><StagesPanel seasonId="se1" /></MemoryRouter>);
const stage = (id: string, starts_on: string, bid_close_at: string, ends_on = '2027-12-31') => (
  { id, name: id, starts_on, ends_on, bid_close_at, auction_run_at: bid_close_at }
);
const game = (number: number, started_at: string | null, finished_at: string | null = null, stage_id = 'Fall') =>
  ({ id: `g${number}`, stage_id, number, session_id: null, started_at, finished_at, opponent: null });
const T = '2026-11-07T14:00:00Z';
const FUTURE = '2099-01-01T12:00:00Z';
const PAST = '2026-09-01T12:00:00Z';
/** Gold buttons: every button that isn't secondary, a red danger link or a text link (P9 rule 2: one at a time). */
const gold = () => [...document.querySelectorAll('button')].filter((b) => !b.matches('.secondary, .danger-link, .linklike')).map((b) => b.textContent);
const steps = () => document.querySelector('article .steps')?.textContent;
/** One of a tournament's rows (Games and count, Pairings, Name and dates), by its bold name. */
const row = (name: string) => screen.getByText(name, { selector: 'summary b' }).closest('details')!;
const S = (over: Row = {}) => ({ id: 'CCCs', name: 'CCCs', starts_on: '2026-10-01', ends_on: '2099-12-31', bid_close_at: null, auction_run_at: null, ...over });
const given = [{ stage_id: 'CCCs', kind: 'allowance' }];

describe('StagesPanel', () => {
  it('shows the skeleton while it loads, not an empty box', () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    show();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('puts the tournament in progress first, in a card, then later and earlier ones newest first, one row each', async () => {
    db.stages = [
      stage('Warmup', '2026-08-01', PAST, '2026-08-02'), stage('Feasterns', '2026-09-01', PAST, '2026-09-02'),
      stage('CCCs', '2026-10-01', PAST, '2099-01-02'), S({ id: 'Regionals', name: 'Regionals', starts_on: '2099-02-01' }),
    ];
    db.games = [game(1, T, T, 'Warmup'), game(4, T, null, 'Feasterns'), game(1, T, T, 'CCCs'), game(2, T, null, 'CCCs'), game(3, null, null, 'CCCs')];
    db.credit_ledger = given;
    show();
    const card = (await screen.findByRole('heading', { name: 'CCCs' })).closest('article')!;
    expect(steps()).toBe('Allowance given · Shares settled · Game 2 of 3 live');
    const rowsUnder = (heading: string) => [...screen.getByRole('heading', { name: heading }).nextElementSibling!
      .querySelectorAll(':scope > li > details > summary')] as HTMLElement[];
    expect(rowsUnder('Later').map((r) => r.querySelector('b')!.textContent)).toEqual(['Regionals']);
    const earlier = rowsUnder('Earlier');
    expect(earlier.map((r) => r.querySelector('b')!.textContent)).toEqual(['Feasterns', 'Warmup']);
    expect(within(earlier[0]).getByText('Game 4 live').className).toBe('pill warn');
    expect(within(earlier[1]).getByText('Finished')).toBeTruthy();
    expect(card.compareDocumentPosition(earlier[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gold()).toEqual([]); // none while games run, and rows never carry the gold one
  });

  it.each([
    ['no allowance yet', S(), [], [], 'Allowance · Buying · Settle · Start', 'Grant allowance'],
    ['allowance given', S(), given, [], 'Allowance given · Buying · Settle · Start', 'Open share buying'],
    ['buying open', S({ bid_close_at: FUTURE }), given, [], `Allowance given · Buying open, closes ${formatWhen(FUTURE)} · Settle · Start`, 'Close buying now'],
    ['buying closed', S({ bid_close_at: PAST }), given, [], `Allowance given · Buying closed ${formatWhen(PAST)} · Settle · Start`, 'Settle shares'],
    ['shares settled', S({ bid_close_at: PAST, auction_run_at: PAST }), given, [], 'Allowance given · Shares settled · Start', 'Open tournament'],
    ['games running', S({ bid_close_at: PAST, auction_run_at: PAST }), given, [game(1, T, T, 'CCCs'), game(2, null, null, 'CCCs')],
      'Allowance given · Shares settled · Game 2 of 2 next', null],
  ])('%s: the step line and exactly one gold button', async (_name, s, ledger, games, line, button) => {
    db.stages = [s];
    db.credit_ledger = ledger;
    db.games = games;
    show();
    await screen.findByRole('heading', { name: 'CCCs' });
    expect(steps()).toBe(line);
    expect(gold()).toEqual(button ? [button] : []);
  });

  it('turns the due step into the late joiners and gives them their credits, with the standings confirm', async () => {
    db.stages = [S({ bid_close_at: FUTURE })];
    db.credit_ledger = given;
    db.late = { stage: { id: 'CCCs', name: 'CCCs' }, teams: [{ id: 'm9', team: 'Late Larks', league: 'League A' }] };
    vi.mocked(seasonRanks).mockResolvedValueOnce({ ranks: { m1: 1 }, unsettled: 2 });
    const ask = vi.fn(() => true);
    window.confirm = ask;
    show();
    await screen.findByRole('heading', { name: 'CCCs' });
    expect(steps()).toBe(`1 team has no CCCs credits · Buying open, closes ${formatWhen(FUTURE)} · Settle · Start`);
    expect(gold()).toEqual(['Give them their credits']);
    expect(screen.getByRole('button', { name: 'Close buying now' }).className).toBe('secondary');
    db.late = { ...db.late, teams: [] };
    fireEvent.click(screen.getByRole('button', { name: 'Give them their credits' }));
    await waitFor(() => expect(api.grantStageAllowance).toHaveBeenCalledWith('CCCs', { m1: 1 }));
    expect(ask).toHaveBeenCalledWith('2 earlier games are not final yet, so the standings may still change. Grant anyway?');
    await waitFor(() => expect(steps()).toMatch(/^Allowance given · /)); // reloaded: the step line updates
    expect(vi.mocked(loadLateJoiners).mock.calls.length).toBeGreaterThan(1);
  });

  it('says how many teams have no credits', async () => {
    db.stages = [S()];
    db.credit_ledger = given;
    db.late = { stage: { id: 'CCCs', name: 'CCCs' }, teams: [{ id: 'm8', team: 'Huck Hens', league: 'L' }, { id: 'm9', team: 'Late Larks', league: 'L' }] };
    show();
    await screen.findByRole('heading', { name: 'CCCs' });
    expect(steps()).toMatch(/^2 teams have no CCCs credits · /);
    expect(gold()).toEqual(['Give them their credits']);
  });

  it('closes buying now after the ruling 19 confirm', async () => {
    db.stages = [S({ bid_close_at: FUTURE })];
    db.credit_ledger = given;
    const ask = vi.fn(() => false);
    window.confirm = ask;
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Close buying now' }));
    expect(ask).toHaveBeenCalledWith("Close buying for CCCs now? Teams can't buy or change shares after this, and it can't be reopened.");
    expect(api.closeShareBuying).not.toHaveBeenCalled();
    ask.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close buying now' }));
    await waitFor(() => expect(api.closeShareBuying).toHaveBeenCalledWith('CCCs'));
  });

  it('refuses a past close time before any confirm', async () => {
    db.stages = [S()];
    db.credit_ledger = given;
    const ask = vi.fn(() => true);
    window.confirm = ask;
    show();
    fireEvent.change(await screen.findByLabelText('Buying closes'), { target: { value: '2020-01-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open share buying' }));
    await screen.findByText('Pick a closing time in the future.');
    expect(ask).not.toHaveBeenCalled();
    expect(api.openAuction).not.toHaveBeenCalled();
  });

  it('opens share buying with a "Buying closes" field', async () => {
    db.stages = [{ id: 'Fall', name: 'Fall', starts_on: '2026-09-01', ends_on: '2099-09-10', bid_close_at: null, auction_run_at: null }];
    window.confirm = () => true;
    show();
    fireEvent.change(await screen.findByLabelText('Buying closes'), { target: { value: '2099-01-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open share buying' }));
    await waitFor(() => expect(api.openAuction).toHaveBeenCalledWith('Fall', new Date('2099-01-01T10:00').toISOString()));
    expect(document.body.textContent).not.toMatch(/\bbid|auction/i);
  });

  it('settles shares with the new confirm and says every team has its players', async () => {
    db.stages = [{ id: 'Fall', name: 'Fall', starts_on: '2026-09-01', ends_on: '2099-09-10', bid_close_at: '2026-09-01T00:00:00Z', auction_run_at: null }];
    const ask = vi.fn(() => true);
    window.confirm = ask;
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Settle shares' }));
    expect(ask).toHaveBeenCalledWith("Settle Fall shares? Every team gets its players now. This runs once; you can still fix a team's shares by hand.");
    await screen.findByText('Fall shares settled: every team has its players (3 buys).');
    expect(api.runAuction).toHaveBeenCalledWith('Fall');
    expect(document.body.textContent).not.toMatch(/\bbid|auction|random fill|empty/i);
  });

  it('offers Open tournament only on the current stage', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z', '2026-09-10'), stage('Spring', '2027-02-01', '2027-02-10T00:00:00Z')];
    show();
    const buttons = await screen.findAllByRole('button', { name: 'Open tournament', hidden: true });
    expect(buttons).toHaveLength(1);
    expect(within(buttons[0].closest('article')!).getByRole('heading', { name: 'Spring' })).toBeTruthy();
  });

  it('opens a tournament with a required Games count, its button gold from the start (never grey until blur)', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    window.confirm = () => true;
    show();
    const open = await screen.findByRole('button', { name: 'Open tournament' }) as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    expect(gold()).toEqual(['Open tournament']);
    const input = screen.getByLabelText('Games') as HTMLInputElement;
    expect(input.required).toBe(true);
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(open);
    await waitFor(() => expect(api.openTournament).toHaveBeenCalledWith('Fall', pairings, 4));
  });

  it("opens each row to today's forms: Games and count, Pairings, Name and dates", async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    db.games = [game(1, T, T), game(2, null)];
    show();
    await screen.findByRole('heading', { name: 'Fall' });
    const games = row('Games and count');
    expect(within(games).getByText('2 games · 2 opponents not set')).toBeTruthy();
    expect(within(games).getByLabelText('Games', { selector: 'input' })).toBeTruthy();
    const tally = within(games).getByRole('link', { name: 'Opponents are set on Tally', hidden: true });
    expect(tally.getAttribute('href')).toBe('/tally');
    expect(tally.className).toBe('more');
    expect(within(row('Pairings')).getByRole('button', { name: 'Check pairings', hidden: true })).toBeTruthy();
    const name = row('Name and dates');
    fireEvent.change(within(name).getByLabelText('Name'), { target: { value: 'Fall open' } });
    fireEvent.click(within(name).getByRole('button', { name: 'Save tournament', hidden: true }));
    await waitFor(() => expect(api.updateStage).toHaveBeenCalledWith('Fall', 'Fall open', '2026-09-01', '2027-12-31'));
  });

  it('puts Undo game and Delete tournament last in their rows, in red words', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    db.games = [game(1, T, T), game(2, T), game(3, null)];
    show();
    await screen.findByRole('heading', { name: 'Fall' });
    for (const [r, name] of [['Games and count', 'Undo game 2'], ['Name and dates', 'Delete tournament']]) {
      const button = within(row(r)).getByRole('button', { name, hidden: true });
      expect(button.className).toBe('danger-link');
      expect([...row(r).querySelectorAll('button, a, input')].at(-1)).toBe(button);
    }
  });

  it('undoes the newest started game, not the unstarted one its finish created (t121)', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    db.games = [game(1, '2026-11-07T14:00:00Z'), game(2, '2026-11-07T16:00:00Z'), game(3, null)];
    window.confirm = () => true;
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo game 2', hidden: true }));
    await waitFor(() => expect(api.resetGame).toHaveBeenCalledWith('g2'));
  });

  it('offers no Undo on a past tournament', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z', '2026-09-10'), stage('Spring', '2027-02-01', '2027-02-10T00:00:00Z')];
    db.games = [{ id: 'g1', stage_id: 'Fall', number: 1, session_id: null, started_at: '2026-11-07T14:00:00Z', finished_at: null, opponent: null }];
    show();
    await screen.findByText('Game 1 live');
    expect(screen.queryByRole('button', { name: 'Undo game 1', hidden: true })).toBeNull();
  });

  it('checks each game once even when undo + replay finished it twice', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    db.games = [game(1, '2026-11-07T14:00:00Z'), game(2, null)];
    const finishRow = { entity_id: 'g1', details: { pairings: [], provisional: [] } };
    db.audit_log = [finishRow, finishRow];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Check pairings', hidden: true }));
    await screen.findByText(/Game 2: matches/, undefined, { timeout: 2000 });
    expect(screen.getAllByText(/Game 2:/)).toHaveLength(1);
  });

  it('deletes a tournament from its Name and dates row after the confirm, word for word (t121)', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    const ask = vi.fn(() => true);
    window.confirm = ask;
    show();
    await screen.findByRole('heading', { name: 'Fall' });
    expect(screen.queryByLabelText('Event')).toBeNull(); // t124: Name names the tournament
    fireEvent.click(within(row('Name and dates')).getByRole('button', { name: 'Delete tournament', hidden: true }));
    expect(ask).toHaveBeenCalledWith('Delete Fall? Its games and their stats, rosters and shares are deleted for good. '
      + 'Credits spent on its shares go back to the teams; allowances stay, so granting an allowance again to a '
      + 're-created tournament would credit everyone twice. Take a backup first if you might want it back.');
    await waitFor(() => expect(api.deleteStage).toHaveBeenCalledWith('Fall'));
    await screen.findByText('Fall deleted.');
  });

  it('words the step by the current game and saves a lower count without a confirm', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    db.games = [game(1, T, T), game(2, null), game(3, null), game(4, null)];
    window.confirm = () => { throw new Error('no confirm expected'); };
    show();
    await screen.findByText('Game 2 of 4 next');
    const input = screen.getByLabelText('Games', { selector: 'input' }) as HTMLInputElement;
    expect(input.min).toBe('1');
    expect(input.value).toBe('4');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save count', hidden: true }));
    await waitFor(() => expect(api.setGameCount).toHaveBeenCalledWith('Fall', 2));
    await screen.findByText('Fall: 2 games.');
  });

  it('never lets the count drop below the highest started game', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    db.games = [game(1, T, T), game(2, T), game(3, null)];
    show();
    await screen.findByText('Game 2 of 3 live');
    expect((screen.getByLabelText('Games', { selector: 'input' }) as HTMLInputElement).min).toBe('2');
  });

  it('shows the new game pairings before raising a finished tournament, and sends them', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    db.games = [game(1, T, T), game(2, T, T)];
    const ask = vi.fn(() => true);
    window.confirm = ask;
    show();
    await screen.findByText('Finished');
    fireEvent.change(screen.getByLabelText('Games', { selector: 'input' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save count', hidden: true }));
    await waitFor(() => expect(api.setGameCount).toHaveBeenCalledWith('Fall', 3, pairings, provisional));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('Zeal'));
  });

  it('does not flag the last game finish (pairings null) in Check pairings', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    db.games = [game(1, T, T), game(2, T, T)];
    db.audit_log = [
      { entity_id: 'g1', details: { pairings: [], provisional: [] } },
      { entity_id: 'g2', details: { pairings: null, provisional: null } },
    ];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Check pairings', hidden: true }));
    await screen.findByText(/Game 2: matches/);
    expect(document.body.textContent).not.toMatch(/doesn't match/);
    expect(screen.queryByText(/Game 3:/)).toBeNull();
  });

  it('lets the count be cleared and retyped, and offers it only on the current tournament', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z', '2026-09-10'), stage('Spring', '2027-02-01', '2027-02-10T00:00:00Z')];
    db.games = [{ ...game(1, T, T), stage_id: 'Fall' }, { ...game(2, null), stage_id: 'Spring' }, { ...game(3, null), stage_id: 'Spring' }];
    show();
    const inputs = await screen.findAllByLabelText('Games', { selector: 'input' });
    expect(inputs).toHaveLength(1); // Fall is past: no count form
    const input = inputs[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    expect(input.required).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, describeAudit, humaniseAction, type AuditRow } from './audit';

const names = new Map([['a1', 'Sam Grossberg'], ['m1', 'Gimp Zeal'], ['u1', 'Alex Kim']]);
const row = (action: string, details: Record<string, unknown>): AuditRow =>
  ({ id: 1, at: '2026-10-19T12:00:00Z', actor: 'u9', action, entity: 'membership', entity_id: 'm1', details });
const share = (old_percent: number | null, new_percent: number | null) =>
  row('admin_set_share', { stage: 's1', membership: 'm1', athlete: 'a1', old_percent, new_percent, from_game: 2 });

describe('describeAudit', () => {
  it('says gave, changed and took for a share edit', () => {
    expect(describeAudit(share(0, 25), names)).toBe('Gave Sam Grossberg 25% to Gimp Zeal');
    expect(describeAudit(share(25, 40), names)).toBe('Changed Sam Grossberg from 25% to 40% for Gimp Zeal');
    expect(describeAudit(share(25, null), names)).toBe('Took Sam Grossberg from Gimp Zeal');
    expect(describeAudit(share(25, 0), names)).toBe('Took Sam Grossberg from Gimp Zeal');
  });
  it('names a removed account and a team rename', () => {
    expect(describeAudit(row('admin_remove_user', { user: 'u1', email: 'a@x.test', display_name: 'Alex Kim', teams: ['Gimp Zeal'], donations: 2 }), names))
      .toBe('Removed account Alex Kim');
    expect(describeAudit(row('admin_remove_user', { user: 'u1', email: 'a@x.test', display_name: null, teams: [], donations: 0 }), names))
      .toBe('Removed account a@x.test');
    expect(describeAudit(row('admin_rename_team', { old: 'Old', new: 'New' }), names)).toBe('Renamed team Old → New');
    expect(describeAudit(row('rename_my_team', { old: 'Zeal', new: 'Flow' }), names)).toBe('Renamed team Zeal → Flow');
    expect(describeAudit(row('admin_set_display_name', { user: 'u1', old: 'Al', new: 'Alex Kim' }), names)).toBe('Renamed Al → Alex Kim');
  });
  it('describes marking a player Out and clearing it', () => {
    expect(describeAudit(row('set_out', { athlete: 'a1', from_game: 2 }), names)).toBe('Marked Sam Grossberg out from game 2');
    expect(describeAudit(row('clear_out', { athlete: 'a1', from_game: 2, until_game: null }), names)).toBe("Cleared Sam Grossberg's Out");
  });
  it('humanises any other action', () => {
    expect(describeAudit(row('delete_stage', {}), names)).toBe('Delete stage');
  });
  it('uses share-buying words for bid and auction actions', () => {
    const l = (a: string) => describeAudit(row(a, {}), names);
    expect([l('open_auction'), l('run_auction'), l('place_bid'), l('delete_bid')])
      .toEqual(['Open share buying', 'Settle shares', 'Buy shares', 'Delete share buy']);
    for (const a of AUDIT_ACTIONS) expect(humaniseAction(a)).not.toMatch(/bid|auction/i);
    expect(AUDIT_ACTIONS).toEqual(expect.arrayContaining(['set_out', 'clear_out']));
  });
});


describe('describeAudit game and tournament names', () => {
  const game = 'Game 2 vs UNC (CCCs)';
  const named = new Map([...names, ['g1', game], ['se1', game], ['st1', 'CCCs']]);
  const at = (action: string, entity: string, entity_id: string) => describeAudit({ ...row(action, {}), entity, entity_id }, named);

  it('names the game of a tally, verify, start, finish, undo, reopen and opponent row', () => {
    expect(at('save_taps', 'session', 'se1')).toBe('Tallied Game 2 vs UNC (CCCs)');
    expect(at('verify_session', 'session', 'se1')).toBe('Verified Game 2 vs UNC (CCCs)');
    expect(at('reopen_session', 'session', 'se1')).toBe('Reopened Game 2 vs UNC (CCCs)');
    expect(at('start_game', 'game', 'g1')).toBe('Started Game 2 vs UNC (CCCs)');
    expect(at('finish_game', 'game', 'g1')).toBe('Finished Game 2 vs UNC (CCCs)');
    expect(at('reset_game', 'game', 'g1')).toBe('Undid Game 2 vs UNC (CCCs)');
    expect(at('set_game_opponent', 'game', 'g1')).toBe('Named the opponent of Game 2 vs UNC (CCCs)');
  });
  it('names the tournament whose share buying closed, and lists it in the filter', () => {
    expect(at('close_share_buying', 'stage', 'st1')).toBe('Closed share buying for CCCs');
    expect(AUDIT_ACTIONS).toContain('close_share_buying');
  });
  it("keeps today's words when the game or tournament is gone, never undefined", () => {
    expect(at('save_taps', 'session', 'gone')).toBe('Save taps');
    expect(at('reset_game', 'game', 'gone')).toBe('Reset game');
    expect(at('close_share_buying', 'stage', 'gone')).toBe('Close share buying');
    for (const a of ['verify_session', 'reopen_session', 'start_game', 'finish_game', 'set_game_opponent']) {
      expect(at(a, 'game', 'gone')).toBe(humaniseAction(a));
    }
  });
});

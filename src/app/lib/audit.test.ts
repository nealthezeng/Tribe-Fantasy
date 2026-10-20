import { describe, expect, it } from 'vitest';
import { describeAudit, type AuditRow } from './audit';

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
    expect(describeAudit(row('admin_set_display_name', { user: 'u1', old: 'Al', new: 'Alex Kim' }), names)).toBe('Renamed Al → Alex Kim');
  });
  it('humanises any other action', () => {
    expect(describeAudit(row('delete_stage', {}), names)).toBe('Delete stage');
  });
});

export interface AuditRow {
  id: number; at: string; actor: string | null; action: string; entity: string; entity_id: string;
  details: Record<string, unknown>;
}

/** The admin actions worth filtering by (filter options; any other action still shows, humanised). */
export const AUDIT_ACTIONS = [
  'admin_set_share', 'admin_rename_team', 'rename_my_team', 'admin_set_display_name', 'admin_remove_user', 'grant_role', 'revoke_role',
  'adjust_credits', 'record_donation', 'open_auction', 'run_auction', 'open_tournament', 'set_game_count', 'reset_game', 'delete_stage',
  'delete_league', 'delete_athlete', 'delete_season', 'set_out', 'clear_out', 'close_share_buying',
];

/** Names for actions whose code name says "bid" or "auction", and the M14 ones, so the filter matches the rows. */
const LABELS: Record<string, string> = {
  open_auction: 'Open share buying', run_auction: 'Settle shares', place_bid: 'Buy shares', delete_bid: 'Delete share buy',
  admin_set_share: 'Change shares', admin_remove_user: 'Remove account', admin_rename_team: 'Rename team',
  admin_set_display_name: 'Rename person', rename_my_team: 'Rename own team',
  set_out: 'Mark out', clear_out: 'Clear out',
};

/** "delete_stage" → "Delete stage"; the admin_ prefix is noise in a list only admins read. */
export function humaniseAction(action: string): string {
  if (LABELS[action]) return LABELS[action];
  const s = action.replace(/^admin_/, '').replace(/_/g, ' ');
  return s[0].toUpperCase() + s.slice(1);
}

/** Rows about one game (entity_id = its game or session id) or one tournament (its stage id): verb + its name. */
const NAMED: Record<string, string> = {
  save_taps: 'Tallied', verify_session: 'Verified', start_game: 'Started', finish_game: 'Finished', reset_game: 'Undid',
  reopen_session: 'Reopened', set_game_opponent: 'Named the opponent of', close_share_buying: 'Closed share buying for',
};

/** One plain-words line for an audit row. `names` maps athlete, membership, profile and stage ids to names, and game
 *  and session ids to "Game 2 vs UNC (CCCs)". */
export function describeAudit(r: AuditRow, names: Map<string, string>): string {
  const d = r.details;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null);
  const name = (k: string, fallback: string) => names.get(str(k) ?? '') ?? fallback;
  switch (r.action) {
    case 'admin_set_share': {
      const [athlete, team] = [name('athlete', 'a player'), name('membership', 'a team')];
      const from = Number(d.old_percent) || 0;
      const to = Number(d.new_percent) || 0;
      if (to === 0) return `Took ${athlete} from ${team}`;
      return from === 0 ? `Gave ${athlete} ${to}% to ${team}` : `Changed ${athlete} from ${from}% to ${to}% for ${team}`;
    }
    case 'admin_remove_user': return `Removed account ${str('display_name') ?? str('email') ?? 'an account'}`;
    case 'admin_rename_team':
    case 'rename_my_team': return `Renamed team ${str('old')} → ${str('new')}`;
    case 'admin_set_display_name': return `Renamed ${str('old')} → ${str('new')}`;
    case 'set_out': return `Marked ${name('athlete', 'a player')} out from game ${Number(d.from_game) || 1}`;
    case 'clear_out': return `Cleared ${name('athlete', 'a player')}'s Out`;
    case 'set_game_count': return `Games: ${Number(d.from) || 0} → ${Number(d.to) || 0}`;
    default: {
      const what = NAMED[r.action] && names.get(r.entity_id);
      return what ? `${NAMED[r.action]} ${what}` : humaniseAction(r.action); // a game or tournament since deleted
    }
  }
}

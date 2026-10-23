import type { QueuedTap } from '../tally/queue';
import { supabase } from './supabase';
import type { GamePairing, LeaguePairingInput } from './tournament';

/** list_venmo_receipts(): receipts that didn't become credits (last 30 days) + skipped personal payments. */
export interface VenmoReceipt {
  id: number;
  received_at: string;
  status: 'unknown_code' | 'ambiguous' | 'unsigned' | 'unparsed' | 'disabled' | 'duplicate';
  payer: string | null;
  dollars: number | null;
  note: string | null;
  code: string | null;
  team: string | null;
}
export interface VenmoReceiptList { receipts: VenmoReceipt[]; skipped: number }

/** A row of list_leagues(): the current season's leagues, as anyone signed in sees them (t215). */
export interface LeagueListing {
  id: string;
  name: string;
  teams: number;
  max_teams: number;
  has_password: boolean;
  is_member: boolean;
  is_creator: boolean;
  /** First names of the league's live teams, oldest team first (0029). */
  members: string[];
}

export type Role = 'admin' | 'stat_keeper' | 'treasurer';

/** A row of list_users() (admin only). display_name is null for an account with no profile. */
export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  roles: Role[];
  teams: { membership_id: string; league: string; team: string; season: string }[];
  athlete: { id: string; name: string } | null;
  donations: { count: number; dollars: number };
}

/** A row of live_game_taps(): one tap of a started, unverified game; keepers are numbered 1, 2, ... (never ids). */
export interface LiveTapRow { id: string; athlete_id: string; stat: string; tapped_at: string; undoes: string | null; keeper: number }

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('NOT_CONFIGURED');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const api = {
  setDisplayName: (name: string) => call<void>('set_display_name', { p_name: name }),
  setNotifyEmail: (on: boolean) => call<void>('set_notify_email', { p_on: on }),
  setDonateAnonymously: (on: boolean) => call<void>('set_donate_anonymously', { p_on: on }),
  /** Whether you can read league data such as stats: in a league, or staff. False for an athlete-only account. */
  canReadLeagueData: () => call<boolean>('can_read_league_data', {}),
  /** Your own Donors-list choice; only you can read it. */
  myDonateAnonymously: () => call<boolean>('my_donate_anonymously', {}),
  /** Every donor this season, biggest total first; `name` null = anonymous. */
  donationLeaderboard: (seasonId: string) =>
    call<{ name: string | null; dollars: number; is_me: boolean }[]>('donation_leaderboard', { p_season: seasonId }),
  /** The taps of one started, unverified game (any league reader); no rows once it is verified. */
  liveGameTaps: (gameId: string) => call<LiveTapRow[]>('live_game_taps', { p_game: gameId }),
  listLeagues: () => call<LeagueListing[]>('list_leagues', {}),
  /** `password` null = a public league. */
  createMyLeague: (name: string, password: string | null, teamName: string) =>
    call<string>('create_my_league', { p_name: name, p_password: password, p_team_name: teamName }),
  joinOpenLeague: (leagueId: string, password: string | null, teamName: string) =>
    call<string>('join_open_league', { p_league: leagueId, p_password: password, p_team_name: teamName }),
  renameLeague: (leagueId: string, name: string) => call<void>('rename_league', { p_league: leagueId, p_name: name }),
  /** `password` null = make the league public. */
  setLeaguePassword: (leagueId: string, password: string | null) =>
    call<void>('set_league_password', { p_league: leagueId, p_password: password }),
  deleteLeague: (leagueId: string) => call<void>('delete_league', { p_league: leagueId }),
  /** Admin: give a team `percent` (1–100) of a player for free, change it, or take it away (null). Never touches credits. */
  adminSetShare: (stage: string, membership: string, athlete: string, percent: number | null) =>
    call<void>('admin_set_share', { p_stage: stage, p_membership: membership, p_athlete: athlete, p_percent: percent }),
  adminRenameTeam: (membership: string, name: string) => call<void>('admin_rename_team', { p_membership: membership, p_name: name }),
  /** Your own, not-removed team only (t311). */
  renameMyTeam: (membershipId: string, name: string) => call<void>('rename_my_team', { p_membership: membershipId, p_name: name }),
  /** Your own team only; refused once it has donated, bid, or played (t217). */
  leaveLeague: (membershipId: string) => call<void>('leave_league', { p_membership: membershipId }),
  createSeason: (name: string, settings: object) => call<string>('create_season', { p_name: name, p_settings: settings }),
  updateSeasonSettings: (seasonId: string, settings: object) =>
    call<void>('update_season_settings', { p_season: seasonId, p_settings: settings }),
  addAthlete: (seasonId: string, name: string) => call<string>('add_athlete', { p_season: seasonId, p_name: name, p_user: null }),
  setAthleteOptIn: (athleteId: string, optedIn: boolean) =>
    call<void>('set_athlete_opt_in', { p_athlete: athleteId, p_opted_in: optedIn }),
  renameAthlete: (athleteId: string, name: string) => call<void>('rename_athlete', { p_athlete: athleteId, p_name: name }),
  deleteAthlete: (athleteId: string, force = false) => call<void>('delete_athlete', { p_athlete: athleteId, p_force: force }),
  grantRole: (userId: string, role: Role) => call<void>('grant_role', { p_user: userId, p_role: role }),
  revokeRole: (userId: string, role: Role) => call<void>('revoke_role', { p_user: userId, p_role: role }),
  /** Admin: every account with email, roles, teams, linked player and donation totals. */
  listUsers: () => call<UserRow[]>('list_users', {}),
  adminSetDisplayName: (userId: string, name: string) => call<void>('admin_set_display_name', { p_user: userId, p_name: name }),
  /** Admin: the account can't sign in; its teams stay marked removed. Can't be undone. */
  adminRemoveUser: (userId: string) => call<{ teams: number; donations: number }>('admin_remove_user', { p_user: userId }),
  linkAthleteUser: (athleteId: string, userId: string | null) =>
    call<void>('link_athlete_user', { p_athlete: athleteId, p_user: userId }),
  saveTaps: (sessionId: string, clientNow: string, taps: QueuedTap[]) =>
    call<number>('save_taps', { p_session: sessionId, p_client_now: clientNow, p_taps: taps }),
  verifySession: (sessionId: string, lines: { athlete_id: string; stats: Record<string, number> }[]) =>
    call<void>('verify_session', { p_session: sessionId, p_lines: lines }),
  reopenSession: (sessionId: string) => call<void>('reopen_session', { p_session: sessionId }),
  deleteSession: (sessionId: string, force = false) => call<void>('delete_session', { p_session: sessionId, p_force: force }),
  correctStatLine: (sessionId: string, athleteId: string, stats: Record<string, number>) =>
    call<void>('correct_stat_line', { p_session: sessionId, p_athlete: athleteId, p_stats: stats }),
  setOut: (stageId: string, athleteId: string) => call<number>('set_out', { p_stage: stageId, p_athlete: athleteId }),
  clearOut: (stageId: string, athleteId: string) => call<void>('clear_out', { p_stage: stageId, p_athlete: athleteId }),
  createStage: (seasonId: string, name: string, startsOn: string, endsOn: string) =>
    call<string>('create_stage', {
      p_season: seasonId, p_name: name, p_starts_on: startsOn, p_ends_on: endsOn, p_tournament: null,
    }),
  updateStage: (stageId: string, name: string, startsOn: string, endsOn: string) =>
    call<void>('update_stage', {
      p_stage: stageId, p_name: name, p_starts_on: startsOn, p_ends_on: endsOn, p_tournament: null,
    }),
  grantStageAllowance: (stageId: string, ranks: Record<string, number>) =>
    call<number>('grant_stage_allowance', { p_stage: stageId, p_ranks: ranks }),
  listVenmoReceipts: () => call<VenmoReceiptList>('list_venmo_receipts', {}),
  recordDonation: (membershipId: string, dollars: number, note: string) =>
    call<number>('record_donation', { p_membership: membershipId, p_dollars: dollars, p_note: note }),
  adjustCredits: (membershipId: string, amount: number, note: string) =>
    call<number>('adjust_credits', { p_membership: membershipId, p_amount: amount, p_note: note }),
  openAuction: (stageId: string, closeAt: string) => call<void>('open_auction', { p_stage: stageId, p_close_at: closeAt }),
  closeShareBuying: (stageId: string) => call<void>('close_share_buying', { p_stage: stageId }),
  placeBid: (stageId: string, membershipId: string, athleteId: string, amount: number) =>
    call<void>('place_bid', { p_stage: stageId, p_membership: membershipId, p_athlete: athleteId, p_amount: amount }),
  deleteBid: (stageId: string, membershipId: string, athleteId: string) =>
    call<void>('delete_bid', { p_stage: stageId, p_membership: membershipId, p_athlete: athleteId }),
  runAuction: (stageId: string) =>
    call<{ by_bid: number; empty: number }>('run_auction', { p_stage: stageId }),
  openTournament: (stageId: string, pairings: GamePairing[], games: number) =>
    call<string>('open_tournament', { p_stage: stageId, p_pairings: pairings, p_games: games }),
  startGame: (gameId: string) => call<string>('start_game', { p_game: gameId }),
  /** Pairs game N+1 (which already exists); on the last game send [] and []: nothing is paired and it returns null. */
  finishGame: (gameId: string, pairings: GamePairing[], provisional: LeaguePairingInput[]) =>
    call<string | null>('finish_game', { p_game: gameId, p_pairings: pairings, p_provisional: provisional }),
  /** Admin: change the tournament's game count. Pairings (and inputs) are needed only to raise a finished tournament. */
  setGameCount: (stageId: string, count: number, pairings?: GamePairing[], provisional?: LeaguePairingInput[]) =>
    call<void>('set_game_count', { p_stage: stageId, p_count: count, p_pairings: pairings ?? null, p_provisional: provisional ?? null }),
  setGameOpponent: (gameId: string, name: string) => call<void>('set_game_opponent', { p_game: gameId, p_name: name }),
  resetGame: (gameId: string) => call<void>('reset_game', { p_game: gameId }),
  deleteStage: (stageId: string) => call<void>('delete_stage', { p_stage: stageId }),
  renameSeason: (seasonId: string, name: string) => call<void>('rename_season', { p_season: seasonId, p_name: name }),
  deleteSeason: (seasonId: string) => call<void>('delete_season', { p_season: seasonId }),
  /** Replaces the team's whole pick set for game `number` (0 to picks_per_game players); PostgREST takes the JSON array as uuid[]. */
  setGamePick: (membershipId: string, stageId: string, number: number, athleteIds: string[]) =>
    call<void>('set_game_pick', { p_membership: membershipId, p_stage: stageId, p_number: number, p_athletes: athleteIds }),
};

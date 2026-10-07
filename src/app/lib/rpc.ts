import type { QueuedTap } from '../tally/queue';
import { supabase } from './supabase';
import type { GamePairing, LeaguePairingInput } from './tournament';

/** A row of list_leagues(): the current season's leagues, as anyone signed in sees them (t215). */
export interface LeagueListing {
  id: string;
  name: string;
  teams: number;
  max_teams: number;
  has_password: boolean;
  is_member: boolean;
  is_creator: boolean;
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('NOT_CONFIGURED');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const api = {
  setDisplayName: (name: string) => call<void>('set_display_name', { p_name: name }),
  setNotifyEmail: (on: boolean) => call<void>('set_notify_email', { p_on: on }),
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
  grantRole: (userId: string, role: 'stat_keeper') => call<void>('grant_role', { p_user: userId, p_role: role }),
  revokeRole: (userId: string, role: 'stat_keeper') => call<void>('revoke_role', { p_user: userId, p_role: role }),
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
  setAttendance: (sessionId: string, athleteId: string, status: 'present' | 'absent') =>
    call<void>('set_attendance', { p_session: sessionId, p_athlete: athleteId, p_status: status }),
  reportInjury: (athleteId: string) => call<string>('report_injury', { p_athlete: athleteId }),
  confirmInjury: (injuryId: string) => call<void>('confirm_injury', { p_injury: injuryId }),
  clearInjury: (athleteId: string) => call<void>('clear_injury', { p_athlete: athleteId }),
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
  recordDonation: (membershipId: string, dollars: number, note: string) =>
    call<number>('record_donation', { p_membership: membershipId, p_dollars: dollars, p_note: note }),
  adjustCredits: (membershipId: string, amount: number, note: string) =>
    call<number>('adjust_credits', { p_membership: membershipId, p_amount: amount, p_note: note }),
  openAuction: (stageId: string, closeAt: string) => call<void>('open_auction', { p_stage: stageId, p_close_at: closeAt }),
  placeBid: (stageId: string, membershipId: string, athleteId: string, amount: number) =>
    call<void>('place_bid', { p_stage: stageId, p_membership: membershipId, p_athlete: athleteId, p_amount: amount }),
  deleteBid: (stageId: string, membershipId: string, athleteId: string) =>
    call<void>('delete_bid', { p_stage: stageId, p_membership: membershipId, p_athlete: athleteId }),
  runAuction: (stageId: string) =>
    call<{ by_bid: number; by_fill: number; empty: number }>('run_auction', { p_stage: stageId }),
  openTournament: (stageId: string, pairings: GamePairing[]) =>
    call<string>('open_tournament', { p_stage: stageId, p_pairings: pairings }),
  startGame: (gameId: string) => call<string>('start_game', { p_game: gameId }),
  finishGame: (gameId: string, pairings: GamePairing[], provisional: LeaguePairingInput[]) =>
    call<string>('finish_game', { p_game: gameId, p_pairings: pairings, p_provisional: provisional }),
  /** The tournament's last game (t202): finished, with no game N+1 paired. */
  finishLastGame: (gameId: string) =>
    call<null>('finish_game', { p_game: gameId, p_pairings: [], p_provisional: [], p_last: true }),
  /** Pairs game N+1 after all, after a last-game finish. */
  addNextGame: (gameId: string, pairings: GamePairing[], provisional: LeaguePairingInput[]) =>
    call<string>('add_next_game', { p_game: gameId, p_pairings: pairings, p_provisional: provisional }),
  setGameOpponent: (gameId: string, name: string) => call<void>('set_game_opponent', { p_game: gameId, p_name: name }),
  resetGame: (gameId: string) => call<void>('reset_game', { p_game: gameId }),
  deleteStage: (stageId: string) => call<void>('delete_stage', { p_stage: stageId }),
  renameSeason: (seasonId: string, name: string) => call<void>('rename_season', { p_season: seasonId, p_name: name }),
  deleteSeason: (seasonId: string) => call<void>('delete_season', { p_season: seasonId }),
  setGamePick: (membershipId: string, stageId: string, number: number, athleteId: string | null) =>
    call<void>('set_game_pick', { p_membership: membershipId, p_stage: stageId, p_number: number, p_athlete: athleteId }),
  setBench: (membershipId: string, stageId: string, athleteIds: string[]) =>
    call<void>('set_bench', { p_membership: membershipId, p_stage: stageId, p_athletes: athleteIds }),
  swapBench: (membershipId: string, stageId: string, outAthlete: string, inAthlete: string) =>
    call<void>('swap_bench', { p_membership: membershipId, p_stage: stageId, p_out: outAthlete, p_in: inAthlete }),
};

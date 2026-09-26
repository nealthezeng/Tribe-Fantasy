import type { QueuedTap } from '../tally/queue';
import { supabase } from './supabase';

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('NOT_CONFIGURED');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const api = {
  setDisplayName: (name: string) => call<void>('set_display_name', { p_name: name }),
  joinLeague: (code: string, teamName: string) => call<string>('join_league', { p_code: code, p_team_name: teamName }),
  createSeason: (name: string, settings: object) => call<string>('create_season', { p_name: name, p_settings: settings }),
  updateSeasonSettings: (seasonId: string, settings: object) =>
    call<void>('update_season_settings', { p_season: seasonId, p_settings: settings }),
  createLeague: (seasonId: string, name: string) => call<string>('create_league', { p_season: seasonId, p_name: name }),
  createInvite: (leagueId: string, code: string, maxUses: number, expiresAt: string | null) =>
    call<string>('create_invite', { p_league: leagueId, p_code: code, p_max_uses: maxUses, p_expires_at: expiresAt }),
  addAthlete: (seasonId: string, name: string) => call<string>('add_athlete', { p_season: seasonId, p_name: name, p_user: null }),
  setAthleteOptIn: (athleteId: string, optedIn: boolean) =>
    call<void>('set_athlete_opt_in', { p_athlete: athleteId, p_opted_in: optedIn }),
  grantRole: (userId: string, role: 'stat_keeper') => call<void>('grant_role', { p_user: userId, p_role: role }),
  revokeRole: (userId: string, role: 'stat_keeper') => call<void>('revoke_role', { p_user: userId, p_role: role }),
  linkAthleteUser: (athleteId: string, userId: string | null) =>
    call<void>('link_athlete_user', { p_athlete: athleteId, p_user: userId }),
  createSession: (seasonId: string, kind: 'practice' | 'tournament', heldOn: string, counts: boolean) =>
    call<string>('create_session', { p_season: seasonId, p_kind: kind, p_held_on: heldOn, p_counts: counts }),
  saveTaps: (sessionId: string, clientNow: string, taps: QueuedTap[]) =>
    call<number>('save_taps', { p_session: sessionId, p_client_now: clientNow, p_taps: taps }),
  verifySession: (sessionId: string, lines: { athlete_id: string; stats: Record<string, number> }[]) =>
    call<void>('verify_session', { p_session: sessionId, p_lines: lines }),
  reopenSession: (sessionId: string) => call<void>('reopen_session', { p_session: sessionId }),
  correctStatLine: (sessionId: string, athleteId: string, stats: Record<string, number>) =>
    call<void>('correct_stat_line', { p_session: sessionId, p_athlete: athleteId, p_stats: stats }),
  setAttendance: (sessionId: string, athleteId: string, status: 'present' | 'absent') =>
    call<void>('set_attendance', { p_session: sessionId, p_athlete: athleteId, p_status: status }),
  reportInjury: (athleteId: string) => call<string>('report_injury', { p_athlete: athleteId }),
  confirmInjury: (injuryId: string) => call<void>('confirm_injury', { p_injury: injuryId }),
  clearInjury: (athleteId: string) => call<void>('clear_injury', { p_athlete: athleteId }),
  createStage: (seasonId: string, name: string, startsOn: string, endsOn: string, tournament: string | null) =>
    call<string>('create_stage', {
      p_season: seasonId, p_name: name, p_starts_on: startsOn, p_ends_on: endsOn, p_tournament: tournament,
    }),
  updateStage: (stageId: string, name: string, startsOn: string, endsOn: string, tournament: string | null) =>
    call<void>('update_stage', {
      p_stage: stageId, p_name: name, p_starts_on: startsOn, p_ends_on: endsOn, p_tournament: tournament,
    }),
  grantStageAllowance: (stageId: string) => call<number>('grant_stage_allowance', { p_stage: stageId }),
  recordDonation: (membershipId: string, dollars: number, note: string) =>
    call<number>('record_donation', { p_membership: membershipId, p_dollars: dollars, p_note: note }),
  adjustCredits: (membershipId: string, amount: number, note: string) =>
    call<number>('adjust_credits', { p_membership: membershipId, p_amount: amount, p_note: note }),
};

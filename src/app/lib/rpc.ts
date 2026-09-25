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
};

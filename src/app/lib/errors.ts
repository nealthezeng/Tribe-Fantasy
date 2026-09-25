const MESSAGES: Record<string, string> = {
  NOT_CONFIGURED: 'The app is not connected to a database yet.',
  NOT_SIGNED_IN: 'Please sign in first.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "That item doesn't exist.",
  INVALID_NAME: 'Names must be 1–60 characters.',
  INVALID_SETTINGS: 'Those season settings are not valid.',
  LEAGUE_EXISTS: 'That season already has a league with this name.',
  INVALID_CODE: 'Invite codes are 6–20 letters or digits.',
  CODE_TAKEN: 'That invite code already exists.',
  ATHLETE_EXISTS: 'An athlete with that name is already in this season.',
  NO_PROFILE: 'Set your display name first.',
  INVALID_TEAM_NAME: 'Team names must be 1–40 characters.',
  INVALID_INVITE: 'That invite code is invalid, expired, or used up.',
  INVALID_INVITE_SETTINGS: 'Invite settings are not valid (max uses must be at least 1).',
  ALREADY_MEMBER: "You're already in this league.",
  TEAM_NAME_TAKEN: 'Another team in this league already has that name.',
  INVALID_ROLE: 'Unknown role.',
  LAST_ADMIN: "You can't remove the last admin.",
};

export function errorMessage(err: unknown): string {
  const raw =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);
  return MESSAGES[raw.trim()] ?? `Something went wrong: ${raw}`;
}

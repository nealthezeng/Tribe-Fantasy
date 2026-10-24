import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../../core/settings';
import { api } from './rpc';

const rpc = vi.hoisted(() => vi.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: string; error: null }>>(
  () => Promise.resolve({ data: 'id', error: null })));
vi.mock('./supabase', () => ({ supabase: { rpc } }));

const sent = () => rpc.mock.calls.map(([, args]) => args.p_settings);
const withoutVoice = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).filter(([k]) => k !== 'voice_tally'));

beforeEach(() => rpc.mockClear());

// Pre-M16 builds' parseSettings refuses unknown keys, so voice_tally is never stored while on (M16 §5.7).
describe('season settings writers', () => {
  it('leave voice_tally out while it is on', async () => {
    await api.createSeason('Spring', DEFAULT_SETTINGS);
    await api.updateSeasonSettings('se', parseSettings({}));
    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual(['create_season', 'update_season_settings']);
    expect(sent()).toEqual([withoutVoice, withoutVoice]);
  });

  it('store voice_tally once it is off', async () => {
    await api.updateSeasonSettings('se', parseSettings({ voice_tally: false }));
    expect(sent()).toEqual([{ ...withoutVoice, voice_tally: false }]);
  });
});

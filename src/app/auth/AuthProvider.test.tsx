// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthProvider';

const mock = vi.hoisted(() => ({
  getSession: vi.fn(),
  from: vi.fn(),
  onAuth: null as null | ((event: string, session: unknown) => void),
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mock.getSession(),
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        mock.onAuth = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from: (table: string) => mock.from(table),
  },
}));

function Probe() {
  return <p>{useAuth().loading ? 'loading' : 'ready'}</p>;
}
const mount = () => render(<AuthProvider><Probe /></AuthProvider>);

afterEach(() => {
  cleanup();
  mock.getSession.mockReset();
  mock.from.mockReset();
});

describe('AuthProvider avatar', () => {
  const session = (id: string) => ({ user: { id } });
  /** profiles answers from `row`, user_roles with no roles. */
  const answer = (row: () => { data: unknown; error: unknown }) => mock.from.mockImplementation((table: string) => (table === 'profiles'
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => row() }) }) }
    : { select: () => ({ eq: async () => ({ data: [], error: null }) }) }));
  let auth: ReturnType<typeof useAuth>;
  function Avatar() {
    auth = useAuth();
    return <p data-testid="avatar">{auth.avatar === undefined ? 'unknown' : JSON.stringify(auth.avatar)}</p>;
  }
  const mountAvatar = () => render(<AuthProvider><Avatar /></AuthProvider>);

  it('loads the saved avatar, and null when there is none', async () => {
    mock.getSession.mockResolvedValue({ data: { session: session('u1') } });
    answer(() => ({ data: { display_name: 'A', avatar: { hat: 'crown' } }, error: null }));
    const a = mountAvatar();
    await a.findByText('{"hat":"crown"}');
    cleanup();
    answer(() => ({ data: { display_name: 'A', avatar: null }, error: null }));
    await mountAvatar().findByText('null');
  });

  it('keeps what it knew when a later fetch fails', async () => {
    mock.getSession.mockResolvedValue({ data: { session: session('u1') } });
    let row = { data: { display_name: 'A', avatar: { hat: 'crown' } } as unknown, error: null as unknown };
    answer(() => row);
    const a = mountAvatar();
    await a.findByText('{"hat":"crown"}');
    row = { data: null, error: new Error('offline') };
    await act(() => auth.refresh());
    expect(a.getByTestId('avatar').textContent).toBe('{"hat":"crown"}');
  });

  it("never shows the last user's figure after a sign-in as someone else", async () => {
    mock.getSession.mockResolvedValue({ data: { session: session('u1') } });
    let row = { data: { display_name: 'A', avatar: { hat: 'crown' } } as unknown, error: null as unknown };
    answer(() => row);
    const a = mountAvatar();
    await a.findByText('{"hat":"crown"}');
    row = { data: null, error: new Error('offline') };
    act(() => mock.onAuth!('SIGNED_IN', session('u2')));
    expect(a.getByTestId('avatar').textContent).toBe('unknown');
    await waitFor(() => expect(mock.from).toHaveBeenCalled());
    expect(a.getByTestId('avatar').textContent).toBe('unknown');
  });
});

describe('AuthProvider loading', () => {
  it('finishes loading when the profile fetch throws', async () => {
    mock.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mock.from.mockImplementation(() => { throw new Error('offline'); });
    const { findByText } = mount();
    await findByText('ready');
    expect(mock.from).toHaveBeenCalled();
  });

  it('finishes loading when the session check fails', async () => {
    mock.getSession.mockRejectedValue(new Error('offline'));
    const { findByText } = mount();
    await findByText('ready');
    expect(mock.from).not.toHaveBeenCalled();
  });
});

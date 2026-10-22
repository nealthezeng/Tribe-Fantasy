// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthProvider';

const mock = vi.hoisted(() => ({
  getSession: vi.fn(),
  from: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mock.getSession(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
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

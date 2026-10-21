// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MePage } from './MePage';

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }) }));
vi.mock('../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { notify_email: true }, error: null }) }) }) }) },
}));
vi.mock('../lib/rpc', () => ({ api: { setNotifyEmail: vi.fn() } }));

afterEach(cleanup);

describe('MePage', () => {
  it('is just Me and the email reminders: no injury or attendance', async () => {
    render(<MemoryRouter><MePage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Me' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Emails' })).toBeTruthy();
    expect(screen.queryByText(/Report an injury|Attendance|Injury/)).toBeNull();
  });
});

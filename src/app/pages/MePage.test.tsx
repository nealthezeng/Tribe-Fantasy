// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MePage } from './MePage';

const auth = vi.hoisted(() => ({ loading: false, displayName: 'Pat' as string | undefined, refresh: vi.fn(async () => {}) }));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: auth.loading, displayName: auth.displayName, refresh: auth.refresh }),
}));
vi.mock('../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { notify_email: true }, error: null }) }) }) }) },
}));
const api = vi.hoisted(() => ({ setNotifyEmail: vi.fn(), setDisplayName: vi.fn(async () => {}) }));
vi.mock('../lib/rpc', () => ({ api }));

afterEach(() => {
  cleanup();
  auth.loading = false;
  auth.displayName = 'Pat';
  vi.clearAllMocks();
});

const renderMe = () => render(<MemoryRouter><MePage /></MemoryRouter>);

describe('MePage', () => {
  it('is Me, your name and the email reminders: no injury or attendance', async () => {
    renderMe();
    expect(screen.getByRole('heading', { name: 'Me' })).toBeTruthy();
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Pat');
    expect(await screen.findByRole('heading', { name: 'Emails' })).toBeTruthy();
    expect(screen.queryByText(/Report an injury|Attendance|Injury/)).toBeNull();
  });

  it('changes your name through set_display_name and says it saved', async () => {
    renderMe();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Pat Reyes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(api.setDisplayName).toHaveBeenCalledWith('Pat Reyes');
    expect(auth.refresh).toHaveBeenCalled(); // the account menu shows the new name
  });

  it('shows the loading skeleton while sign-in loads', () => {
    auth.loading = true;
    renderMe();
    expect(screen.getByRole('status').className).toBe('skeleton');
    expect(screen.queryByRole('heading', { name: 'Me' })).toBeNull();
  });
});

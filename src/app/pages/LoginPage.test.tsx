// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: null, loading: false }) }));
vi.mock('../lib/supabase', () => ({ supabase: { auth: { signInWithOtp: vi.fn(async () => ({ error: null })) } } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Asks for a code and returns the "Code sent" notice. */
async function sendCode() {
  render(<LoginPage />);
  const email = screen.getByLabelText('Email');
  fireEvent.change(email, { target: { value: 'pat@x.test' } });
  fireEvent.submit(email.closest('form')!);
  return (await screen.findByText(/Code sent to/)).textContent;
}

it('asks for an email to send a code to, in code words (the email carries a code, not only a link)', () => {
  render(<LoginPage />);
  expect(screen.getByRole('button', { name: 'Email me a code' })).toBeTruthy();
  expect(screen.getByText("We'll email you a 6-digit code.")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/sign-in link/i);
});

it('tells someone in the installed app to type the code', async () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }));
  expect(await sendCode()).toBe('Code sent to pat@x.test. Type the code from the email here: its link opens your browser, not this app.');
});

it('keeps the browser wording in a browser', async () => {
  expect(await sendCode()).toBe('Code sent to pat@x.test.');
});

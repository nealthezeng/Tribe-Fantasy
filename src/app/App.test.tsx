// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('explains that the database is not connected when no Supabase config is present', () => {
    render(<App />);
    expect(screen.getByText(/not connected to a database yet/i)).toBeTruthy();
  });
});

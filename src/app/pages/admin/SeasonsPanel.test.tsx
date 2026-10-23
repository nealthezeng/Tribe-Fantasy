// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/rpc';
import { SeasonsPanel } from './SeasonsPanel';

const ALL = [{ id: 's2', name: 'Spring 2027', status: 'setup' }, { id: 's1', name: 'Fall 2026', status: 'live' }];

vi.mock('../../lib/rpc', () => ({ api: {
  deleteSeason: vi.fn(() => Promise.resolve()),
  renameSeason: vi.fn(() => Promise.resolve()),
  createSeason: vi.fn(() => Promise.resolve('s3')),
} }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const reload = vi.fn(() => Promise.resolve(true));

// Picking the managed season, and falling back to the newest after a delete, are AdminPage's (AdminPage.test.tsx).
describe('SeasonsPanel (t213)', () => {
  it('unlocks Delete season only once the name is typed, and warns that the next season becomes current', async () => {
    render(<SeasonsPanel seasons={ALL} selected="s2" onSelect={vi.fn()} reload={reload} />);
    const del = screen.getByRole('button', { name: 'Delete season', hidden: true });
    expect(del.className).toBe('danger-link');
    expect(document.body.textContent).toContain('stat, share and credit in Spring 2027');
    expect(screen.getByText(/Everyone will see Fall 2026 as the current season/)).toBeTruthy();
    const confirm = screen.getByLabelText('Type Spring 2027 to confirm');
    fireEvent.change(confirm, { target: { value: 'spring 2027' } });
    expect((del as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(confirm, { target: { value: 'Spring 2027' } });
    expect((del as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(del);
    await waitFor(() => expect(api.deleteSeason).toHaveBeenCalledWith('s2'));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('renames the managed season, with no current-season warning on an older one', async () => {
    render(<SeasonsPanel seasons={ALL} selected="s1" onSelect={vi.fn()} reload={reload} />);
    const input = screen.getByDisplayValue('Fall 2026');
    expect(screen.queryByText(/as the current season/)).toBeNull();
    fireEvent.change(input, { target: { value: 'Fall Beta 2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename season', hidden: true }));
    await waitFor(() => expect(api.renameSeason).toHaveBeenCalledWith('s1', 'Fall Beta 2026'));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('picks nothing by itself, and manages a season it creates', async () => {
    const onSelect = vi.fn();
    render(<SeasonsPanel seasons={ALL} selected={null} onSelect={onSelect} reload={reload} />);
    expect(screen.queryByText('Managing')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('e.g. Spring 2027'), { target: { value: 'Fall 2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create season', hidden: true }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('s3'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalled();
  });
});

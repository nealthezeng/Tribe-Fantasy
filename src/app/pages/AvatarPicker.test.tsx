// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAvatar } from '../lib/avatar';
import { AvatarPicker } from './AvatarPicker';

const h = vi.hoisted(() => ({ setAvatar: vi.fn(), refresh: vi.fn(), avatar: null as unknown }));
vi.mock('../lib/rpc', () => ({ api: { setAvatar: h.setAvatar } }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ avatar: h.avatar, refresh: h.refresh }) }));

const group = (name: string) => screen.getByRole('group', { name });
const option = (slot: string, name: string) => within(group(slot)).getByRole('radio', { name }) as HTMLInputElement;
const save = () => screen.getByRole('button', { name: 'Save avatar' });
const edit = () => screen.getByRole('button', { name: 'Edit avatar' });
const mount = () => {
  const view = render(<AvatarPicker uid="u1" />);
  fireEvent.click(edit());
  return view;
};
const STORED = { pose: 'forehand', hat: 'cap', frisbee: 'purple', background: 'lilac' };
const LILAC = '#c5b4f5';
const GOLD = '#f5b700';
const figure = (view: { container: HTMLElement }) => view.container.querySelector('.avatar-me .figure')!.innerHTML;

beforeEach(() => {
  h.setAvatar.mockReset().mockResolvedValue(undefined);
  h.refresh.mockReset().mockResolvedValue(undefined);
  h.avatar = STORED;
});
afterEach(cleanup);

describe('AvatarPicker', () => {
  it('starts collapsed: the figure and Edit avatar, with no selector', () => {
    const view = render(<AvatarPicker uid="u1" />);
    expect(figure(view)).toContain(LILAC);
    expect(edit().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save avatar' })).toBeNull();
  });

  it('Edit avatar drops the selector down', () => {
    mount();
    expect(edit().getAttribute('aria-expanded')).toBe('true');
    expect(group('Pose')).toBeTruthy();
    expect(save()).toBeTruthy();
  });

  it('collapses after a save, showing what was saved, with focus back on Edit avatar', async () => {
    const view = mount();
    fireEvent.click(option('Background color', 'Gold'));
    fireEvent.click(save());
    await screen.findByText('Saved.');
    expect(screen.queryByRole('group')).toBeNull();
    expect(figure(view)).toContain(GOLD);
    expect(document.activeElement).toBe(edit());
  });

  it('stays open after a failed save', async () => {
    h.setAvatar.mockRejectedValue(new Error('BAD_AVATAR'));
    mount();
    fireEvent.click(save());
    await screen.findByRole('alert');
    expect(group('Pose')).toBeTruthy();
  });

  it('closing without saving shows the saved figure again and keeps your picks for next time', () => {
    const view = mount();
    fireEvent.click(option('Background color', 'Gold'));
    expect(figure(view)).toContain(GOLD);
    fireEvent.click(edit());
    expect(figure(view)).toContain(LILAC);
    expect(h.setAvatar).not.toHaveBeenCalled();
    fireEvent.click(edit());
    expect(option('Background color', 'Gold').checked).toBe(true);
  });

  it('starts from the saved avatar', () => {
    mount();
    expect(option('Hat', 'Cap').checked).toBe(true);
    expect(option('Frisbee color', 'Purple').checked).toBe(true);
  });

  it('starts from the generated figure when none is saved', () => {
    h.avatar = null;
    mount();
    const hat = resolveAvatar(null, 'u1').hat;
    const checked = within(group('Hat')).getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked) as HTMLInputElement[];
    expect(checked.map((r) => r.value)).toEqual([hat]);
  });

  it('changes only the preview until Save', () => {
    mount();
    fireEvent.click(option('Hat', 'Crown'));
    expect(option('Hat', 'Crown').checked).toBe(true);
    expect(h.setAvatar).not.toHaveBeenCalled();
  });

  it('Save stores every part and refreshes auth', async () => {
    mount();
    fireEvent.click(option('Hat', 'Crown'));
    fireEvent.click(save());
    await screen.findByText('Saved.');
    expect(h.setAvatar).toHaveBeenCalledTimes(1);
    expect(h.setAvatar).toHaveBeenCalledWith({ ...resolveAvatar(STORED, 'u1'), hat: 'crown' });
    expect(Object.keys(h.setAvatar.mock.calls[0][0])).toHaveLength(11);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it('Shuffle changes the preview without saving', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }));
    expect(option('Hat', 'None').checked).toBe(true);
    expect(h.setAvatar).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('hides frisbee colors for a pose without one', () => {
    mount();
    fireEvent.click(option('Pose', 'Cheering'));
    expect(screen.queryByRole('group', { name: 'Frisbee color' })).toBeNull();
  });

  it('keeps hidden parts when the pose changes back', () => {
    mount();
    fireEvent.click(option('Pose', 'Cheering'));
    fireEvent.click(option('Pose', 'Forehand'));
    expect(option('Frisbee color', 'Purple').checked).toBe(true);
  });

  it('saves a hidden part too', async () => {
    mount();
    fireEvent.click(option('Pose', 'Peeking'));
    fireEvent.click(save());
    await screen.findByText('Saved.');
    expect(h.setAvatar.mock.calls[0][0]).toMatchObject({ pose: 'peek', frisbee: 'purple' });
  });

  it('hides what Peeking covers but keeps Top color', () => {
    mount();
    fireEvent.click(option('Pose', 'Peeking'));
    for (const name of ['Top', 'Bottom', 'Bottom color', 'Extra']) expect(screen.queryByRole('group', { name })).toBeNull();
    expect(group('Top color')).toBeTruthy();
  });

  it('a failed save shows the error and keeps the preview', async () => {
    h.setAvatar.mockRejectedValue(new Error('BAD_AVATAR'));
    mount();
    fireEvent.click(option('Hat', 'Crown'));
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn't be saved/);
    expect(option('Hat', 'Crown').checked).toBe(true);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('shows a failed save beside the Save button', async () => {
    h.setAvatar.mockRejectedValue(new Error('BAD_AVATAR'));
    mount();
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).closest('.avatar-stage')).not.toBeNull();
  });

  it('holds every choice while saving, so "Saved." always describes what is on screen', async () => {
    let finish = () => {};
    h.setAvatar.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    mount();
    fireEvent.click(save());
    expect((group('Hat') as HTMLFieldSetElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Shuffle' }) as HTMLButtonElement).disabled).toBe(true);
    finish();
    await screen.findByText('Saved.');
    fireEvent.click(edit());
    expect((group('Hat') as HTMLFieldSetElement).disabled).toBe(false);
  });

  it('a second tap while saving sends nothing', async () => {
    let finish = () => {};
    h.setAvatar.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    mount();
    fireEvent.click(save());
    const busy = screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(h.setAvatar).toHaveBeenCalledTimes(1);
    finish();
    await screen.findByText('Saved.');
  });

  it('drops "Saved." on opening the selector again', async () => {
    mount();
    fireEvent.click(save());
    await screen.findByText('Saved.');
    fireEvent.click(edit());
    expect(screen.queryByText('Saved.')).toBeNull();
  });
});

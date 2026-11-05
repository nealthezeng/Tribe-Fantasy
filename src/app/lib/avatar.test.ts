import { describe, expect, it } from 'vitest';
import { randomAvatar, resolveAvatar, slotsFor, SLOTS, type Slot } from './avatar';

const parts = (slot: Slot) => SLOTS.find((s) => s.slot === slot)!.parts;

describe('resolveAvatar', () => {
  it('is stable for a seed', () => {
    expect(resolveAvatar(null, 'u1')).toEqual(resolveAvatar(null, 'u1'));
  });

  it('differs across seeds', () => {
    const figures = Array.from({ length: 20 }, (_, i) => JSON.stringify(resolveAvatar(null, `u${i}`)));
    expect(new Set(figures).size).toBeGreaterThan(1);
  });

  it('keeps saved parts', () => {
    expect(resolveAvatar({ hat: 'crown' }, 'u1').hat).toBe('crown');
  });

  it('falls back part by part', () => {
    const base = resolveAvatar(null, 'u1');
    const face = base.face === 'blush' ? 'stache' : 'blush';
    expect(resolveAvatar({ hat: 'jetpack', face }, 'u1')).toEqual({ ...base, face });
  });

  it.each([
    ['null', null], ['an array', []], ['a number', 1], ['a string', 'x'], ['a non-string part', { hat: 5 }],
    ['an object key', { constructor: 'x', hat: 'toString' }], ['markup', { hat: '"><script>x</script>' }],
  ])('ignores %s', (_label, junk) => {
    expect(resolveAvatar(junk, 'u1')).toEqual(resolveAvatar(null, 'u1'));
  });
});

describe('the parts', () => {
  it('has the agreed parts', () => {
    expect(Object.fromEntries(SLOTS.map((s) => [s.slot, s.parts.length]))).toEqual({
      pose: 10, frisbee: 7, hat: 10, face: 6, extra: 4, top: 4, topColor: 8, bottom: 3, bottomColor: 8, body: 8, background: 8,
    });
  });

  it('never brings back a cut part', () => {
    const keys = SLOTS.flatMap((s) => s.parts.map((p) => p.key));
    for (const cut of ['shy', 'flop', 'hug', 'sit', 'stretch', 'hammer', 'bid', 'kilt', 'stripes']) expect(keys).not.toContain(cut);
  });

  it('calls the circle a Background color, never a disc', () => {
    expect(SLOTS.find((s) => s.slot === 'background')!.label).toBe('Background color');
    expect(SLOTS.map((s) => s.label).join()).not.toMatch(/disc/i);
  });

  it('offers the same colors for bottoms as for tops', () => {
    expect(parts('bottomColor')).toEqual(parts('topColor'));
  });

  it('gives every color slot a color and every frisbee a rim', () => {
    for (const slot of ['frisbee', 'topColor', 'bottomColor', 'body', 'background'] as const) {
      for (const p of parts(slot)) expect(p.color, `${slot}.${p.key}`).toMatch(/^#/);
    }
    for (const p of parts('frisbee')) expect(p.rim, p.key).toMatch(/^#/);
  });
});

describe('slotsFor', () => {
  it('shows frisbee colors only for poses holding one', () => {
    for (const p of ['forehand', 'layout', 'sky', 'spin']) expect(slotsFor(p)).toContain('frisbee');
    for (const p of ['trophy', 'cheer', 'shrug', 'drink', 'winded', 'peek']) expect(slotsFor(p)).not.toContain('frisbee');
  });

  it('keeps only what shows when peeking', () => {
    expect(slotsFor('peek')).toEqual(['pose', 'hat', 'face', 'topColor', 'body', 'background']);
  });

  it('lists a full pose in picker order', () => {
    expect(slotsFor('forehand')).toEqual(SLOTS.map((s) => s.slot));
  });
});

describe('randomAvatar', () => {
  it('only uses real parts', () => {
    for (let i = 0; i < 50; i++) {
      const a = randomAvatar();
      for (const { slot, parts: list } of SLOTS) expect(list.map((p) => p.key)).toContain(a[slot]);
    }
  });
});

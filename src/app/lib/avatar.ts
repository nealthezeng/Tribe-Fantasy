/** The avatar parts, and turning whatever is stored into a figure that can always be drawn. */
export type Slot = 'pose' | 'frisbee' | 'hat' | 'face' | 'extra' | 'top' | 'topColor' | 'bottom' | 'bottomColor' | 'body' | 'background';
export type AvatarChoice = Record<Slot, string>;
/** rim: the frisbee's darker edge. Colors are art data: they don't follow tokens.css, so a theme change doesn't recolor anyone. */
export interface Part { key: string; label: string; color?: string; rim?: string }

const TOP_COLORS: Part[] = [
  { key: 'deep', label: 'Deep blue', color: '#0b5d99' }, { key: 'gold', label: 'Gold', color: '#f5b700' },
  { key: 'white', label: 'White', color: '#ffffff' }, { key: 'char', label: 'Charcoal', color: '#1a2129' },
  { key: 'baby', label: 'Baby blue', color: '#8cc8f2' }, { key: 'red', label: 'Red', color: '#d9534f' },
  { key: 'green', label: 'Green', color: '#2f9e6e' }, { key: 'purple', label: 'Purple', color: '#7a5fd0' },
];

/** In picker order. */
export const SLOTS: { slot: Slot; label: string; parts: Part[] }[] = [
  { slot: 'pose', label: 'Pose', parts: [
    { key: 'forehand', label: 'Forehand' }, { key: 'layout', label: 'Layout' }, { key: 'sky', label: 'Skying it' },
    { key: 'spin', label: 'Finger spin' }, { key: 'trophy', label: 'Trophy' }, { key: 'cheer', label: 'Cheering' },
    { key: 'shrug', label: 'Shrug' }, { key: 'drink', label: 'Water break' }, { key: 'winded', label: 'Winded' },
    { key: 'peek', label: 'Peeking' },
  ] },
  { slot: 'frisbee', label: 'Frisbee color', parts: [
    { key: 'red', label: 'Red', color: '#d9534f', rim: '#9c2f2b' }, { key: 'tang', label: 'Tangerine', color: '#ff8a3d', rim: '#c25a14' },
    { key: 'gold', label: 'Gold', color: '#f5b700', rim: '#a87d00' }, { key: 'deep', label: 'Deep blue', color: '#0b5d99', rim: '#07406b' },
    { key: 'green', label: 'Green', color: '#2f9e6e', rim: '#1d6b49' }, { key: 'purple', label: 'Purple', color: '#7a5fd0', rim: '#533e9c' },
    { key: 'char', label: 'Charcoal', color: '#2a333d', rim: '#12171c' },
  ] },
  { slot: 'hat', label: 'Hat', parts: [
    { key: 'none', label: 'None' }, { key: 'band', label: 'Headband' }, { key: 'cap', label: 'Cap' }, { key: 'back', label: 'Backward cap' },
    { key: 'bucket', label: 'Bucket hat' }, { key: 'beanie', label: 'Beanie' }, { key: 'visor', label: 'Visor' }, { key: 'crown', label: 'Crown' },
    { key: 'cone', label: 'Traffic cone' }, { key: 'prop', label: 'Propeller' },
  ] },
  { slot: 'face', label: 'Face', parts: [
    { key: 'none', label: 'Just eyes' }, { key: 'shades', label: 'Shades' }, { key: 'glasses', label: 'Glasses' },
    { key: 'eyeblack', label: 'Eye black' }, { key: 'blush', label: 'Blush' }, { key: 'stache', label: 'Mustache' },
  ] },
  { slot: 'extra', label: 'Extra', parts: [
    { key: 'none', label: 'None' }, { key: 'medal', label: 'Medal' }, { key: 'scarf', label: 'Scarf' }, { key: 'cape', label: 'Cape' },
  ] },
  { slot: 'top', label: 'Top', parts: [
    { key: 'tee', label: 'Tee' }, { key: 'tank', label: 'Tank' }, { key: 'long', label: 'Long sleeve' }, { key: 'hoodie', label: 'Hoodie' },
  ] },
  { slot: 'topColor', label: 'Top color', parts: TOP_COLORS },
  { slot: 'bottom', label: 'Bottom', parts: [
    { key: 'shorts', label: 'Shorts' }, { key: 'pants', label: 'Long pants' }, { key: 'tutu', label: 'Tutu' },
  ] },
  { slot: 'bottomColor', label: 'Bottom color', parts: TOP_COLORS },
  { slot: 'body', label: 'Body color', parts: [
    { key: 'gold', label: 'Gold', color: '#f5b700' }, { key: 'baby', label: 'Baby blue', color: '#8cc8f2' },
    { key: 'chalk', label: 'Chalk', color: '#e8edf2' }, { key: 'mint', label: 'Mint', color: '#9fe3b4' },
    { key: 'coral', label: 'Coral', color: '#ff9d8a' }, { key: 'lilac', label: 'Lilac', color: '#c5b4f5' },
    { key: 'butter', label: 'Butter', color: '#ffd76a' }, { key: 'tang', label: 'Tangerine', color: '#ff8a3d' },
  ] },
  { slot: 'background', label: 'Background color', parts: [
    { key: 'deep', label: 'Deep blue', color: '#0b5d99' }, { key: 'baby', label: 'Baby blue', color: '#8cc8f2' },
    { key: 'gold', label: 'Gold', color: '#f5b700' }, { key: 'lilac', label: 'Lilac', color: '#c5b4f5' },
    { key: 'coral', label: 'Coral', color: '#ff9d8a' }, { key: 'mint', label: 'Mint', color: '#9fe3b4' },
    { key: 'navy', label: 'Navy', color: '#16304a' }, { key: 'char', label: 'Charcoal', color: '#2a333d' },
  ] },
];

const HOLDS_FRISBEE = ['forehand', 'layout', 'sky', 'spin'];
const HIDDEN_WHEN_PEEKING: Slot[] = ['top', 'bottom', 'bottomColor', 'extra'];

/** The parts that change anything in this pose: the picker's rows. */
export function slotsFor(pose: string): Slot[] {
  return SLOTS.map((s) => s.slot).filter((slot) => (slot !== 'frisbee' || HOLDS_FRISBEE.includes(pose))
    && (pose !== 'peek' || !HIDDEN_WHEN_PEEKING.includes(slot)));
}

/** FNV-1a: a small, stable hash, so a seed gives the same figure on every device. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/**
 * Whatever is stored becomes a valid figure: a part that's missing or unknown takes the one generated from `seed`, so
 * a stored value is only ever compared to the part lists and never reaches the drawing.
 * ponytail: adding parts reshuffles generated figures; saved avatars never change.
 */
export function resolveAvatar(stored: unknown, seed: string): AvatarChoice {
  const saved = stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? stored as Partial<Record<Slot, unknown>> : {};
  return Object.fromEntries(SLOTS.map(({ slot, parts }) => [slot,
    parts.find((p) => p.key === saved[slot])?.key ?? parts[hash(`${seed}:${slot}`) % parts.length].key])) as AvatarChoice;
}

export function randomAvatar(): AvatarChoice {
  return Object.fromEntries(SLOTS.map(({ slot, parts }) => [slot, parts[Math.floor(Math.random() * parts.length)].key])) as AvatarChoice;
}

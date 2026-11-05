import { SLOTS, type AvatarChoice, type Part, type Slot } from '../lib/avatar';

interface Shape {
  d: string; fill?: string; stroke?: string; w?: number; cap?: 'butt' | 'round';
  /** Part of the path only: `dash` of 100 along it, starting `off` back. */
  dash?: string; off?: number; rot?: string;
}

const circle = (x: number, y: number, rx: number, ry = rx) => `M${x - rx} ${y}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
const line = (d: string, stroke: string, w: number, cap?: 'butt'): Shape => ({ d, stroke, w, cap });
const solid = (d: string, fill: string, w = 1.5, stroke = fill): Shape => ({ d, fill, stroke, w });

const GOLD = '#f5b700', INK = '#111111', RED = '#d9534f', BLUE = '#8cc8f2';

interface Pose {
  head: [number, number, number]; torso?: string;
  arms: string[]; // back, then front
  legs: string[];
  /** The frisbee: x, y, width, height, tilt. */
  frisbee?: [number, number, number, number, number];
  props?: Shape[]; // behind the head
}

// Limbs are thick round lines. Everything fits the 100-unit box; wide poses are kept tight so the figure stays big at 48px.
const POSES: Record<string, Pose> = {
  forehand: { head: [44, 27, 17], torso: 'M44 47L44 65', arms: ['M40 51L25 60', 'M48 51L70 46'], legs: ['M41 69L30 91', 'M48 69L62 77L64 91'], frisbee: [80, 43, 12, 5.5, -10] },
  layout: { head: [65, 37, 17], torso: 'M52 50L36 57', arms: ['M56 58L66 70', 'M61 50L80 38'], legs: ['M34 56L14 50', 'M34 61L18 74'], frisbee: [88, 32, 11, 5.5, -20] },
  sky: { head: [50, 40, 17], torso: 'M50 59L50 73', arms: ['M44 57L34 28', 'M56 57L66 28'], legs: ['M46 77L36 86L42 94', 'M54 77L64 85L60 94'], frisbee: [57, 13, 14, 6.5, -16] },
  spin: { head: [46, 42, 17], torso: 'M46 61L46 75', arms: ['M39 61L28 69L38 75', 'M53 59L68 30'], legs: ['M42 79L38 94', 'M50 79L54 94'], frisbee: [68, 20, 15, 6, 0] },
  trophy: { head: [50, 46, 16], torso: 'M50 65L50 77', arms: ['M44 63L38 32', 'M56 63L62 32'], legs: ['M46 81L42 94', 'M54 81L58 94'], props: [
    line('M50 24L50 30', '#c99400', 5), line('M40 31L60 31', '#c99400', 5), line('M38 10Q28 10 34 18', GOLD, 3), line('M62 10Q72 10 66 18', GOLD, 3),
    solid('M38 5h24v9a12 12 0 0 1-24 0Z', GOLD),
  ] },
  cheer: { head: [50, 34, 17], torso: 'M50 53L50 71', arms: ['M43 51L25 27', 'M57 51L75 27'], legs: ['M45 75L40 92', 'M55 75L60 92'] },
  shrug: { head: [50, 34, 17], torso: 'M50 53L50 71', arms: ['M43 53L28 59L22 45', 'M57 53L72 59L78 45'], legs: ['M45 75L42 92', 'M55 75L58 92'] },
  drink: { head: [46, 34, 17], torso: 'M46 53L46 73', arms: ['M40 57L32 69', 'M52 57L70 51L68 33'], legs: ['M42 77L38 92', 'M50 77L54 92'], props: [
    line('M60 37L76 23', BLUE, 8), line('M60 37L56 40', '#ffffff', 4),
  ] },
  winded: { head: [60, 38, 17], torso: 'M48 49L34 60', arms: ['M50 53L60 75', 'M54 51L66 73'], legs: ['M32 64L28 92', 'M38 64L46 92'], props: [
    solid('M84 22q5 7 0 10q-5-3 0-10Z', BLUE, 1),
  ] },
  peek: { head: [50, 42, 24], arms: [], legs: [] },
};

const colorOf = (slot: Slot, key: string): Part => {
  const parts = SLOTS.find((s) => s.slot === slot)!.parts;
  return parts.find((p) => p.key === key) ?? parts[0];
};

function hat(kind: string, [x, y, r]: Pose['head'], color: string): Shape[] {
  const top = y - r * 0.25;
  const dome = `M${x - r} ${top}A${r} ${r} 0 0 1 ${x + r} ${top}Z`;
  switch (kind) {
    case 'band': return [line(`M${x - r * 0.98} ${y - r * 0.3}Q${x} ${y - r * 0.55} ${x + r * 0.98} ${y - r * 0.3}`, color, r * 0.32, 'butt'), line(`M${x - r} ${y - r * 0.35}L${x - r * 1.45} ${y - r * 0.1}`, color, r * 0.2)];
    case 'cap': return [solid(dome, color, 1), line(`M${x + r * 0.3} ${top}L${x + r * 1.55} ${top + 1}`, color, r * 0.26)];
    case 'back': return [solid(dome, color, 1), line(`M${x - r * 0.3} ${top}L${x - r * 1.5} ${top + 3}`, color, r * 0.26)];
    case 'bucket': return [solid(`M${x - r * 0.95} ${top}L${x - r * 0.7} ${y - r * 1.05}L${x + r * 0.7} ${y - r * 1.05}L${x + r * 0.95} ${top}Z`, color, 2), line(`M${x - r * 1.4} ${top + r * 0.12}L${x + r * 1.4} ${top + r * 0.12}`, color, r * 0.24)];
    case 'beanie': return [solid(dome, color, 1), line(`M${x - r * 1.02} ${top}L${x + r * 1.02} ${top}`, color, r * 0.32), solid(circle(x, y - r * 1.15, r * 0.22), '#ffffff', 0)];
    case 'visor': return [line(`M${x - r * 0.98} ${top}L${x + r * 0.98} ${top}`, color, r * 0.26, 'butt'), line(`M${x + r * 0.1} ${top + 1}L${x + r * 1.5} ${top + 2}`, color, r * 0.24)];
    case 'crown': return [solid(`M${x - r * 0.75} ${y - r * 0.55}L${x - r * 0.85} ${y - r * 1.4}L${x - r * 0.35} ${y - r * 0.95}L${x} ${y - r * 1.55}L${x + r * 0.35} ${y - r * 0.95}L${x + r * 0.85} ${y - r * 1.4}L${x + r * 0.75} ${y - r * 0.55}Z`, GOLD, 1.5, '#c99400')];
    case 'cone': return [solid(`M${x - r * 0.7} ${y - r * 0.6}L${x} ${y - r * 1.9}L${x + r * 0.7} ${y - r * 0.6}Z`, '#ff8a3d', 2), line(`M${x - r * 0.4} ${y - r * 1.1}L${x + r * 0.4} ${y - r * 1.1}`, '#ffffff', r * 0.2, 'butt')];
    case 'prop': return [solid(dome, color, 1), line(`M${x} ${y - r}L${x} ${y - r * 1.3}`, INK, r * 0.1), line(`M${x - r * 0.7} ${y - r * 1.34}L${x + r * 0.7} ${y - r * 1.26}`, RED, r * 0.2)];
    default: return [];
  }
}

function face(kind: string, [x, y, r]: Pose['head']): Shape[] {
  const ey = y + r * 0.08;
  const eyes = [solid(circle(x - r * 0.38, ey, r * 0.13), INK, 0), solid(circle(x + r * 0.38, ey, r * 0.13), INK, 0)];
  const ring = (cx: number): Shape => ({ d: circle(cx, ey, r * 0.28), stroke: INK, w: r * 0.08 });
  switch (kind) {
    case 'shades': return [line(`M${x - r * 0.7} ${ey}L${x - r * 0.12} ${ey}M${x + r * 0.12} ${ey}L${x + r * 0.7} ${ey}`, INK, r * 0.38), line(`M${x - r} ${ey - r * 0.06}L${x + r} ${ey - r * 0.06}`, INK, r * 0.08, 'butt')];
    case 'glasses': return [...eyes, ring(x - r * 0.38), ring(x + r * 0.38), line(`M${x - r * 0.1} ${ey}L${x + r * 0.1} ${ey}`, INK, r * 0.08)];
    case 'eyeblack': return [...eyes, line(`M${x - r * 0.58} ${ey + r * 0.3}L${x - r * 0.18} ${ey + r * 0.3}M${x + r * 0.18} ${ey + r * 0.3}L${x + r * 0.58} ${ey + r * 0.3}`, INK, r * 0.14, 'butt')];
    case 'blush': return [...eyes, solid(circle(x - r * 0.62, ey + r * 0.3, r * 0.18), '#ff8fa8', 0), solid(circle(x + r * 0.62, ey + r * 0.3, r * 0.18), '#ff8fa8', 0)];
    case 'stache': return [...eyes, solid(`M${x} ${ey + r * 0.32}Q${x - r * 0.3} ${ey + r * 0.22} ${x - r * 0.55} ${ey + r * 0.5}Q${x - r * 0.2} ${ey + r * 0.55} ${x} ${ey + r * 0.42}Q${x + r * 0.2} ${ey + r * 0.55} ${x + r * 0.55} ${ey + r * 0.5}Q${x + r * 0.3} ${ey + r * 0.22} ${x} ${ey + r * 0.32}Z`, INK, 0)];
    default: return eyes;
  }
}

/** The figure as flat lists, so the white die-cut edge can repaint all of it. Under the face, then the face, then over it. */
function build(a: AvatarChoice) {
  const p = Object.hasOwn(POSES, a.pose) ? POSES[a.pose] : POSES.forehand;
  const body = colorOf('body', a.body).color!, top = colorOf('topColor', a.topColor).color!, bottom = colorOf('bottomColor', a.bottomColor).color!;
  const limb = 10, list: Shape[] = [];
  const sleeve = a.top === 'tank' ? null : a.top === 'long' || a.top === 'hoodie' ? undefined : '38 200';
  const legDash = a.bottom === 'pants' ? undefined : '30 200';
  const arm = (d: string) => {
    list.push(line(d, body, limb));
    if (sleeve !== null) list.push({ ...line(d, top, limb), dash: sleeve });
  };
  const [sx, sy, ex, ey] = p.torso ? p.torso.match(/\d+/g)!.map(Number) : [0, 0, 0, 0];
  const len = Math.hypot(ex - sx, ey - sy) || 1, dx = (ex - sx) / len, dy = (ey - sy) / len, px = -dy, py = dx;
  if (p.torso && a.extra === 'cape') {
    list.push(solid(`M${sx + px * 9} ${sy + py * 9}L${ex + px * 18 + dx * 12} ${ey + py * 18 + dy * 12}L${ex - px * 18 + dx * 12} ${ey - py * 18 + dy * 12}L${sx - px * 9} ${sy - py * 9}Z`, RED, 2));
  }
  if (p.frisbee) {
    const [x, y, rx, ry, tilt] = p.frisbee, f = colorOf('frisbee', a.frisbee), rot = `rotate(${tilt} ${x} ${y})`;
    list.push({ ...solid(circle(x, y + 2, rx, ry), f.rim!, 1), rot }, { ...solid(circle(x, y, rx, ry), f.color!, 1), rot }, { d: circle(x, y, rx * 0.55, ry * 0.55), stroke: f.rim, w: 1, rot });
  }
  list.push(...(p.props ?? []));
  if (p.arms[0]) arm(p.arms[0]);
  for (const l of p.legs) list.push(line(l, body, limb + 1), { ...line(l, bottom, limb + 1), dash: legDash });
  if (p.torso) {
    list.push(line(p.torso, top, 23), { ...line(p.torso, bottom, 23), dash: '22 200', off: -78 });
    if (a.bottom === 'tutu') {
      const angle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI) + 90, cx = ex + dx * 6, cy = ey + dy * 6;
      list.push({ ...solid(circle(cx, cy, 20, 6), bottom, 1), rot: `rotate(${angle} ${cx} ${cy})` });
    }
  }
  if (p.arms[1]) arm(p.arms[1]);
  if (p.torso && a.extra === 'medal') {
    const cx = sx + dx * 8, cy = sy + dy * 8;
    list.push(line(`M${sx + px * 6} ${sy + py * 6}L${cx} ${cy}L${sx - px * 6} ${sy - py * 6}`, BLUE, 2.5), solid(circle(cx, cy, 5), GOLD, 1, '#c99400'));
  }
  const [hx, hy, hr] = p.head;
  if (p.torso && a.top === 'hoodie') list.push(solid(circle(hx, hy + hr * 0.3, hr * 1.2), top, 0));
  list.push(solid(circle(hx, hy, hr * 1.04, hr * 0.96), body, 0));
  if (p.torso && a.extra === 'scarf') {
    list.push(line(`M${sx + px * 9} ${sy + py * 9 - 2}L${sx - px * 9} ${sy - py * 9 - 2}`, RED, 6), line(`M${sx - px * 6} ${sy - py * 6}L${sx - px * 6 + dx * 12} ${sy - py * 6 + dy * 12}`, RED, 5));
  }
  // Peeking: the head rises behind a ledge in the top color, with two hands on it.
  const over = p.torso ? [] : [solid('M8 62h84v22a8 8 0 0 1-8 8h-68a8 8 0 0 1-8-8Z', top, 1), line('M24 58L24 64', body, 11), line('M76 58L76 64', body, 11)];
  const hatColor = a.topColor === 'char' ? GOLD : top; // a charcoal hat would vanish on the dark page
  return { list, face: face(a.face, p.head), over, hats: hat(a.hat, p.head, hatColor) };
}

const paint = (shapes: Shape[]) => shapes.map((s, i) => (
  <path key={i} d={s.d} fill={s.fill ?? 'none'} stroke={s.stroke ?? 'none'} strokeWidth={s.w ?? 0} strokeLinecap={s.cap ?? 'round'} strokeLinejoin="round"
    pathLength={s.dash ? 100 : undefined} strokeDasharray={s.dash} strokeDashoffset={s.off} transform={s.rot} />
));

const edge = (shapes: Shape[]) => shapes.map((s, i) => (
  <path key={i} d={s.d} fill={s.fill ? '#ffffff' : 'none'} stroke="#ffffff" strokeWidth={(s.w ?? 0) + 5} strokeLinecap="round" strokeLinejoin="round" transform={s.rot} />
));

/** A sticker of a person's choice: the figure breaks out of a Background color circle. Decoration beside a name, so hidden from screen readers. */
export function Avatar({ choice, className }: { choice: AvatarChoice; className?: string }) {
  const f = build(choice);
  return (
    <svg className={className ? `figure ${className}` : 'figure'} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="52" r="42" fill={colorOf('background', choice.background).color} />
      <g transform="translate(-2 0) scale(1.04)">
        {edge([...f.list, ...f.over, ...f.hats])}
        {paint(f.list)}
        {paint(f.face)}
        {paint(f.over)}
        {paint(f.hats)}
      </g>
    </svg>
  );
}

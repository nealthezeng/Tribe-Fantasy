import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// tokens.css is the one place for colours, fonts, sizes and motion; styles.css only reads them.
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

describe('styles.css reads every design value from tokens.css', () => {
  it.each([
    ['colour literals', /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi],
    ['raw font sizes or families', /font-(?:size|family):(?!\s*(?:var\(|inherit))[^;]+/g],
    ['raw radii', /border-radius:(?!\s*(?:var\(|0|50%|inherit))[^;]+/g],
    ['raw durations', /\b\d+m?s\b/g],
    ['raw letter-spacing', /letter-spacing:(?!\s*(?:var\(|normal))[^;]+/g],
  ])('has no %s', (_name, pattern) => {
    expect(styles.match(pattern) ?? []).toEqual([]);
  });
});

describe('the phone dock and the page fade stay off the tally board (t92, t99)', () => {
  it('hides the bottom tab bar while the tally board is up', () => {
    expect(styles).toMatch(/body:has\(\.tally-bar\) \.tabs \{ display: none; \}/);
  });

  it('keeps the top bar on screen on phones, but not over the tally board (P9)', () => {
    const phone = styles.slice(styles.indexOf('@media (max-width: 639px)'));
    expect(phone).toMatch(/\.topbar \{ position: sticky; top: 0; z-index: 2; \}/);
    expect(phone).toMatch(/body:has\(\.tally-bar\) \.topbar \{ position: static; \}/);
  });

  it('every fade-in rule skips the tally board', () => {
    // [^{}] keeps the match inside one rule, not from an @media header down into its first rule.
    const fades = [...styles.matchAll(/([^{}]+)\{[^{}]*animation: fade-in/g)].map((m) => m[1].trim());
    expect(fades.length).toBeGreaterThan(0);
    for (const selector of fades) expect(selector).toContain(':not(:has(.tally-bar))');
  });
});

describe('nothing hides off the edge on a desktop', () => {
  it('admin chips and tabs wrap to a new row instead of scrolling out of reach (t126, P9)', () => {
    expect(styles).toMatch(/\.subnav > nav \{ display: flex; flex-wrap: wrap;/);
    expect(styles).not.toMatch(/\.subnav[^{]*\{[^}]*overflow-x: auto/);
  });
});

describe('the tally board never moves', () => {
  it('every button lift or squeeze rule excludes the tally board', () => {
    // Selectors of rules that move a button: a hover lift or a press squeeze.
    const moving = [...styles.matchAll(/([^{}]+)\{[^}]*transform:\s*(?:translateY\(-1px\)|scale\(0\.95\))/g)].map((m) => m[1].trim());
    expect(moving.length).toBeGreaterThan(0);
    for (const selector of moving.filter((sel) => /button/.test(sel))) {
      // The bar, the cards, and the rest of the board page (Finish game sits at its end, P9 T12).
      expect(selector).toMatch(/\.tally-buttons, \.tally-head, \.tally-bar, \.page:has\(\.tally-bar\)\) \*/);
    }
  });

  it('a fold opened on the board does not drop in (the Finish pairings, P9 T12)', () => {
    const drops = [...styles.matchAll(/([^{}]+)\{[^{}]*animation: drop-in/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
    const folds = drops.filter((sel) => sel.startsWith('details'));
    expect(folds.length).toBeGreaterThan(0);
    for (const selector of folds) expect(selector).toContain(':not(:where(.page:has(.tally-bar)) *)');
  });

  it('nothing on the board fades, pills and links included, the bright/dark switch too (t330)', () => {
    expect(styles).toMatch(/\.page:has\(\.tally-bar\) :is\(button, \.button, a, \.pill\) \{ transition: none; \}/);
  });
});

describe('the bright tally board (t330)', () => {
  it('builds the bright tally on light mode, with more contrast', () => {
    expect(tokens).toMatch(/:root\[data-theme='light'\],\s*:root\[data-tally='bright'\]\s*\{/);
    // The last such block: the light block's own selector list ends with the same selector.
    const bright = [...tokens.matchAll(/:root\[data-tally='bright'\] \{([^}]*)\}/g)].pop()?.[1] ?? '';
    expect(bright).toContain('--bg: #ffffff');
    expect(bright).toContain('--fg: #000000');
  });
});

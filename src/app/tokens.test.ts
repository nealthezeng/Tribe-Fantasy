import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// tokens.css is the one place for colours, fonts, sizes and motion; styles.css only reads them.
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

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

  it('every fade-in rule skips the tally board', () => {
    // [^{}] keeps the match inside one rule, not from an @media header down into its first rule.
    const fades = [...styles.matchAll(/([^{}]+)\{[^{}]*animation: fade-in/g)].map((m) => m[1].trim());
    expect(fades.length).toBeGreaterThan(0);
    for (const selector of fades) expect(selector).toContain(':not(:has(.tally-bar))');
  });
});

describe('the tally board never moves', () => {
  it('every button lift or squeeze rule excludes the tally board', () => {
    // Selectors of rules that move a button: a hover lift or a press squeeze.
    const moving = [...styles.matchAll(/([^{}]+)\{[^}]*transform:\s*(?:translateY\(-1px\)|scale\(0\.95\))/g)].map((m) => m[1].trim());
    expect(moving.length).toBeGreaterThan(0);
    for (const selector of moving.filter((sel) => /button/.test(sel))) {
      expect(selector).toMatch(/\.tally-buttons, \.tally-head, \.tally-bar/);
    }
  });
});

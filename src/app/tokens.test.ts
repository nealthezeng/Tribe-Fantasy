import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// tokens.css is the one place for colours, fonts, sizes and motion; styles.css only reads them.
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('styles.css reads every design value from tokens.css', () => {
  it.each([
    ['colour literals', /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi],
    ['raw font sizes or families', /font-(?:size|family):(?!\s*(?:var\(|inherit))[^;]+/g],
    ['raw radii', /border-radius:(?!\s*(?:var\(|0|50%))[^;]+/g],
    ['raw durations', /\b\d+m?s\b/g],
  ])('has no %s', (_name, pattern) => {
    expect(styles.match(pattern) ?? []).toEqual([]);
  });
});

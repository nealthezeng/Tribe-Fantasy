// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import type { CSSProperties } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useInk } from './useInk';

function Nav() {
  const ref = useInk<HTMLElement>('League');
  return (
    <nav ref={ref} style={{ '--ink-x': '10px', '--ink-w': '80px' } as CSSProperties}>
      <a aria-current="page">League</a>
      <span className="ink" />
    </nav>
  );
}
const ink = () => document.querySelector('nav')!.style;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps the marker where it was while the nav is hidden (dock hidden on the tally board)', () => {
  // jsdom lays nothing out: every offsetWidth is 0, like a display: none nav.
  render(<Nav />);
  expect(ink().getPropertyValue('--ink-w')).toBe('80px');
  expect(ink().getPropertyValue('--ink-x')).toBe('10px');
});

it('measures the current tab once the nav is visible', () => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(96);
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockReturnValue(24);
  render(<Nav />);
  expect(ink().getPropertyValue('--ink-w')).toBe('96px');
  expect(ink().getPropertyValue('--ink-x')).toBe('24px');
});

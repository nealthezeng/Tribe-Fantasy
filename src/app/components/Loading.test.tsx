// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Loading } from './Loading';

it('draws a skeleton that screen readers announce as Loading… (t99)', () => {
  render(<Loading />);
  expect(screen.getByRole('status').textContent).toBe('Loading…');
});

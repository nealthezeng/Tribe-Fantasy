import { getConfig } from '@testing-library/react';
import { expect, it } from 'vitest';

it('gives findBy* / waitFor room for a slow first render when every test file starts at once', () => {
  expect(getConfig().asyncUtilTimeout).toBe(10_000);
});

import { describe, expect, it } from 'vitest';

describe('smoke', () => {
  it('arithmetic sanity check - toolchain wired correctly', () => {
    expect(1 + 1).toBe(2);
  });
});

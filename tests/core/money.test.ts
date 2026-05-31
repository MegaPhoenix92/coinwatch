import { describe, expect, it } from 'vitest';
import { formatUnits, toNumberAmount } from '../../src/core/money.js';

describe('formatUnits', () => {
  it('formats a sub-1 fractional value (6 decimals)', () => {
    expect(formatUnits(123456n, 6)).toBe('0.123456');
  });

  it('formats exactly 1 unit (18 decimals)', () => {
    expect(formatUnits(1000000000000000000n, 18)).toBe('1');
  });

  it('formats zero as "0" (8 decimals)', () => {
    expect(formatUnits(0n, 8)).toBe('0');
  });

  it('formats exactly 1 unit (8 decimals)', () => {
    expect(formatUnits(100000000n, 8)).toBe('1');
  });

  it('formats 1.5 and trims trailing zeros (8 decimals)', () => {
    expect(formatUnits(150000000n, 8)).toBe('1.5');
  });

  it('handles zero decimals (integer passthrough)', () => {
    expect(formatUnits(42n, 0)).toBe('42');
  });

  it('handles negative values', () => {
    expect(formatUnits(-150000000n, 8)).toBe('-1.5');
  });

  it('pads leading zeros in the fraction', () => {
    expect(formatUnits(1n, 8)).toBe('0.00000001');
  });
});

describe('toNumberAmount', () => {
  it('converts to a JS number for valuation', () => {
    expect(toNumberAmount(50000000n, 8)).toBe(0.5);
  });

  it('returns 0 for zero raw', () => {
    expect(toNumberAmount(0n, 8)).toBe(0);
  });

  it('converts a negative value', () => {
    expect(toNumberAmount(-150000000n, 8)).toBe(-1.5);
  });
});

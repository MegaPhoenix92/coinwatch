import { describe, expect, it } from 'vitest';
import { assertUtcDateString, toUtcDateString } from '../../src/domain/historical-price.js';

describe('historical price date helpers', () => {
  it('formats Date and epoch inputs with UTC getters only', () => {
    expect(toUtcDateString(new Date('2026-01-01T00:30:00Z'))).toBe('2026-01-01');
    expect(toUtcDateString(Date.UTC(2026, 0, 1, 23, 30, 0))).toBe('2026-01-01');
  });

  it('validates YYYY-MM-DD strings and rejects malformed dates', () => {
    expect(assertUtcDateString('2026-01-01')).toBe('2026-01-01');
    expect(() => assertUtcDateString('01-01-2026')).toThrow(/YYYY-MM-DD/);
    expect(() => assertUtcDateString('2026-02-30')).toThrow(/not a real calendar day/);
    expect(() => toUtcDateString(Number.NaN)).toThrow(/Invalid UTC date input/);
  });
});

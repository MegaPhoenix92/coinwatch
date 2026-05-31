import { describe, expect, it } from 'vitest';
import { assertSendable, toBaseUnits } from '../../src/core/preflight.js';

describe('transfer preflight', () => {
  it('rejects non-positive and dust amounts, accepts a normal amount', () => {
    expect(() => assertSendable({ chain: 'bitcoin', asset: 'BTC', rawAmount: 0n })).toThrow(
      /amount must be positive/i,
    );
    expect(() => assertSendable({ chain: 'bitcoin', asset: 'BTC', rawAmount: 100n })).toThrow(
      /dust/i,
    );
    expect(() =>
      assertSendable({ chain: 'bitcoin', asset: 'BTC', rawAmount: 50_000n }),
    ).not.toThrow();
  });

  it('converts decimal amounts to base units and rejects over-precision', () => {
    expect(toBaseUnits('0.0005', 8)).toBe(50_000n);
    expect(toBaseUnits('1.23', 6)).toBe(1_230_000n);
    expect(() => toBaseUnits('0.000000001', 8)).toThrow(/more than 8 decimal places/);
  });
});

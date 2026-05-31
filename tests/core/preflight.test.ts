import { describe, expect, it } from 'vitest';
import { assertSendable, parseFeeRate, toBaseUnits } from '../../src/core/preflight.js';

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

  it('parses positive-integer fee rates and rejects malformed/zero/negative/huge', () => {
    expect(parseFeeRate('5')).toBe(5n);
    expect(parseFeeRate('21')).toBe(21n);
    // decimals / non-numeric / empty / negative / hex / exponent -> all rejected as non-integer
    expect(() => parseFeeRate('1.5')).toThrow(/positive integer/i);
    expect(() => parseFeeRate('abc')).toThrow(/positive integer/i);
    expect(() => parseFeeRate('')).toThrow(/positive integer/i);
    expect(() => parseFeeRate('-1')).toThrow(/positive integer/i);
    expect(() => parseFeeRate('0x10')).toThrow(/positive integer/i);
    expect(() => parseFeeRate('1e3')).toThrow(/positive integer/i);
    // "" -> 0n path is covered above by the regex; an explicit zero is rejected too
    expect(() => parseFeeRate('0')).toThrow(/greater than zero/i);
    // a valid-but-absurd integer is caught by the sanity cap (selectUTXO would otherwise build a huge-fee PSBT)
    expect(() => parseFeeRate('1000000')).toThrow(/sanity limit/i);
  });
});

import { describe, expect, it } from 'vitest';
import { sumBySymbol } from '../../src/core/portfolio.js';
import type { Balance } from '../../src/domain/types.js';

describe('sumBySymbol', () => {
  it('groups by symbol, sums raw, and sorts by symbol', () => {
    const balances: Balance[] = [
      { chain: 'ethereum', address: '0xaaa', symbol: 'USDC', raw: 1000000n, decimals: 6 },
      { chain: 'base', address: '0xbbb', symbol: 'USDC', raw: 2500000n, decimals: 6 },
      { chain: 'bitcoin', address: 'bc1qxyz', symbol: 'BTC', raw: 50000000n, decimals: 8 },
    ];

    expect(sumBySymbol(balances)).toEqual([
      { symbol: 'BTC', raw: 50000000n, decimals: 8 },
      { symbol: 'USDC', raw: 3500000n, decimals: 6 },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(sumBySymbol([])).toEqual([]);
  });

  it('throws when the same symbol appears with mismatched decimals', () => {
    const balances: Balance[] = [
      { chain: 'ethereum', address: '0xaaa', symbol: 'USDC', raw: 1000000n, decimals: 6 },
      { chain: 'solana', address: 'SoLxyz', symbol: 'USDC', raw: 2000000n, decimals: 9 },
    ];

    expect(() => sumBySymbol(balances)).toThrow(/USDC/);
  });
});

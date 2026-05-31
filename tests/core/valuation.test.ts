import { describe, expect, it } from 'vitest';
import { value } from '../../src/core/valuation.js';
import { assetBySymbol } from '../../src/domain/assets.js';
import type { Balance } from '../../src/domain/types.js';

const lookup = (
  chain: Parameters<typeof assetBySymbol>[0],
  symbol: Parameters<typeof assetBySymbol>[1],
) => assetBySymbol(chain, symbol);

describe('value', () => {
  it('prices balances in USD and aggregates by asset', () => {
    const balances: Balance[] = [
      { chain: 'bitcoin', address: 'bc1qexample', symbol: 'BTC', raw: 50000000n, decimals: 8 },
      { chain: 'ethereum', address: '0xexample', symbol: 'USDC', raw: 100000000n, decimals: 6 },
    ];
    const prices = new Map<string, number>([
      ['bitcoin', 60000],
      ['usd-coin', 1],
    ]);

    const view = value(balances, prices, lookup);

    expect(view.totalUsd).toBe(30100);
    expect(view.byAsset.find((asset) => asset.symbol === 'BTC')).toEqual({
      symbol: 'BTC',
      amount: '0.5',
      usd: 30000,
    });
    expect(view.byAsset.find((asset) => asset.symbol === 'USDC')).toEqual({
      symbol: 'USDC',
      amount: '100',
      usd: 100,
    });
    expect(view.byChain.find((chain) => chain.chain === 'bitcoin')?.usd).toBe(30000);
    expect(view.warnings).toHaveLength(0);
  });

  it('warns and contributes 0 USD when a price is missing', () => {
    const balances: Balance[] = [
      { chain: 'solana', address: 'So1example', symbol: 'SOL', raw: 1000000000n, decimals: 9 },
    ];

    const view = value(balances, new Map<string, number>(), lookup);

    expect(view.totalUsd).toBe(0);
    expect(view.warnings).toContain('no price for SOL on solana');
  });
});

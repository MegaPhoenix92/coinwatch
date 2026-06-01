import { describe, expect, it } from 'vitest';
import {
  categorizeTransactions,
  detectSwapTxids,
  txCategoryRowKey,
} from '../../src/core/tx-category.js';
import type { Tx } from '../../src/domain/types.js';

function tx(partial: Partial<Tx> & Pick<Tx, 'direction'>): Tx {
  return {
    chain: 'ethereum',
    txid: '0xswap',
    symbol: 'ETH',
    raw: 1_000_000_000_000_000_000n,
    decimals: 18,
    confirmed: true,
    ...partial,
  };
}

describe('detectSwapTxids', () => {
  it('flags a txid with opposing in and out rows', () => {
    const swaps = detectSwapTxids([
      tx({ direction: 'in', symbol: 'USDC', raw: 1_000_000n, decimals: 6 }),
      tx({ direction: 'out', symbol: 'ETH' }),
    ]);
    expect(swaps.has('ethereum:0xswap')).toBe(true);
  });

  it('does not flag a single-direction txid', () => {
    const swaps = detectSwapTxids([tx({ direction: 'in' })]);
    expect(swaps.size).toBe(0);
  });

  it('does not flag opposing legs on the same symbol', () => {
    const swaps = detectSwapTxids([
      tx({ direction: 'in', symbol: 'ETH' }),
      tx({ direction: 'out', symbol: 'ETH' }),
    ]);
    expect(swaps.size).toBe(0);
  });
});

describe('categorizeTransactions', () => {
  it('labels counterparty in/out as transfer', () => {
    const [row] = categorizeTransactions([
      tx({ direction: 'in', counterparty: '0xabc' }),
    ]);
    expect(row.category).toBe('transfer');
    expect(row.categorySource).toBe('heuristic');
    expect(row.categoryReason).toBe('counterparty_present');
  });

  it('labels swap legs when in and out share a txid', () => {
    const rows = categorizeTransactions([
      tx({ direction: 'in', symbol: 'USDC', raw: 1_000_000n, decimals: 6 }),
      tx({ direction: 'out', symbol: 'ETH' }),
    ]);
    expect(rows.every((row) => row.category === 'swap')).toBe(true);
  });

  it('labels small native self spends as fee', () => {
    const [row] = categorizeTransactions([
      tx({ direction: 'self', symbol: 'ETH', raw: 100_000_000_000_000n }),
    ]);
    expect(row.category).toBe('fee');
    expect(row.categoryReason).toBe('small_native_self');
  });

  it('labels self without fee shape as transfer', () => {
    const [row] = categorizeTransactions([
      tx({ direction: 'self', symbol: 'ETH', raw: 1_000_000_000_000_000_000n }),
    ]);
    expect(row.category).toBe('transfer');
  });

  it('leaves ambiguous in without counterparty as unknown', () => {
    const [row] = categorizeTransactions([tx({ direction: 'in' })]);
    expect(row.category).toBe('unknown');
    expect(row.categoryReason).toBe('no_counterparty');
  });

  it('allows income only via manual override', () => {
    const rows = categorizeTransactions([tx({ direction: 'in', counterparty: '0xabc' })]);
    expect(rows[0].category).not.toBe('income');
  });

  it('applies manual overrides over heuristics', () => {
    const key = txCategoryRowKey({
      chain: 'ethereum',
      txid: '0xswap',
      symbol: 'ETH',
    });
    const rows = categorizeTransactions(
      [tx({ direction: 'in', counterparty: '0xabc' })],
      new Map([
        [
          key,
          {
            chain: 'ethereum',
            txid: '0xswap',
            symbol: 'ETH',
            category: 'income',
            note: 'staking reward',
          },
        ],
      ]),
    );
    expect(rows[0].category).toBe('income');
    expect(rows[0].categorySource).toBe('manual');
    expect(rows[0].categoryReason).toBe('staking reward');
  });
});
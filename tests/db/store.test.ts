import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { Store } from '../../src/db/store.js';
import type { Tx } from '../../src/domain/types.js';

describe('Store', () => {
  it('round-trips a label via setLabel/getLabel', () => {
    const store = new Store(new Database(':memory:'));
    expect(store.getLabel('bitcoin', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')).toBeUndefined();
    store.setLabel('bitcoin', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'cold wallet');
    expect(store.getLabel('bitcoin', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')).toBe(
      'cold wallet',
    );
    store.close();
  });

  it('upserts a label (replaces existing value)', () => {
    const store = new Store(new Database(':memory:'));
    store.setLabel('ethereum', '0xabc', 'old');
    store.setLabel('ethereum', '0xabc', 'new');
    expect(store.getLabel('ethereum', '0xabc')).toBe('new');
    store.close();
  });

  it('caches txs and returns them with raw as bigint', () => {
    const store = new Store(new Database(':memory:'));
    const txs: Tx[] = [
      {
        chain: 'bitcoin',
        txid: 'aabbcc',
        timestamp: 1717000000,
        direction: 'in',
        symbol: 'BTC',
        raw: 12345678901234567890n,
        decimals: 8,
        counterparty: 'bc1qsender',
        confirmed: true,
      },
    ];
    store.cacheTxs(txs);
    const got = store.getCachedTxs('bitcoin');
    expect(got).toHaveLength(1);
    expect(got[0].txid).toBe('aabbcc');
    expect(got[0].raw).toBe(12345678901234567890n);
    expect(typeof got[0].raw).toBe('bigint');
    expect(got[0].chain).toBe('bitcoin');
    expect(got[0].symbol).toBe('BTC');
    expect(got[0].confirmed).toBe(true);
    store.close();
  });

  it('upserts cached txs on duplicate (chain,txid)', () => {
    const store = new Store(new Database(':memory:'));
    const base: Tx = {
      chain: 'bitcoin',
      txid: 'dup',
      direction: 'out',
      symbol: 'BTC',
      raw: 100n,
      decimals: 8,
      confirmed: false,
    };
    store.cacheTxs([base]);
    store.cacheTxs([{ ...base, raw: 200n, confirmed: true }]);
    const got = store.getCachedTxs('bitcoin');
    expect(got).toHaveLength(1);
    expect(got[0].raw).toBe(200n);
    expect(got[0].confirmed).toBe(true);
    store.close();
  });

  it('filters cached txs by chain', () => {
    const store = new Store(new Database(':memory:'));
    store.cacheTxs([
      {
        chain: 'bitcoin',
        txid: 'b1',
        direction: 'in',
        symbol: 'BTC',
        raw: 1n,
        decimals: 8,
        confirmed: true,
      },
      {
        chain: 'ethereum',
        txid: 'e1',
        direction: 'in',
        symbol: 'ETH',
        raw: 2n,
        decimals: 18,
        confirmed: true,
      },
    ]);
    expect(store.getCachedTxs('bitcoin')).toHaveLength(1);
    expect(store.getCachedTxs('ethereum')).toHaveLength(1);
    expect(store.getCachedTxs('bitcoin')[0].txid).toBe('b1');
    store.close();
  });
});

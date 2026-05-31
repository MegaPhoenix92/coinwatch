import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { ChainAdapter, PriceProvider, ReceiveAddress } from '../../src/adapters/chain-adapter.js';
import { PortfolioService } from '../../src/services/portfolio-service.js';
import { Store } from '../../src/db/store.js';
import type { AccountDescriptor, DerivedAddress } from '../../src/domain/account.js';
import type { ChainFamily } from '../../src/domain/chains.js';
import type { Balance, HistoryOptions, Tx } from '../../src/domain/types.js';

const BTC_ADDR = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

const btcAccount: AccountDescriptor = {
  id: 'acct-btc',
  label: 'Cold BTC',
  family: 'bitcoin',
  chains: ['bitcoin'],
  source: { kind: 'addresses', addresses: [BTC_ADDR] },
};

class FakeBitcoinAdapter implements ChainAdapter {
  readonly family: ChainFamily = 'bitcoin';
  readonly capabilities = { derivesAddresses: false };

  async resolveAddresses(_account: AccountDescriptor): Promise<DerivedAddress[]> {
    return [{ address: BTC_ADDR, chain: 'bitcoin', derived: false }];
  }

  async getReceiveAddress(_account: AccountDescriptor, _index?: number): Promise<ReceiveAddress> {
    return {
      address: BTC_ADDR,
      derived: false,
      note: 'verify on your signing device before use',
    };
  }

  async getBalances(_addresses: DerivedAddress[]): Promise<Balance[]> {
    return [
      { chain: 'bitcoin', address: BTC_ADDR, symbol: 'BTC', raw: 150_000_000n, decimals: 8 },
    ];
  }

  async getHistory(_addresses: DerivedAddress[], _opts?: HistoryOptions): Promise<Tx[]> {
    return [
      {
        chain: 'bitcoin',
        txid: 'deadbeef',
        direction: 'in',
        symbol: 'BTC',
        raw: 150_000_000n,
        decimals: 8,
        confirmed: true,
      },
    ];
  }
}

class FakePriceProvider implements PriceProvider {
  async getUsdPrices(_coingeckoIds: string[]): Promise<Map<string, number>> {
    return new Map<string, number>([['bitcoin', 40_000]]);
  }
}

function service(store?: Store): PortfolioService {
  return new PortfolioService(
    new Map<ChainFamily, ChainAdapter>([['bitcoin', new FakeBitcoinAdapter()]]),
    new FakePriceProvider(),
    store,
  );
}

describe('PortfolioService', () => {
  it('computes totalUsd from balances and prices', async () => {
    const view = await service().getPortfolio([btcAccount]);

    expect(view.totalUsd).toBe(60_000);
    expect(view.byAsset).toHaveLength(1);
    expect(view.byAsset[0].symbol).toBe('BTC');
    expect(view.byAsset[0].usd).toBe(60_000);
    expect(view.byChain).toEqual([{ chain: 'bitcoin', usd: 60_000 }]);
    expect(view.balances).toHaveLength(1);
    expect(view.balances[0].chain).toBe('bitcoin');
    expect(view.balances[0].symbol).toBe('BTC');
    expect(view.balances[0].usd).toBe(60_000);
    expect(view.warnings).toEqual([]);
  });

  it('warns and skips accounts whose family has no adapter', async () => {
    const solAccount: AccountDescriptor = {
      id: 'acct-sol',
      label: 'SOL',
      family: 'solana',
      chains: ['solana'],
      source: { kind: 'addresses', addresses: ['So11111111111111111111111111111111111111112'] },
    };

    const view = await service().getPortfolio([btcAccount, solAccount]);

    expect(view.totalUsd).toBe(60_000);
    expect(view.warnings).toEqual(['No adapter for account acct-sol (family solana); skipped']);
  });

  it('lists derived addresses across accounts', async () => {
    const addrs = await service().listAddresses([btcAccount]);
    expect(addrs).toEqual([{ address: BTC_ADDR, chain: 'bitcoin', derived: false }]);
  });

  it('returns a receive address with the verification note', async () => {
    const recv = await service().getReceiveAddress([btcAccount], 'acct-btc');
    expect(recv.address).toBe(BTC_ADDR);
    expect(recv.note).toContain('verify on your signing device before use');
  });

  it('throws when receive-address account id is unknown', async () => {
    await expect(service().getReceiveAddress([btcAccount], 'nope')).rejects.toThrow(
      'Account not found: nope',
    );
  });

  it('concatenates history, respects limit, and writes through to Store when injected', async () => {
    const store = new Store(new Database(':memory:'));
    const svc = service(store);

    const all = await svc.getHistory([btcAccount]);
    expect(all).toHaveLength(1);
    expect(all[0].txid).toBe('deadbeef');
    expect(store.getCachedTxs('bitcoin')).toHaveLength(1);

    const limited = await svc.getHistory([btcAccount], { limit: 0 });
    expect(limited).toHaveLength(0);

    store.close();
  });
});

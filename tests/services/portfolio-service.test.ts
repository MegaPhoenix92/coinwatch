import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { ChainAdapter, PriceProvider, ReceiveAddress } from '../../src/adapters/chain-adapter.js';
import { PortfolioService } from '../../src/services/portfolio-service.js';
import { Store } from '../../src/db/store.js';
import type { AccountDescriptor, DerivedAddress } from '../../src/domain/account.js';
import type { ChainFamily } from '../../src/domain/chains.js';
import type { ChainAdapterTransferParams, UnsignedArtifact } from '../../src/domain/transfer.js';
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
  readonly capabilities = { derivesAddresses: false, preparesTransfers: false };

  constructor(
    private readonly opts: {
      failAccountId?: string;
      pendingRaw?: bigint;
    } = {},
  ) {}

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
    if (this.opts.failAccountId === 'acct-fail') {
      throw new Error('fixture provider unavailable');
    }

    const balance: Balance & { pendingRaw: bigint } = {
      chain: 'bitcoin',
      address: BTC_ADDR,
      symbol: 'BTC',
      raw: 150_000_000n,
      decimals: 8,
      pendingRaw: this.opts.pendingRaw ?? 0n,
    };
    return [balance];
  }

  historyCalls = 0;

  async getHistory(_addresses: DerivedAddress[], _opts?: HistoryOptions): Promise<Tx[]> {
    this.historyCalls += 1;
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

  async buildUnsignedTransfer(_params: ChainAdapterTransferParams): Promise<UnsignedArtifact> {
    throw new Error('buildUnsignedTransfer not implemented for this chain yet');
  }
}

class FakePriceProvider implements PriceProvider {
  constructor(private readonly shouldFail = false) {}

  async getUsdPrices(_coingeckoIds: string[]): Promise<Map<string, number>> {
    if (this.shouldFail) {
      throw new Error('fixture price provider unavailable');
    }
    return new Map<string, number>([['bitcoin', 40_000]]);
  }
}

function service(store?: Store, priceProvider: PriceProvider = new FakePriceProvider()): PortfolioService {
  return new PortfolioService(
    new Map<ChainFamily, ChainAdapter>([['bitcoin', new FakeBitcoinAdapter()]]),
    priceProvider,
    store,
  );
}

function serviceWithAdapter(adapter: ChainAdapter, priceProvider: PriceProvider = new FakePriceProvider()) {
  return new PortfolioService(new Map<ChainFamily, ChainAdapter>([['bitcoin', adapter]]), priceProvider);
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

  it('keeps the rest of the portfolio when one adapter call fails', async () => {
    const failAccount: AccountDescriptor = { ...btcAccount, id: 'acct-fail' };
    const resilientAdapter = new (class extends FakeBitcoinAdapter {
      override async resolveAddresses(account: AccountDescriptor): Promise<DerivedAddress[]> {
        return [
          {
            address: account.id === 'acct-fail' ? 'bc1qfailedaddressxxxxxxxxxxxxxxxxxxxxxx' : BTC_ADDR,
            chain: 'bitcoin',
            derived: false,
          },
        ];
      }

      override async getBalances(addresses: DerivedAddress[]): Promise<Balance[]> {
        if (addresses[0]?.address.startsWith('bc1qfailed')) {
          throw new Error('fixture provider unavailable');
        }
        return super.getBalances(addresses);
      }
    })();

    const view = await serviceWithAdapter(resilientAdapter).getPortfolio([btcAccount, failAccount]);

    expect(view.totalUsd).toBe(60_000);
    expect(view.balances).toHaveLength(1);
    expect(view.warnings).toContain(
      'Failed to load account acct-fail (bitcoin): fixture provider unavailable',
    );
  });

  it('returns a degraded portfolio with warnings when price loading fails', async () => {
    const view = await service(undefined, new FakePriceProvider(true)).getPortfolio([btcAccount]);

    expect(view.totalUsd).toBe(0);
    expect(view.balances).toHaveLength(1);
    expect(view.byAsset).toEqual([{ symbol: 'BTC', amount: '1.5', usd: 0 }]);
    expect(view.warnings).toContain('Failed to load prices: fixture price provider unavailable');
    expect(view.warnings).toContain('no price for BTC on bitcoin');
  });

  it('surfaces pending balances from adapter results as warnings', async () => {
    const view = await serviceWithAdapter(new FakeBitcoinAdapter({ pendingRaw: 5000n })).getPortfolio([
      btcAccount,
    ]);

    expect(view.totalUsd).toBe(60_000);
    expect(view.warnings).toContain(
      `Pending BTC balance for ${BTC_ADDR} on bitcoin: 5000 raw units`,
    );
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

  it('always refetches history from the provider when tx_cache already has rows (decision #49)', async () => {
    const store = new Store(new Database(':memory:'));
    await store.cacheTxs([
      {
        chain: 'bitcoin',
        txid: 'stale-only',
        direction: 'out',
        symbol: 'BTC',
        raw: 1n,
        decimals: 8,
        confirmed: true,
      },
    ]);
    const adapter = new FakeBitcoinAdapter();
    const svc = new PortfolioService(
      new Map<ChainFamily, ChainAdapter>([['bitcoin', adapter]]),
      new FakePriceProvider(),
      store,
    );

    const first = await svc.getHistory([btcAccount]);
    expect(adapter.historyCalls).toBe(1);
    expect(first.map((tx) => tx.txid)).toEqual(['deadbeef']);
    expect(await store.getCachedTxs('bitcoin').then((rows) => rows.map((t) => t.txid).sort())).toEqual([
      'deadbeef',
      'stale-only',
    ]);

    await svc.getHistory([btcAccount]);
    expect(adapter.historyCalls).toBe(2);
    await store.close();
  });

  it('concatenates history, respects limit, and writes through to Store when injected', async () => {
    const store = new Store(new Database(':memory:'));
    const svc = service(store);

    const all = await svc.getHistory([btcAccount]);
    expect(all).toHaveLength(1);
    expect(all[0].txid).toBe('deadbeef');
    expect(await store.getCachedTxs('bitcoin')).toHaveLength(1);

    const limited = await svc.getHistory([btcAccount], { limit: 0 });
    expect(limited).toHaveLength(0);

    await store.close();
  });

  it('globally orders, dedupes, and limits merged cross-chain history', async () => {
    class HistoryAdapter implements ChainAdapter {
      readonly capabilities = { derivesAddresses: false, preparesTransfers: false };

      constructor(
        readonly family: ChainFamily,
        private readonly chain: Tx['chain'],
        private readonly txsByAddress: Map<string, Tx[]>,
      ) {}

      async resolveAddresses(account: AccountDescriptor): Promise<DerivedAddress[]> {
        if (account.source.kind !== 'addresses') {
          return [];
        }
        return account.source.addresses.map((address) => ({
          address,
          chain: this.chain,
          derived: false,
        }));
      }

      async getReceiveAddress(_account: AccountDescriptor): Promise<ReceiveAddress> {
        return {
          address: 'unused',
          derived: false,
          note: 'verify on your signing device before use',
        };
      }

      async getBalances(_addresses: DerivedAddress[]): Promise<Balance[]> {
        return [];
      }

      async getHistory(addresses: DerivedAddress[]): Promise<Tx[]> {
        return addresses.flatMap((address) => this.txsByAddress.get(address.address) ?? []);
      }

      async buildUnsignedTransfer(_params: ChainAdapterTransferParams): Promise<UnsignedArtifact> {
        throw new Error('buildUnsignedTransfer not implemented for this chain yet');
      }
    }

    const tx = (chain: Tx['chain'], txid: string, timestamp: number | undefined): Tx => ({
      chain,
      txid,
      timestamp,
      direction: 'in',
      symbol: chain === 'bitcoin' ? 'BTC' : chain === 'solana' ? 'SOL' : 'ETH',
      raw: 1n,
      decimals: chain === 'bitcoin' ? 8 : chain === 'solana' ? 9 : 18,
      confirmed: true,
    });

    const btcOld = tx('bitcoin', 'btc-old', 100);
    const btcNewest = tx('bitcoin', 'btc-newest', 500);
    const duplicate = tx('ethereum', 'evm-dupe', 400);
    const evmMiddle = tx('ethereum', 'evm-middle', 300);
    const solUnconfirmed = tx('solana', 'sol-unconfirmed', undefined);
    const solRecent = tx('solana', 'sol-recent', 450);

    const btcOne: AccountDescriptor = {
      id: 'btc-one',
      label: 'BTC one',
      family: 'bitcoin',
      chains: ['bitcoin'],
      source: { kind: 'addresses', addresses: ['btc-one'] },
    };
    const btcTwo: AccountDescriptor = {
      id: 'btc-two',
      label: 'BTC two',
      family: 'bitcoin',
      chains: ['bitcoin'],
      source: { kind: 'addresses', addresses: ['btc-two'] },
    };
    const evmOne: AccountDescriptor = {
      id: 'evm-one',
      label: 'EVM one',
      family: 'evm',
      chains: ['ethereum'],
      source: { kind: 'addresses', addresses: ['evm-one'] },
    };
    const evmTwo: AccountDescriptor = {
      id: 'evm-two',
      label: 'EVM two',
      family: 'evm',
      chains: ['ethereum'],
      source: { kind: 'addresses', addresses: ['evm-two'] },
    };
    const solOne: AccountDescriptor = {
      id: 'sol-one',
      label: 'SOL one',
      family: 'solana',
      chains: ['solana'],
      source: { kind: 'addresses', addresses: ['sol-one'] },
    };

    const svc = new PortfolioService(
      new Map<ChainFamily, ChainAdapter>([
        [
          'bitcoin',
          new HistoryAdapter(
            'bitcoin',
            'bitcoin',
            new Map([
              ['btc-one', [btcOld]],
              ['btc-two', [btcNewest]],
            ]),
          ),
        ],
        [
          'evm',
          new HistoryAdapter(
            'evm',
            'ethereum',
            new Map([
              ['evm-one', [duplicate, evmMiddle]],
              ['evm-two', [{ ...duplicate, raw: 2n }]],
            ]),
          ),
        ],
        ['solana', new HistoryAdapter('solana', 'solana', new Map([['sol-one', [solRecent, solUnconfirmed]]]))],
      ]),
      new FakePriceProvider(),
    );

    const all = await svc.getHistory([btcOne, evmOne, solOne, btcTwo, evmTwo]);
    expect(all.map((candidate) => `${candidate.chain}:${candidate.txid}`)).toEqual([
      'solana:sol-unconfirmed',
      'bitcoin:btc-newest',
      'solana:sol-recent',
      'ethereum:evm-dupe',
      'ethereum:evm-middle',
      'bitcoin:btc-old',
    ]);
    expect(new Set(all.map((candidate) => `${candidate.chain}:${candidate.txid}`)).size).toBe(
      all.length,
    );

    const limited = await svc.getHistory([btcOne, evmOne, solOne, btcTwo, evmTwo], { limit: 3 });
    expect(limited.map((candidate) => `${candidate.chain}:${candidate.txid}`)).toEqual([
      'solana:sol-unconfirmed',
      'bitcoin:btc-newest',
      'solana:sol-recent',
    ]);
  });

  it('keeps history from other accounts when one adapter getHistory fails', async () => {
    const failAccount: AccountDescriptor = { ...btcAccount, id: 'acct-fail' };
    const flakyAdapter = new (class extends FakeBitcoinAdapter {
      override async resolveAddresses(account: AccountDescriptor): Promise<DerivedAddress[]> {
        return [
          {
            address: account.id === 'acct-fail' ? 'bc1qfailedaddressxxxxxxxxxxxxxxxxxxxxxx' : BTC_ADDR,
            chain: 'bitcoin',
            derived: false,
          },
        ];
      }

      override async getHistory(addresses: DerivedAddress[], opts?: HistoryOptions): Promise<Tx[]> {
        if (addresses[0]?.address.startsWith('bc1qfailed')) {
          throw new Error('fixture provider unavailable');
        }
        return super.getHistory(addresses, opts);
      }
    })();

    const txs = await serviceWithAdapter(flakyAdapter).getHistory([btcAccount, failAccount]);

    expect(txs).toHaveLength(1);
    expect(txs[0].txid).toBe('deadbeef');
  });
});

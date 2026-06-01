import { describe, expect, it } from 'vitest';
import type { HistoricalPriceProvider } from '../../src/adapters/chain-adapter.js';
import type { AccountDescriptor } from '../../src/domain/account.js';
import type { HistoricalUsdPrice, UtcDateString } from '../../src/domain/historical-price.js';
import type { Tx } from '../../src/domain/types.js';
import { computeAccountScopedPnl } from '../../src/reporting/pnl-report.js';
import type { PortfolioService } from '../../src/services/portfolio-service.js';

const utc = (value: string) => value as UtcDateString;
const seconds = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);

const accountA: AccountDescriptor = {
  id: 'acct-a',
  label: 'A',
  family: 'bitcoin',
  chains: ['bitcoin'],
  source: { kind: 'addresses', addresses: ['bc1qshared'] },
};

const accountB: AccountDescriptor = {
  id: 'acct-b',
  label: 'B',
  family: 'bitcoin',
  chains: ['bitcoin'],
  source: { kind: 'addresses', addresses: ['bc1qshared'] },
};

function btcTx(txid: string, date: string, direction: Tx['direction'], raw: bigint): Tx {
  return {
    chain: 'bitcoin',
    txid,
    timestamp: seconds(date),
    direction,
    symbol: 'BTC',
    raw,
    decimals: 8,
    confirmed: true,
  };
}

class FakeHistoricalPriceProvider implements HistoricalPriceProvider {
  calls: string[] = [];

  async getHistoricalUsdPrice(
    coingeckoId: string,
    date: UtcDateString,
  ): Promise<HistoricalUsdPrice | undefined> {
    this.calls.push(`${coingeckoId}:${date}`);
    const prices = new Map([
      ['bitcoin:2026-01-01', 10_000],
      ['bitcoin:2026-02-01', 20_000],
      ['bitcoin:2026-03-01', 20_000],
      ['bitcoin:2026-03-15', 30_000],
      ['bitcoin:2026-04-01', 30_000],
    ]);
    const usd = prices.get(`${coingeckoId}:${date}`);
    return usd === undefined ? undefined : { usd, source: 'coingecko', date };
  }
}

describe('computeAccountScopedPnl', () => {
  it('calls getHistory once per account, preserves accountId mapping, filters realized rows by date, and warns on duplicate addresses plus limits', async () => {
    const calls: Array<{ accounts: string[]; limit?: number }> = [];
    const histories = new Map<string, Tx[]>([
      [
        'acct-a',
        [
          btcTx('buy-jan', '2026-01-01', 'in', 200_000_000n),
          btcTx('sell-mar', '2026-03-01', 'out', 100_000_000n),
          btcTx('sell-apr', '2026-04-01', 'out', 50_000_000n),
        ],
      ],
      ['acct-b', [btcTx('buy-b', '2026-01-01', 'in', 25_000_000n)]],
    ]);
    const service = {
      getHistory: async (accounts: AccountDescriptor[], opts?: { limit?: number }) => {
        calls.push({ accounts: accounts.map((account) => account.id), limit: opts?.limit });
        return histories.get(accounts[0].id) ?? [];
      },
    } as unknown as PortfolioService;

    const report = await computeAccountScopedPnl(service, [accountA, accountB], {
      priceProvider: new FakeHistoricalPriceProvider(),
      currentUsdPrice: (id) => (id === 'bitcoin' ? 40_000 : undefined),
      from: utc('2026-04-01'),
      to: utc('2026-04-30'),
      limit: 10,
    });

    expect(calls).toEqual([
      { accounts: ['acct-a'], limit: 10 },
      { accounts: ['acct-b'], limit: 10 },
    ]);
    expect(report.realizedRows).toHaveLength(1);
    expect(report.realizedRows[0]).toMatchObject({
      accountId: 'acct-a',
      disposalTxid: 'sell-apr',
      basisUsd: 5_000,
      proceedsUsd: 15_000,
      gainUsd: 10_000,
    });
    expect(report.openLots.map((lot) => lot.accountId).sort()).toEqual(['acct-a', 'acct-b']);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('duplicate_account_address:acct-b:'),
        expect.stringContaining('history_limited:all: limit 10'),
      ]),
    );
  });

  it('reconciles opening lots plus basis overrides without historical lookup for declared basis', async () => {
    const provider = new FakeHistoricalPriceProvider();
    const service = {
      getHistory: async () => [
        btcTx('visible-buy', '2026-02-01', 'in', 100_000_000n),
        btcTx('visible-sell', '2026-03-15', 'out', 150_000_000n),
      ],
    } as unknown as PortfolioService;

    const report = await computeAccountScopedPnl(service, [accountA], {
      priceProvider: provider,
      currentUsdPrice: (id) => (id === 'bitcoin' ? 40_000 : undefined),
      openingBalances: {
        openingLots: [
          {
            id: 'prehistory-btc',
            accountId: 'acct-a',
            chain: 'bitcoin',
            symbol: 'BTC',
            rawAmount: 100_000_000n,
            decimals: 8,
            acquiredDate: utc('2026-01-01'),
            totalBasisUsd: 10_000,
          },
        ],
        adjustments: [
          {
            type: 'basis_override',
            accountId: 'acct-a',
            chain: 'bitcoin',
            symbol: 'BTC',
            txid: 'visible-buy',
            totalBasisUsd: 20_000,
          },
        ],
      },
    });

    expect(provider.calls).toEqual(['bitcoin:2026-03-15']);
    expect(report.warnings).toEqual([]);
    expect(report.realizedRows).toHaveLength(1);
    expect(report.realizedRows[0]).toMatchObject({
      disposalTxid: 'visible-sell',
      proceedsUsd: 45_000,
      basisUsd: 20_000,
      gainUsd: 25_000,
    });
    expect(report.realizedRows[0].consumedLots.map((lot) => lot.source)).toEqual([
      'manual',
      'chain',
    ]);
    expect(report.openLots[0]).toMatchObject({
      acquisitionTxid: 'visible-buy',
      rawAmount: 50_000_000n,
      source: 'chain',
      unitBasisUsd: 20_000,
    });
  });

  it('warns when opening balances overlap visible history and overrides do not match', async () => {
    const service = {
      getHistory: async () => [btcTx('visible-buy', '2026-02-01', 'in', 100_000_000n)],
    } as unknown as PortfolioService;

    const report = await computeAccountScopedPnl(service, [accountA], {
      priceProvider: new FakeHistoricalPriceProvider(),
      currentUsdPrice: (id) => (id === 'bitcoin' ? 40_000 : undefined),
      openingBalances: {
        openingLots: [
          {
            id: 'too-late',
            accountId: 'acct-a',
            chain: 'bitcoin',
            symbol: 'BTC',
            rawAmount: 50_000_000n,
            decimals: 8,
            acquiredDate: utc('2026-02-01'),
            totalBasisUsd: 5_000,
          },
        ],
        adjustments: [
          {
            type: 'basis_override',
            accountId: 'acct-a',
            chain: 'bitcoin',
            symbol: 'BTC',
            txid: 'missing-tx',
            totalBasisUsd: 10_000,
          },
        ],
      },
    });

    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('opening_balance_overlap:too-late'),
        expect.stringContaining('basis_override_no_match:missing-tx'),
      ]),
    );
  });
});

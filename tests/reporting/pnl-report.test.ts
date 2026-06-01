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
  async getHistoricalUsdPrice(
    coingeckoId: string,
    date: UtcDateString,
  ): Promise<HistoricalUsdPrice | undefined> {
    const prices = new Map([
      ['bitcoin:2026-01-01', 10_000],
      ['bitcoin:2026-03-01', 20_000],
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
});

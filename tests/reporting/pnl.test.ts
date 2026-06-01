import { describe, expect, it } from 'vitest';
import type { HistoricalPriceProvider } from '../../src/adapters/chain-adapter.js';
import {
  HistoricalPriceCapabilityError,
  assertUtcDateString,
  type UtcDateString,
} from '../../src/domain/historical-price.js';
import type { Tx } from '../../src/domain/types.js';
import {
  computePnl,
  txToPnlEvents,
  type PnlEvent,
} from '../../src/reporting/pnl.js';

const JAN_1 = assertUtcDateString('2026-01-01');
const FEB_1 = assertUtcDateString('2026-02-01');
const MAR_1 = assertUtcDateString('2026-03-01');
const APR_1 = assertUtcDateString('2026-04-01');
const BTC = 100_000_000n;

class FakeHistoricalPriceProvider implements HistoricalPriceProvider {
  calls = 0;

  constructor(
    private readonly prices: Map<string, number>,
    private readonly capabilityFailures = new Set<string>(),
  ) {}

  async getHistoricalUsdPrice(coingeckoId: string, date: UtcDateString) {
    this.calls += 1;
    const key = `${coingeckoId}:${date}`;
    if (this.capabilityFailures.has(key)) {
      throw new HistoricalPriceCapabilityError(`cannot price ${key}`);
    }
    const usd = this.prices.get(key);
    return usd === undefined ? undefined : { usd, source: 'coingecko' as const, date };
  }
}

function priceProvider(
  entries: [string, UtcDateString, number][],
  failures: [string, UtcDateString][] = [],
) {
  return new FakeHistoricalPriceProvider(
    new Map(entries.map(([id, date, usd]) => [`${id}:${date}`, usd])),
    new Set(failures.map(([id, date]) => `${id}:${date}`)),
  );
}

function event(overrides: Partial<PnlEvent> & Pick<PnlEvent, 'accountId' | 'direction' | 'rawAmount' | 'date' | 'txid'>): PnlEvent {
  return {
    chain: 'bitcoin',
    symbol: 'BTC',
    decimals: 8,
    ...overrides,
  };
}

describe('computePnl', () => {
  it('computes the gold FIFO cost-basis example with account-scoped self-transfer lots', async () => {
    const provider = priceProvider([
      ['bitcoin', JAN_1, 10_000],
      ['bitcoin', FEB_1, 20_000],
      ['bitcoin', MAR_1, 30_000],
    ]);

    const report = await computePnl(
      [
        event({ accountId: 'A', direction: 'in', rawAmount: 1n * BTC, date: JAN_1, txid: 'buy-1' }),
        event({ accountId: 'A', direction: 'in', rawAmount: 2n * BTC, date: FEB_1, txid: 'buy-2' }),
        event({ accountId: 'A', direction: 'out', rawAmount: 150_000_000n, date: MAR_1, txid: 'sell-1' }),
        event({
          accountId: 'A',
          direction: 'self',
          selfTransferLeg: 'out',
          rawAmount: 50_000_000n,
          date: APR_1,
          txid: 'move-1',
        }),
        event({
          accountId: 'B',
          direction: 'self',
          selfTransferLeg: 'in',
          rawAmount: 50_000_000n,
          date: APR_1,
          txid: 'move-1',
        }),
      ],
      {
        priceProvider: provider,
        currentUsdPrice: (id) => (id === 'bitcoin' ? 40_000 : undefined),
      },
    );

    expect(report.method).toBe('FIFO');
    expect(report.warnings).toEqual([]);
    expect(report.realizedRows).toHaveLength(1);
    expect(report.realizedRows[0]).toMatchObject({
      accountId: 'A',
      date: MAR_1,
      qty: 1.5,
      proceedsUsd: 45_000,
      basisUsd: 20_000,
      gainUsd: 25_000,
      disposalTxid: 'sell-1',
    });
    expect(report.realizedRows[0].consumedLots).toEqual([
      {
        lotId: 'A:buy-1:0',
        acquiredDate: JAN_1,
        acquisitionTxid: 'buy-1',
        rawAmount: 100_000_000n,
        basisUsd: 10_000,
        source: 'chain',
      },
      {
        lotId: 'A:buy-2:1',
        acquiredDate: FEB_1,
        acquisitionTxid: 'buy-2',
        rawAmount: 50_000_000n,
        basisUsd: 10_000,
        source: 'chain',
      },
    ]);

    expect(report.openLots.map((lot) => ({
      accountId: lot.accountId,
      rawAmount: lot.rawAmount,
      unitBasisUsd: lot.unitBasisUsd,
      acquiredDate: lot.acquiredDate,
    }))).toEqual([
      { accountId: 'A', rawAmount: 100_000_000n, unitBasisUsd: 20_000, acquiredDate: FEB_1 },
      { accountId: 'B', rawAmount: 50_000_000n, unitBasisUsd: 20_000, acquiredDate: FEB_1 },
    ]);
    expect(report.aggregateTotals).toMatchObject({
      proceedsUsd: 45_000,
      basisUsd: 20_000,
      realizedGainUsd: 25_000,
      openBasisUsd: 30_000,
      openMarketValueUsd: 60_000,
      unrealizedGainUsd: 30_000,
    });
    expect(report.totalsByAccount.find((row) => row.accountId === 'A')).toMatchObject({
      realizedGainUsd: 25_000,
      unrealizedGainUsd: 20_000,
    });
    expect(report.totalsByAccount.find((row) => row.accountId === 'B')).toMatchObject({
      realizedGainUsd: 0,
      unrealizedGainUsd: 10_000,
    });
  });

  it('consumes older moved lots before newer destination lots after a self-transfer', async () => {
    const report = await computePnl(
      [
        event({ accountId: 'A', direction: 'in', rawAmount: 50_000_000n, date: JAN_1, txid: 'a-old' }),
        event({ accountId: 'B', direction: 'in', rawAmount: 25_000_000n, date: FEB_1, txid: 'b-newer' }),
        event({
          accountId: 'A',
          direction: 'self',
          selfTransferLeg: 'out',
          rawAmount: 50_000_000n,
          date: MAR_1,
          txid: 'move-old',
        }),
        event({
          accountId: 'B',
          direction: 'self',
          selfTransferLeg: 'in',
          rawAmount: 50_000_000n,
          date: MAR_1,
          txid: 'move-old',
        }),
        event({ accountId: 'B', direction: 'out', rawAmount: 50_000_000n, date: APR_1, txid: 'b-sell' }),
      ],
      {
        priceProvider: priceProvider([
          ['bitcoin', JAN_1, 10_000],
          ['bitcoin', FEB_1, 20_000],
          ['bitcoin', APR_1, 30_000],
        ]),
        currentUsdPrice: () => 40_000,
      },
    );

    expect(report.warnings).toEqual([]);
    expect(report.realizedRows).toHaveLength(1);
    expect(report.realizedRows[0]).toMatchObject({
      accountId: 'B',
      proceedsUsd: 15_000,
      basisUsd: 5_000,
      gainUsd: 10_000,
      disposalTxid: 'b-sell',
    });
    expect(report.realizedRows[0].consumedLots).toEqual([
      {
        lotId: 'A:a-old:0->B:move-old',
        acquiredDate: JAN_1,
        acquisitionTxid: 'a-old',
        rawAmount: 50_000_000n,
        basisUsd: 5_000,
        source: 'chain',
      },
    ]);
  });

  it('pairs self-transfers with different raw amounts when out/in legs are explicit', async () => {
    const report = await computePnl(
      [
        event({ accountId: 'A', direction: 'in', rawAmount: 50_000_000n, date: JAN_1, txid: 'a-buy' }),
        event({
          accountId: 'A',
          direction: 'self',
          selfTransferLeg: 'out',
          rawAmount: 50_000_000n,
          date: MAR_1,
          txid: 'fee-move',
        }),
        event({
          accountId: 'B',
          direction: 'self',
          selfTransferLeg: 'in',
          rawAmount: 49_500_000n,
          date: MAR_1,
          txid: 'fee-move',
        }),
        event({ accountId: 'B', direction: 'out', rawAmount: 49_500_000n, date: APR_1, txid: 'b-sell' }),
      ],
      {
        priceProvider: priceProvider([
          ['bitcoin', JAN_1, 10_000],
          ['bitcoin', APR_1, 30_000],
        ]),
        currentUsdPrice: () => 40_000,
      },
    );

    expect(report.warnings).toEqual([]);
    expect(report.realizedRows[0]).toMatchObject({
      accountId: 'B',
      basisUsd: 4_950,
      disposalTxid: 'b-sell',
    });
  });

  it('refuses self-transfer moves when the source ledger had an excluded acquisition', async () => {
    const report = await computePnl(
      [
        event({ accountId: 'A', direction: 'in', rawAmount: 50_000_000n, date: undefined, txid: 'a-undated' }),
        event({ accountId: 'B', direction: 'in', rawAmount: 50_000_000n, date: JAN_1, txid: 'b-balance' }),
        event({
          accountId: 'A',
          direction: 'self',
          selfTransferLeg: 'out',
          rawAmount: 50_000_000n,
          date: MAR_1,
          txid: 'bad-move',
        }),
        event({
          accountId: 'B',
          direction: 'self',
          selfTransferLeg: 'in',
          rawAmount: 50_000_000n,
          date: MAR_1,
          txid: 'bad-move',
        }),
      ],
      {
        priceProvider: priceProvider([['bitcoin', JAN_1, 20_000]]),
        currentUsdPrice: () => 40_000,
      },
    );

    expect(report.warnings.join('\n')).toMatch(/undated:a-undated/);
    expect(report.warnings.join('\n')).toMatch(/unpaired_self_transfer:bad-move: source ledger has excluded events/);
    expect(report.openLots).toHaveLength(1);
    expect(report.openLots[0]).toMatchObject({
      accountId: 'B',
      acquisitionTxid: 'b-balance',
      rawAmount: 50_000_000n,
    });
  });

  it('excludes undated, unknown, unpriceable, and unpaired self events with warnings', async () => {
    const provider = priceProvider([], [['bitcoin', FEB_1]]);

    const report = await computePnl(
      [
        event({ accountId: 'A', direction: 'in', rawAmount: BTC, date: undefined, txid: 'undated' }),
        event({ accountId: 'A', direction: 'unknown', rawAmount: BTC, date: JAN_1, txid: 'unknown' }),
        event({ accountId: 'A', direction: 'in', rawAmount: BTC, date: JAN_1, txid: 'missing-price' }),
        event({ accountId: 'A', direction: 'in', rawAmount: BTC, date: FEB_1, txid: 'capability' }),
        event({ accountId: 'A', direction: 'self', rawAmount: BTC, date: MAR_1, txid: 'lonely-self' }),
      ],
      {
        priceProvider: provider,
        currentUsdPrice: () => 40_000,
      },
    );

    expect(report.realizedRows).toEqual([]);
    expect(report.openLots).toEqual([]);
    expect(report.warnings.join('\n')).toMatch(/undated:undated/);
    expect(report.warnings.join('\n')).toMatch(/unknown:unknown/);
    expect(report.warnings.join('\n')).toMatch(/unpriceable:missing-price/);
    expect(report.warnings.join('\n')).toMatch(/unpriceable:capability/);
    expect(report.warnings.join('\n')).toMatch(/unpaired_self_transfer:lonely-self/);
  });

  it('does not globally pool lots across accounts', async () => {
    const report = await computePnl(
      [
        event({ accountId: 'B', direction: 'in', rawAmount: BTC, date: JAN_1, txid: 'b-buy' }),
        event({ accountId: 'A', direction: 'out', rawAmount: BTC, date: FEB_1, txid: 'a-sell' }),
      ],
      {
        priceProvider: priceProvider([
          ['bitcoin', JAN_1, 10_000],
          ['bitcoin', FEB_1, 20_000],
        ]),
        currentUsdPrice: () => 30_000,
      },
    );

    expect(report.realizedRows).toEqual([]);
    expect(report.openLots).toHaveLength(1);
    expect(report.openLots[0].accountId).toBe('B');
    expect(report.warnings.join('\n')).toMatch(/insufficient_lots:a-sell/);
  });

  it('uses declared inbound basis without calling the historical price provider and marks lots manual', async () => {
    const provider = priceProvider([['bitcoin', MAR_1, 30_000]]);

    const report = await computePnl(
      [
        event({
          accountId: 'A',
          direction: 'in',
          rawAmount: BTC,
          date: JAN_1,
          txid: 'manual-basis',
          declaredUnitBasisUsd: 10_000,
        }),
        event({ accountId: 'A', direction: 'out', rawAmount: 50_000_000n, date: MAR_1, txid: 'sell' }),
      ],
      {
        priceProvider: provider,
        currentUsdPrice: () => 40_000,
      },
    );

    expect(provider.calls).toBe(1);
    expect(report.realizedRows[0]).toMatchObject({
      proceedsUsd: 15_000,
      basisUsd: 5_000,
      gainUsd: 10_000,
    });
    expect(report.realizedRows[0].consumedLots[0]).toMatchObject({
      acquisitionTxid: 'manual-basis',
      source: 'manual',
    });
    expect(report.openLots[0]).toMatchObject({
      acquisitionTxid: 'manual-basis',
      source: 'manual',
      unitBasisUsd: 10_000,
    });
  });
});

describe('txToPnlEvents', () => {
  it('maps Tx timestamps from Unix seconds to UTC dates', () => {
    const txs: Tx[] = [
      {
        chain: 'bitcoin',
        txid: 'seconds-tx',
        timestamp: 1_700_000_000,
        direction: 'in',
        symbol: 'BTC',
        raw: 123n,
        decimals: 8,
        confirmed: true,
      },
    ];

    expect(txToPnlEvents(txs, 'acct')).toEqual([
      {
        accountId: 'acct',
        chain: 'bitcoin',
        symbol: 'BTC',
        direction: 'in',
        rawAmount: 123n,
        decimals: 8,
        date: assertUtcDateString('2023-11-14'),
        txid: 'seconds-tx',
      },
    ]);
  });

  it('carries selfTransferLeg from Tx into PnlEvent', () => {
    const txs: Tx[] = [
      {
        chain: 'bitcoin',
        txid: 'self-tx',
        timestamp: 1_700_000_000,
        direction: 'self',
        selfTransferLeg: 'out',
        symbol: 'BTC',
        raw: 50_000_000n,
        decimals: 8,
        confirmed: true,
      },
    ];

    expect(txToPnlEvents(txs, 'acct')[0]).toMatchObject({
      selfTransferLeg: 'out',
    });
  });
});

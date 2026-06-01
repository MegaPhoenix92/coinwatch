import { describe, expect, it } from 'vitest';
import type { UtcDateString } from '../../src/domain/historical-price.js';
import { pnlReportToCsvBundle, SCHEMA_VERSION } from '../../src/reporting/csv-export.js';
import type { PnlReport } from '../../src/reporting/pnl.js';

const utc = (value: string) => value as UtcDateString;

const emptyReport: PnlReport = {
  method: 'FIFO',
  realizedRows: [],
  openLots: [],
  totalsByAccount: [],
  totalsByAsset: [],
  aggregateTotals: {
    proceedsUsd: 0,
    basisUsd: 0,
    realizedGainUsd: 0,
    openBasisUsd: 0,
    openMarketValueUsd: 0,
    unrealizedGainUsd: 0,
  },
  warnings: [],
};

describe('pnlReportToCsvBundle', () => {
  it('exports deterministic header-only CSVs for an empty report', () => {
    const bundle = pnlReportToCsvBundle(emptyReport);
    expect(SCHEMA_VERSION).toBe('3');
    expect(bundle.realizedCsv).toBe(
      'schema_version,method,date,account_id,chain,symbol,quantity_decimal,raw_disposed,decimals,proceeds_usd,basis_usd,gain_usd,disposal_txid,consumed_lot_ids,consumed_acquired_dates,consumed_acquisition_txids,consumed_raw_amounts,consumed_basis_usd,consumed_sources\n',
    );
    expect(bundle.openLotsCsv).toBe(
      'schema_version,account_id,chain,symbol,source,quantity_decimal,raw_amount,decimals,acquired_date,acquisition_txid,unit_basis_usd,basis_usd\n',
    );
    expect(bundle.warningsCsv).toBe('schema_version,code,txid,message,raw_warning\n');
  });

  it('serializes PnL report rows with RFC-4180 escaping and decimal raw amounts', () => {
    const report: PnlReport = {
      ...emptyReport,
      realizedRows: [
        {
          date: utc('2026-03-01'),
          accountId: 'acct,1',
          chain: 'bitcoin',
          symbol: 'BTC',
          qty: 1.5,
          proceedsUsd: 45_000,
          basisUsd: 20_000,
          gainUsd: 25_000,
          disposalTxid: 'sell"tx',
          consumedLots: [
            {
              lotId: 'lot-1',
              acquiredDate: utc('2026-01-01'),
              acquisitionTxid: 'buy-1',
              rawAmount: 100_000_000n,
              basisUsd: 10_000,
              source: 'manual',
            },
            {
              lotId: 'lot-2',
              acquiredDate: utc('2026-02-01'),
              acquisitionTxid: 'buy-2',
              rawAmount: 50_000_000n,
              basisUsd: 10_000,
              source: 'chain',
            },
          ],
        },
      ],
      openLots: [
        {
          lotId: 'lot-3',
          accountId: 'acct-1',
          chain: 'bitcoin',
          symbol: 'BTC',
          rawAmount: 150_000_000n,
          decimals: 8,
          acquiredDate: utc('2026-02-01'),
          acquisitionTxid: 'buy-2',
          unitBasisUsd: 20_000,
          source: 'chain',
        },
      ],
      warnings: ['unpriceable:tx,1: no "price"\nline'],
    };

    const bundle = pnlReportToCsvBundle(report);

    expect(bundle.realizedCsv).toBe(
      'schema_version,method,date,account_id,chain,symbol,quantity_decimal,raw_disposed,decimals,proceeds_usd,basis_usd,gain_usd,disposal_txid,consumed_lot_ids,consumed_acquired_dates,consumed_acquisition_txids,consumed_raw_amounts,consumed_basis_usd,consumed_sources\n' +
        '3,FIFO,2026-03-01,"acct,1",bitcoin,BTC,1.5,150000000,8,45000,20000,25000,"sell""tx",lot-1;lot-2,2026-01-01;2026-02-01,buy-1;buy-2,100000000;50000000,10000;10000,manual;chain\n',
    );
    expect(bundle.openLotsCsv).toBe(
      'schema_version,account_id,chain,symbol,source,quantity_decimal,raw_amount,decimals,acquired_date,acquisition_txid,unit_basis_usd,basis_usd\n' +
        '3,acct-1,bitcoin,BTC,chain,1.5,150000000,8,2026-02-01,buy-2,20000,30000\n',
    );
    expect(bundle.warningsCsv).toBe(
      'schema_version,code,txid,message,raw_warning\n' +
        '3,unpriceable,"tx,1","no ""price""\nline","unpriceable:tx,1: no ""price""\nline"\n',
    );
  });

  it('serializes override provenance for basis-corrected lots', () => {
    const report: PnlReport = {
      ...emptyReport,
      realizedRows: [
        {
          date: utc('2026-03-15'),
          accountId: 'acct-a',
          chain: 'bitcoin',
          symbol: 'BTC',
          qty: 1.5,
          proceedsUsd: 45_000,
          basisUsd: 20_000,
          gainUsd: 25_000,
          disposalTxid: 'visible-sell',
          consumedLots: [
            {
              lotId: 'lot-open',
              acquiredDate: utc('2026-01-01'),
              acquisitionTxid: 'manual:prehistory-btc',
              rawAmount: 100_000_000n,
              basisUsd: 10_000,
              source: 'manual',
            },
            {
              lotId: 'lot-override',
              acquiredDate: utc('2026-02-01'),
              acquisitionTxid: 'visible-buy',
              rawAmount: 50_000_000n,
              basisUsd: 10_000,
              source: 'override',
            },
          ],
        },
      ],
      openLots: [
        {
          lotId: 'lot-remain',
          accountId: 'acct-a',
          chain: 'bitcoin',
          symbol: 'BTC',
          rawAmount: 50_000_000n,
          decimals: 8,
          acquiredDate: utc('2026-02-01'),
          acquisitionTxid: 'visible-buy',
          unitBasisUsd: 20_000,
          source: 'override',
        },
      ],
    };

    const bundle = pnlReportToCsvBundle(report);
    expect(bundle.realizedCsv).toContain('manual;override\n');
    expect(bundle.openLotsCsv).toContain(',override,0.5,50000000,8,2026-02-01,visible-buy,20000,10000\n');
  });
});

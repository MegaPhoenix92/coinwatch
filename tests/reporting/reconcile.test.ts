import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UtcDateString } from '../../src/domain/historical-price.js';
import {
  diffReconRecords,
  loadReconRecords,
  realizedRowsToReconRecords,
  type ReconRecord,
} from '../../src/reporting/reconcile.js';
import type { PnlReport } from '../../src/reporting/pnl.js';

const utc = (value: string) => value as UtcDateString;

function record(overrides: Partial<ReconRecord> = {}): ReconRecord {
  return {
    source: 'coinwatch',
    kind: 'realized_disposal',
    accountId: 'acct-1',
    chain: 'bitcoin',
    symbol: 'BTC',
    date: utc('2026-03-01'),
    txid: 'tx-1',
    quantity: 1,
    proceedsUsd: 30_000,
    basisUsd: 10_000,
    gainUsd: 20_000,
    ...overrides,
  };
}

describe('diffReconRecords', () => {
  it('matches equal records and tolerates small USD differences', () => {
    const diff = diffReconRecords(
      [record()],
      [record({ source: 'external', proceedsUsd: 30_000.005, basisUsd: 10_000, gainUsd: 20_000 })],
    );

    expect(diff.summary).toMatchObject({
      matched: 1,
      valueMismatch: 0,
      onlyInCoinwatch: 0,
      onlyInExternal: 0,
    });
  });

  it('reports only-in-coinwatch and only-in-external records', () => {
    const diff = diffReconRecords(
      [record({ txid: 'cw-only' })],
      [record({ source: 'external', txid: 'external-only' })],
    );

    expect(diff.only_in_coinwatch.map((row) => row.txid)).toEqual(['cw-only']);
    expect(diff.only_in_external.map((row) => row.txid)).toEqual(['external-only']);
    expect(diff.summary).toMatchObject({ onlyInCoinwatch: 1, onlyInExternal: 1 });
  });

  it('reports value mismatches outside tolerance with field deltas', () => {
    const diff = diffReconRecords(
      [record()],
      [record({ source: 'external', proceedsUsd: 29_999, basisUsd: 10_005, gainUsd: 19_994 })],
    );

    expect(diff.value_mismatch).toHaveLength(1);
    expect(diff.value_mismatch[0].deltas.map((delta) => delta.field)).toEqual([
      'proceedsUsd',
      'basisUsd',
      'gainUsd',
    ]);
    expect(diff.value_mismatch[0].deltas[0]).toMatchObject({
      coinwatch: 30_000,
      external: 29_999,
      delta: 1,
      tolerance: 0.01,
    });
  });

  it('uses fallback key matching when txid is absent', () => {
    const diff = diffReconRecords(
      [record({ txid: undefined, quantity: 0.5 })],
      [record({ source: 'external', txid: undefined, quantity: 0.5 })],
    );

    expect(diff.summary.matched).toBe(1);
  });

  it('reports ambiguous matches when one match key has multiple external rows', () => {
    const diff = diffReconRecords(
      [record({ txid: undefined, quantity: 0.5 })],
      [
        record({ source: 'external', txid: undefined, quantity: 0.5, recordId: 'a' }),
        record({ source: 'external', txid: undefined, quantity: 0.5, recordId: 'b' }),
      ],
    );

    expect(diff.ambiguous_match).toHaveLength(1);
    expect(diff.ambiguous_match[0]).toMatchObject({
      coinwatch: [expect.objectContaining({ quantity: 0.5 })],
      external: [expect.objectContaining({ recordId: 'a' }), expect.objectContaining({ recordId: 'b' })],
    });
    expect(diff.summary.ambiguousMatch).toBe(1);
  });
});

describe('loadReconRecords', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  function tempFile(name: string, text: string): string {
    dir ??= mkdtempSync(join(tmpdir(), 'coinwatch-recon-loader-'));
    const file = join(dir, name);
    writeFileSync(file, text, 'utf8');
    return file;
  }

  it('parses valid JSON records', () => {
    const file = tempFile(
      'records.json',
      JSON.stringify([
        {
          kind: 'realized_disposal',
          accountId: 'acct-1',
          chain: 'bitcoin',
          symbol: 'BTC',
          date: '2026-03-01',
          txid: 'tx-1',
          quantity: 1,
          proceedsUsd: 30_000,
          basisUsd: 10_000,
          gainUsd: 20_000,
        },
      ]),
    );

    const loaded = loadReconRecords(file);

    expect(loaded.invalidExternalRows).toEqual([]);
    expect(loaded.records[0]).toMatchObject({
      source: 'external',
      txid: 'tx-1',
      proceedsUsd: 30_000,
    });
  });

  it('parses valid RFC-4180 CSV records with quoted commas and doubled quotes', () => {
    const file = tempFile(
      'records.csv',
      [
        'record_id,source,kind,account_id,chain,symbol,date,txid,quantity,proceeds_usd,basis_usd,gain_usd',
        '"row, ""one""",external,realized_disposal,acct-1,bitcoin,BTC,2026-03-01,tx-1,1,30000,10000,20000',
      ].join('\n'),
    );

    const loaded = loadReconRecords(file);

    expect(loaded.invalidExternalRows).toEqual([]);
    expect(loaded.records[0]).toMatchObject({
      recordId: 'row, "one"',
      source: 'external',
      gainUsd: 20_000,
    });
  });

  it('parses a quoted field with an embedded newline as a single record_id value', () => {
    const file = tempFile(
      'embedded-newline.csv',
      [
        'record_id,source,kind,account_id,chain,symbol,date,txid,quantity,proceeds_usd,basis_usd,gain_usd',
        '"line1',
        'line2",external,realized_disposal,acct-1,bitcoin,BTC,2026-03-01,tx-1,1,30000,10000,20000',
      ].join('\n'),
    );

    const loaded = loadReconRecords(file);

    expect(loaded.invalidExternalRows).toEqual([]);
    expect(loaded.records).toHaveLength(1);
    expect(loaded.records[0].recordId).toBe('line1\nline2');
  });

  it('parses CRLF-terminated CSV and suppresses carriage returns outside quoted fields', () => {
    const file = tempFile(
      'crlf.csv',
      [
        'record_id,source,kind,account_id,chain,symbol,date,txid,quantity,proceeds_usd,basis_usd,gain_usd',
        'crlf-row,external,realized_disposal,acct-1,bitcoin,BTC,2026-03-01,tx-crlf,1,30000,10000,20000',
      ].join('\r\n'),
    );

    const loaded = loadReconRecords(file);

    expect(loaded.invalidExternalRows).toEqual([]);
    expect(loaded.records).toHaveLength(1);
    expect(loaded.records[0]).toMatchObject({
      recordId: 'crlf-row',
      txid: 'tx-crlf',
      proceedsUsd: 30_000,
    });
  });

  it('returns invalid_external_row for CSV rows with non-numeric quantity without throwing', () => {
    const file = tempFile(
      'bad-quantity.csv',
      [
        'record_id,source,kind,account_id,chain,symbol,date,txid,quantity,proceeds_usd,basis_usd,gain_usd',
        'good,external,realized_disposal,acct-1,bitcoin,BTC,2026-03-01,tx-good,1,30000,10000,20000',
        'bad-qty,external,realized_disposal,acct-1,bitcoin,BTC,2026-03-01,tx-bad,not-a-number,30000,10000,20000',
      ].join('\n'),
    );

    const loaded = loadReconRecords(file);

    expect(loaded.records).toHaveLength(1);
    expect(loaded.records[0].txid).toBe('tx-good');
    expect(loaded.invalidExternalRows).toHaveLength(1);
    expect(loaded.invalidExternalRows[0].reason).toMatch(/quantity/i);
    expect(loaded.invalidExternalRows[0].raw).toMatchObject({ txid: 'tx-bad' });
  });

  it('returns invalid_external_row for CSV rows with an unclosed leading quote without throwing', () => {
    const file = tempFile(
      'unclosed-quote.csv',
      [
        'record_id,source,kind,account_id,chain,symbol,date,txid,quantity,proceeds_usd,basis_usd,gain_usd',
        'good,external,realized_disposal,acct-1,bitcoin,BTC,2026-03-01,tx-good,1,30000,10000,20000',
        '"stray-open,external,realized_disposal,acct-1,bitcoin,BTC,2026-03-01,tx-bad,1,30000,10000,20000',
      ].join('\n'),
    );

    const loaded = loadReconRecords(file);

    expect(loaded.records).toHaveLength(1);
    expect(loaded.invalidExternalRows).toHaveLength(1);
    expect(loaded.invalidExternalRows[0].reason.length).toBeGreaterThan(0);
    expect(loaded.invalidExternalRows[0].raw).toBeDefined();
  });

  it('returns invalid_external_row entries for malformed rows without dropping valid rows', () => {
    const file = tempFile(
      'mixed.json',
      JSON.stringify([
        {
          kind: 'realized_disposal',
          accountId: 'acct-1',
          chain: 'bitcoin',
          symbol: 'BTC',
          date: '2026-03-01',
        },
        {
          kind: 'realized_disposal',
          accountId: '',
          chain: 'bitcoin',
          symbol: 'BTC',
          date: 'not-a-date',
        },
      ]),
    );

    const loaded = loadReconRecords(file);

    expect(loaded.records).toHaveLength(1);
    expect(loaded.invalidExternalRows).toHaveLength(1);
    expect(loaded.invalidExternalRows[0].reason).toContain('accountId');
  });
});

describe('sample realized-PnL reconciliation', () => {
  it('maps a PnlReport and produces exact summary counts for matched, only-in-both, and mismatch cases', () => {
    const report: PnlReport = {
      method: 'FIFO',
      realizedRows: [
        {
          date: utc('2026-03-01'),
          accountId: 'acct-1',
          chain: 'bitcoin',
          symbol: 'BTC',
          qty: 1,
          proceedsUsd: 30_000,
          basisUsd: 10_000,
          gainUsd: 20_000,
          disposalTxid: 'matched',
          consumedLots: [],
        },
        {
          date: utc('2026-03-02'),
          accountId: 'acct-1',
          chain: 'bitcoin',
          symbol: 'BTC',
          qty: 0.5,
          proceedsUsd: 20_000,
          basisUsd: 8_000,
          gainUsd: 12_000,
          disposalTxid: 'cw-only',
          consumedLots: [],
        },
        {
          date: utc('2026-03-03'),
          accountId: 'acct-1',
          chain: 'bitcoin',
          symbol: 'BTC',
          qty: 0.25,
          proceedsUsd: 10_000,
          basisUsd: 5_000,
          gainUsd: 5_000,
          disposalTxid: 'mismatch',
          consumedLots: [],
        },
      ],
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

    const external = [
      record({ source: 'external', txid: 'matched' }),
      record({ source: 'external', txid: 'external-only' }),
      record({
        source: 'external',
        txid: 'mismatch',
        quantity: 0.25,
        proceedsUsd: 10_000,
        basisUsd: 4_900,
        gainUsd: 5_100,
      }),
    ];

    const diff = diffReconRecords(realizedRowsToReconRecords(report), external);

    expect(diff.summary).toEqual({
      matched: 1,
      onlyInCoinwatch: 1,
      onlyInExternal: 1,
      valueMismatch: 1,
      ambiguousMatch: 0,
      invalidExternalRow: 0,
    });
  });
});

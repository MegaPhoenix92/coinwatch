import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatUnits } from '../core/money.js';
import { assetBySymbol } from '../domain/assets.js';
import type { PnlReport } from './pnl.js';

export const SCHEMA_VERSION = '2';

/**
 * PnL CSV schema v2 exports the computed PnlReport, not raw chain activity.
 * Files are ledger-shaped: realized disposals, remaining open lots, and
 * warnings. BigInt raw quantities are decimal strings; USD columns are JS
 * number strings from the PnL engine. v2 adds lot source provenance for manual
 * opening balances and basis overrides.
 */
const REALIZED_HEADER = [
  'schema_version',
  'method',
  'date',
  'account_id',
  'chain',
  'symbol',
  'quantity_decimal',
  'raw_disposed',
  'decimals',
  'proceeds_usd',
  'basis_usd',
  'gain_usd',
  'disposal_txid',
  'consumed_lot_ids',
  'consumed_acquired_dates',
  'consumed_acquisition_txids',
  'consumed_raw_amounts',
  'consumed_basis_usd',
  'consumed_sources',
] as const;

const OPEN_LOTS_HEADER = [
  'schema_version',
  'account_id',
  'chain',
  'symbol',
  'source',
  'quantity_decimal',
  'raw_amount',
  'decimals',
  'acquired_date',
  'acquisition_txid',
  'unit_basis_usd',
  'basis_usd',
] as const;

const WARNINGS_HEADER = ['schema_version', 'code', 'txid', 'message', 'raw_warning'] as const;

export interface PnlCsvBundle {
  realizedCsv: string;
  openLotsCsv: string;
  warningsCsv: string;
}

export interface PnlCsvFiles {
  realized: string;
  openLots: string;
  warnings: string;
}

function csvField(value: string | number | bigint): string {
  const text = value.toString();
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(fields: readonly (string | number | bigint)[]): string {
  return `${fields.map(csvField).join(',')}\n`;
}

function basisUsd(raw: bigint, decimals: number, unitBasisUsd: number): number {
  return Number(formatUnits(raw, decimals)) * unitBasisUsd;
}

function warningParts(raw: string): { code: string; txid: string; message: string } {
  const match = /^([^:]+):([^:]+):\s?([\s\S]*)$/.exec(raw);
  if (match === null) {
    return { code: 'warning', txid: '', message: raw };
  }
  return { code: match[1], txid: match[2], message: match[3] };
}

export function pnlReportToCsvBundle(report: PnlReport): PnlCsvBundle {
  const realizedCsv =
    csvLine(REALIZED_HEADER) +
    report.realizedRows
      .map((row) => {
        const rawDisposed = row.consumedLots.reduce((sum, lot) => sum + lot.rawAmount, 0n);
        const decimals = assetBySymbol(row.chain, row.symbol)?.decimals;
        if (decimals === undefined) {
          throw new Error(`No asset registry entry for ${row.chain}/${row.symbol}.`);
        }
        return csvLine([
          SCHEMA_VERSION,
          report.method,
          row.date,
          row.accountId,
          row.chain,
          row.symbol,
          formatUnits(rawDisposed, decimals),
          rawDisposed.toString(),
          decimals,
          row.proceedsUsd,
          row.basisUsd,
          row.gainUsd,
          row.disposalTxid,
          row.consumedLots.map((lot) => lot.lotId).join(';'),
          row.consumedLots.map((lot) => lot.acquiredDate).join(';'),
          row.consumedLots.map((lot) => lot.acquisitionTxid).join(';'),
          row.consumedLots.map((lot) => lot.rawAmount.toString()).join(';'),
          row.consumedLots.map((lot) => lot.basisUsd).join(';'),
          row.consumedLots.map((lot) => lot.source).join(';'),
        ]);
      })
      .join('');

  const openLotsCsv =
    csvLine(OPEN_LOTS_HEADER) +
    report.openLots
      .map((lot) =>
        csvLine([
          SCHEMA_VERSION,
          lot.accountId,
          lot.chain,
          lot.symbol,
          lot.source,
          formatUnits(lot.rawAmount, lot.decimals),
          lot.rawAmount.toString(),
          lot.decimals,
          lot.acquiredDate,
          lot.acquisitionTxid,
          lot.unitBasisUsd,
          basisUsd(lot.rawAmount, lot.decimals, lot.unitBasisUsd),
        ]),
      )
      .join('');

  const warningsCsv =
    csvLine(WARNINGS_HEADER) +
    report.warnings
      .map((warning) => {
        const parsed = warningParts(warning);
        return csvLine([SCHEMA_VERSION, parsed.code, parsed.txid, parsed.message, warning]);
      })
      .join('');

  return { realizedCsv, openLotsCsv, warningsCsv };
}

export function writePnlCsvBundle(
  bundle: PnlCsvBundle,
  stamp = `${Date.now()}`,
  dir = process.cwd(),
): PnlCsvFiles {
  const prefix = `coinwatch-pnl-${stamp}`;
  const files = {
    realized: join(dir, `${prefix}-realized.csv`),
    openLots: join(dir, `${prefix}-open-lots.csv`),
    warnings: join(dir, `${prefix}-warnings.csv`),
  };
  writeFileSync(files.realized, bundle.realizedCsv, 'utf8');
  writeFileSync(files.openLots, bundle.openLotsCsv, 'utf8');
  writeFileSync(files.warnings, bundle.warningsCsv, 'utf8');
  return files;
}

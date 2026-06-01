import { readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { z } from 'zod';
import { assertUtcDateString, type UtcDateString } from '../domain/historical-price.js';
import type { Chain } from '../domain/chains.js';
import { ASSET_SYMBOL_VALUES, type AssetSymbol } from '../domain/assets.js';
import type { PnlReport, RealizedRow } from './pnl.js';

export interface ReconRecord {
  recordId?: string;
  source: 'coinwatch' | 'external';
  kind: 'realized_disposal';
  accountId: string;
  chain: Chain;
  symbol: AssetSymbol;
  date: UtcDateString;
  txid?: string;
  quantity?: number;
  proceedsUsd?: number;
  basisUsd?: number;
  gainUsd?: number;
}

export interface InvalidExternalRow {
  recordId?: string;
  reason: string;
  raw: unknown;
}

export interface LoadedReconRecords {
  records: ReconRecord[];
  invalidExternalRows: InvalidExternalRow[];
}

export interface ReconValueDelta {
  field: 'quantity' | 'proceedsUsd' | 'basisUsd' | 'gainUsd';
  coinwatch?: number;
  external?: number;
  delta?: number;
  tolerance: number;
}

export interface ReconMatched {
  key: string;
  coinwatch: ReconRecord;
  external: ReconRecord;
}

export interface ReconValueMismatch extends ReconMatched {
  deltas: ReconValueDelta[];
}

export interface ReconAmbiguousMatch {
  key: string;
  coinwatch: ReconRecord[];
  external: ReconRecord[];
}

export interface ReconSummary {
  matched: number;
  onlyInCoinwatch: number;
  onlyInExternal: number;
  valueMismatch: number;
  ambiguousMatch: number;
  invalidExternalRow: number;
}

export interface ReconDiff {
  matched: ReconMatched[];
  only_in_coinwatch: ReconRecord[];
  only_in_external: ReconRecord[];
  value_mismatch: ReconValueMismatch[];
  ambiguous_match: ReconAmbiguousMatch[];
  invalid_external_row: InvalidExternalRow[];
  summary: ReconSummary;
}

export interface ReconDiffOptions {
  usdToleranceUsd?: number;
  invalidExternalRows?: InvalidExternalRow[];
}

export interface ReconArtifactFiles {
  json: string;
  matchedCsv: string;
  onlyInCoinwatchCsv: string;
  onlyInExternalCsv: string;
  valueMismatchCsv: string;
  ambiguousMatchCsv: string;
  invalidExternalRowsCsv: string;
}

const CHAIN_VALUES = [
  'bitcoin',
  'ethereum',
  'base',
  'polygon',
  'arbitrum',
  'optimism',
  'solana',
] as const;

const recordSchema = z.object({
  recordId: z.string().min(1).optional(),
  source: z.enum(['coinwatch', 'external']).default('external'),
  kind: z.literal('realized_disposal'),
  accountId: z.string().min(1),
  chain: z.enum(CHAIN_VALUES),
  symbol: z.enum(ASSET_SYMBOL_VALUES),
  date: z.string().transform((value, ctx) => {
    try {
      return assertUtcDateString(value);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'invalid UTC date',
      });
      return z.NEVER;
    }
  }),
  txid: z.string().min(1).optional(),
  quantity: z.number().optional(),
  proceedsUsd: z.number().optional(),
  basisUsd: z.number().optional(),
  gainUsd: z.number().optional(),
});

export const RECON_CSV_HEADERS = [
  'record_id',
  'source',
  'kind',
  'account_id',
  'chain',
  'symbol',
  'date',
  'txid',
  'quantity',
  'proceeds_usd',
  'basis_usd',
  'gain_usd',
] as const;

function csvField(value: string | number | undefined): string {
  const text = value === undefined ? '' : value.toString();
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(fields: readonly (string | number | undefined)[]): string {
  return `${fields.map(csvField).join(',')}\n`;
}

function recordToCsvRow(record: ReconRecord): string {
  return csvLine([
    record.recordId,
    record.source,
    record.kind,
    record.accountId,
    record.chain,
    record.symbol,
    record.date,
    record.txid,
    record.quantity,
    record.proceedsUsd,
    record.basisUsd,
    record.gainUsd,
  ]);
}

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value !== 'string') {
    return Number.NaN;
  }
  return Number(value);
}

function normalizeExternalRow(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const row = raw as Record<string, unknown>;
  return {
    recordId: row.recordId ?? row.record_id,
    source: row.source ?? 'external',
    kind: row.kind,
    accountId: row.accountId ?? row.account_id,
    chain: row.chain,
    symbol: row.symbol,
    date: row.date,
    txid: row.txid === '' ? undefined : row.txid,
    quantity: parseNumber(row.quantity),
    proceedsUsd: parseNumber(row.proceedsUsd ?? row.proceeds_usd),
    basisUsd: parseNumber(row.basisUsd ?? row.basis_usd),
    gainUsd: parseNumber(row.gainUsd ?? row.gain_usd),
  };
}

function parseReconRecord(raw: unknown): { record?: ReconRecord; invalid?: InvalidExternalRow } {
  const normalized = normalizeExternalRow(raw);
  const parsed = recordSchema.safeParse(normalized);
  if (parsed.success) {
    return { record: parsed.data as ReconRecord };
  }
  return {
    invalid: {
      recordId:
        typeof normalized === 'object' && normalized !== null && !Array.isArray(normalized)
          ? String((normalized as Record<string, unknown>).recordId ?? '')
          : undefined,
      reason: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      raw,
    },
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvRowsToObjects(rows: string[][]): Record<string, string>[] {
  const [header, ...body] = rows;
  if (header === undefined) {
    return [];
  }
  return body
    .filter((row) => row.some((field) => field.length > 0))
    .map((row) =>
      Object.fromEntries(header.map((name, index) => [name, row[index] ?? ''])),
    );
}

export function loadReconRecords(path: string): LoadedReconRecords {
  const text = readFileSync(path, 'utf8');
  const ext = extname(path).toLowerCase();
  const rawRows =
    ext === '.csv' ? csvRowsToObjects(parseCsv(text)) : (JSON.parse(text) as unknown[]);
  if (!Array.isArray(rawRows)) {
    return {
      records: [],
      invalidExternalRows: [{ reason: 'external reconciliation input must be an array', raw: rawRows }],
    };
  }

  const records: ReconRecord[] = [];
  const invalidExternalRows: InvalidExternalRow[] = [];
  for (const raw of rawRows) {
    const parsed = parseReconRecord(raw);
    if (parsed.record !== undefined) {
      records.push({ ...parsed.record, source: 'external' });
    } else if (parsed.invalid !== undefined) {
      invalidExternalRows.push(parsed.invalid);
    }
  }
  return { records, invalidExternalRows };
}

export function realizedRowsToReconRecords(report: PnlReport): ReconRecord[] {
  return report.realizedRows.map((row: RealizedRow) => ({
    source: 'coinwatch',
    kind: 'realized_disposal',
    accountId: row.accountId,
    chain: row.chain,
    symbol: row.symbol,
    date: row.date,
    txid: row.disposalTxid,
    quantity: row.qty,
    proceedsUsd: row.proceedsUsd,
    basisUsd: row.basisUsd,
    gainUsd: row.gainUsd,
  }));
}

function matchKey(record: ReconRecord): string {
  if (record.txid !== undefined && record.txid.length > 0) {
    return [record.kind, record.accountId, record.chain, record.symbol, record.txid].join('|');
  }
  return [
    record.kind,
    record.accountId,
    record.chain,
    record.symbol,
    record.date,
    record.quantity ?? '',
  ].join('|');
}

function groupByKey(records: readonly ReconRecord[]): Map<string, ReconRecord[]> {
  const groups = new Map<string, ReconRecord[]>();
  for (const record of records) {
    const key = matchKey(record);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return groups;
}

function compareNumber(
  field: ReconValueDelta['field'],
  coinwatch: number | undefined,
  external: number | undefined,
  tolerance: number,
): ReconValueDelta | undefined {
  if (coinwatch === undefined && external === undefined) {
    return undefined;
  }
  if (coinwatch === undefined || external === undefined) {
    return { field, coinwatch, external, tolerance };
  }
  const delta = coinwatch - external;
  return Math.abs(delta) <= tolerance
    ? undefined
    : { field, coinwatch, external, delta, tolerance };
}

function buildSummary(diff: Omit<ReconDiff, 'summary'>): ReconSummary {
  return {
    matched: diff.matched.length,
    onlyInCoinwatch: diff.only_in_coinwatch.length,
    onlyInExternal: diff.only_in_external.length,
    valueMismatch: diff.value_mismatch.length,
    ambiguousMatch: diff.ambiguous_match.length,
    invalidExternalRow: diff.invalid_external_row.length,
  };
}

export function diffReconRecords(
  coinwatch: readonly ReconRecord[],
  external: readonly ReconRecord[],
  opts: ReconDiffOptions = {},
): ReconDiff {
  const usdTolerance = opts.usdToleranceUsd ?? 0.01;
  const coinwatchGroups = groupByKey(coinwatch);
  const externalGroups = groupByKey(external);
  const keys = new Set([...coinwatchGroups.keys(), ...externalGroups.keys()]);
  const diff: Omit<ReconDiff, 'summary'> = {
    matched: [],
    only_in_coinwatch: [],
    only_in_external: [],
    value_mismatch: [],
    ambiguous_match: [],
    invalid_external_row: opts.invalidExternalRows ?? [],
  };

  for (const key of [...keys].sort()) {
    const cw = coinwatchGroups.get(key) ?? [];
    const ext = externalGroups.get(key) ?? [];
    if (cw.length !== 1 || ext.length !== 1) {
      if (cw.length > 0 && ext.length > 0) {
        diff.ambiguous_match.push({ key, coinwatch: cw, external: ext });
      } else if (cw.length > 0) {
        diff.only_in_coinwatch.push(...cw);
      } else {
        diff.only_in_external.push(...ext);
      }
      continue;
    }

    const deltas = [
      compareNumber('quantity', cw[0].quantity, ext[0].quantity, 0),
      compareNumber('proceedsUsd', cw[0].proceedsUsd, ext[0].proceedsUsd, usdTolerance),
      compareNumber('basisUsd', cw[0].basisUsd, ext[0].basisUsd, usdTolerance),
      compareNumber('gainUsd', cw[0].gainUsd, ext[0].gainUsd, usdTolerance),
    ].filter((delta): delta is ReconValueDelta => delta !== undefined);

    if (deltas.length > 0) {
      diff.value_mismatch.push({ key, coinwatch: cw[0], external: ext[0], deltas });
    } else {
      diff.matched.push({ key, coinwatch: cw[0], external: ext[0] });
    }
  }

  return { ...diff, summary: buildSummary(diff) };
}

function recordsCsv(records: readonly ReconRecord[]): string {
  return csvLine(RECON_CSV_HEADERS) + records.map(recordToCsvRow).join('');
}

function valueMismatchCsv(rows: readonly ReconValueMismatch[]): string {
  return (
    csvLine(['key', 'field', 'coinwatch', 'external', 'delta', 'tolerance']) +
    rows
      .flatMap((row) =>
        row.deltas.map((delta) =>
          csvLine([row.key, delta.field, delta.coinwatch, delta.external, delta.delta, delta.tolerance]),
        ),
      )
      .join('')
  );
}

function ambiguousCsv(rows: readonly ReconAmbiguousMatch[]): string {
  return (
    csvLine(['key', 'coinwatch_count', 'external_count']) +
    rows.map((row) => csvLine([row.key, row.coinwatch.length, row.external.length])).join('')
  );
}

function invalidRowsCsv(rows: readonly InvalidExternalRow[]): string {
  return (
    csvLine(['record_id', 'reason', 'raw']) +
    rows.map((row) => csvLine([row.recordId, row.reason, JSON.stringify(row.raw)])).join('')
  );
}

export function writeReconArtifacts(
  diff: ReconDiff,
  stamp = `${Date.now()}`,
  dir = process.cwd(),
): ReconArtifactFiles {
  const prefix = `coinwatch-recon-${stamp}`;
  const files = {
    json: join(dir, `${prefix}.json`),
    matchedCsv: join(dir, `${prefix}-matched.csv`),
    onlyInCoinwatchCsv: join(dir, `${prefix}-only-in-coinwatch.csv`),
    onlyInExternalCsv: join(dir, `${prefix}-only-in-external.csv`),
    valueMismatchCsv: join(dir, `${prefix}-value-mismatch.csv`),
    ambiguousMatchCsv: join(dir, `${prefix}-ambiguous-match.csv`),
    invalidExternalRowsCsv: join(dir, `${prefix}-invalid-external-rows.csv`),
  };
  writeFileSync(files.json, `${JSON.stringify(diff, null, 2)}\n`, 'utf8');
  writeFileSync(files.matchedCsv, recordsCsv(diff.matched.map((row) => row.coinwatch)), 'utf8');
  writeFileSync(files.onlyInCoinwatchCsv, recordsCsv(diff.only_in_coinwatch), 'utf8');
  writeFileSync(files.onlyInExternalCsv, recordsCsv(diff.only_in_external), 'utf8');
  writeFileSync(files.valueMismatchCsv, valueMismatchCsv(diff.value_mismatch), 'utf8');
  writeFileSync(files.ambiguousMatchCsv, ambiguousCsv(diff.ambiguous_match), 'utf8');
  writeFileSync(files.invalidExternalRowsCsv, invalidRowsCsv(diff.invalid_external_row), 'utf8');
  return files;
}

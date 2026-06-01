import { nativeAsset } from '../domain/assets.js';
import type { TxCategory, TxCategoryFields, TxCategorySource } from '../domain/categories.js';
import type { Tx } from '../domain/types.js';

export interface CategorizedTx extends Tx, TxCategoryFields {}

export interface TxCategoryOverrideRow {
  chain: Tx['chain'];
  txid: string;
  symbol: Tx['symbol'];
  category: TxCategory;
  note?: string;
}

export function txCategoryRowKey(tx: Pick<Tx, 'chain' | 'txid' | 'symbol'>): string {
  return `${tx.chain}:${tx.txid}:${tx.symbol}`;
}

export function detectSwapTxids(txs: readonly Tx[]): Set<string> {
  const groups = new Map<string, Tx[]>();
  for (const tx of txs) {
    const key = `${tx.chain}:${tx.txid}`;
    const group = groups.get(key) ?? [];
    group.push(tx);
    groups.set(key, group);
  }

  const swapTxids = new Set<string>();
  for (const [key, group] of groups) {
    const hasIn = group.some((row) => row.direction === 'in');
    const hasOut = group.some((row) => row.direction === 'out');
    const symbols = new Set(group.map((row) => row.symbol));
    if (hasIn && hasOut && group.length >= 2 && symbols.size >= 2) {
      swapTxids.add(key);
    }
  }
  return swapTxids;
}

function feeThresholdRaw(decimals: number): bigint {
  const shift = Math.max(0, decimals - 3);
  return 10n ** BigInt(shift);
}

function isNativeFeeShaped(tx: Tx): boolean {
  if (tx.direction !== 'self' && tx.direction !== 'out') {
    return false;
  }
  const native = nativeAsset(tx.chain);
  if (tx.symbol !== native.symbol || tx.raw <= 0n) {
    return false;
  }
  return tx.raw <= feeThresholdRaw(tx.decimals);
}

function heuristicCategory(
  tx: Tx,
  swapTxids: Set<string>,
): { category: TxCategory; reason: string } {
  if (tx.direction === 'unknown') {
    return { category: 'unknown', reason: 'direction_unknown' };
  }

  const swapKey = `${tx.chain}:${tx.txid}`;
  if (swapTxids.has(swapKey)) {
    return { category: 'swap', reason: 'opposing_in_out_same_tx' };
  }

  if (tx.direction === 'self') {
    if (isNativeFeeShaped(tx)) {
      return { category: 'fee', reason: 'small_native_self' };
    }
    return { category: 'transfer', reason: 'self_transfer' };
  }

  if (tx.direction === 'out' && isNativeFeeShaped(tx)) {
    return { category: 'fee', reason: 'small_native_out' };
  }

  if (tx.direction === 'in' || tx.direction === 'out') {
    if (tx.counterparty !== undefined && tx.counterparty.length > 0) {
      return { category: 'transfer', reason: 'counterparty_present' };
    }
    return { category: 'unknown', reason: 'no_counterparty' };
  }

  return { category: 'unknown', reason: 'unclassified' };
}

export function categorizeTransactions(
  txs: readonly Tx[],
  overrides: ReadonlyMap<string, TxCategoryOverrideRow> = new Map(),
  swapDetectionRows?: readonly Tx[],
): CategorizedTx[] {
  const swapTxids = detectSwapTxids(swapDetectionRows ?? txs);
  return txs.map((tx) => {
    const override = overrides.get(txCategoryRowKey(tx));
    if (override !== undefined) {
      return {
        ...tx,
        category: override.category,
        categorySource: 'manual' satisfies TxCategorySource,
        categoryReason: override.note ?? 'manual_override',
      };
    }
    const heuristic = heuristicCategory(tx, swapTxids);
    return {
      ...tx,
      category: heuristic.category,
      categorySource: 'heuristic' satisfies TxCategorySource,
      categoryReason: heuristic.reason,
    };
  });
}
import type { HistoricalPriceProvider } from '../adapters/chain-adapter.js';
import { assetBySymbol, type AssetSymbol } from '../domain/assets.js';
import type { Chain } from '../domain/chains.js';
import {
  HistoricalPriceCapabilityError,
  type UtcDateString,
  toUtcDateString,
} from '../domain/historical-price.js';
import type { SelfTransferLeg } from '../core/self-transfer.js';
import type { Tx } from '../domain/types.js';

export type LotSource = 'chain' | 'manual' | 'override';

export interface PnlEvent {
  accountId: string;
  chain: Chain;
  symbol: AssetSymbol;
  direction: 'in' | 'out' | 'self' | 'unknown';
  selfTransferLeg?: SelfTransferLeg;
  rawAmount: bigint;
  decimals: number;
  date?: UtcDateString;
  txid: string;
  declaredUnitBasisUsd?: number;
  source?: LotSource;
}

export interface OpenLot {
  lotId: string;
  accountId: string;
  chain: Chain;
  symbol: AssetSymbol;
  rawAmount: bigint;
  decimals: number;
  acquiredDate: UtcDateString;
  acquisitionTxid: string;
  unitBasisUsd: number;
  source: LotSource;
}

export interface ConsumedLot {
  lotId: string;
  acquiredDate: UtcDateString;
  acquisitionTxid: string;
  rawAmount: bigint;
  basisUsd: number;
  source: LotSource;
}

export interface RealizedRow {
  date: UtcDateString;
  accountId: string;
  chain: Chain;
  symbol: AssetSymbol;
  qty: number;
  proceedsUsd: number;
  basisUsd: number;
  gainUsd: number;
  disposalTxid: string;
  consumedLots: ConsumedLot[];
}

export interface PnlTotals {
  proceedsUsd: number;
  basisUsd: number;
  realizedGainUsd: number;
  openBasisUsd: number;
  openMarketValueUsd: number;
  unrealizedGainUsd: number;
}

export interface AccountTotals extends PnlTotals {
  accountId: string;
}

export interface AssetTotals extends PnlTotals {
  chain: Chain;
  symbol: AssetSymbol;
}

export interface PnlReport {
  method: string;
  realizedRows: RealizedRow[];
  openLots: OpenLot[];
  totalsByAccount: AccountTotals[];
  totalsByAsset: AssetTotals[];
  aggregateTotals: PnlTotals;
  warnings: string[];
}

export interface LotSelectionStrategy {
  readonly method: string;
  selectLots(lots: readonly OpenLot[], rawAmount: bigint): OpenLot[];
}

export class FifoStrategy implements LotSelectionStrategy {
  readonly method = 'FIFO';

  selectLots(lots: readonly OpenLot[], rawAmount: bigint): OpenLot[] {
    const ordered = [...lots].sort((a, b) => {
      const byDate = a.acquiredDate.localeCompare(b.acquiredDate);
      return byDate === 0 ? a.lotId.localeCompare(b.lotId) : byDate;
    });
    const selected: OpenLot[] = [];
    let remaining = rawAmount;
    for (const lot of ordered) {
      if (remaining <= 0n) {
        break;
      }
      selected.push(lot);
      remaining -= lot.rawAmount;
    }
    return selected;
  }
}

export interface ComputePnlOptions {
  priceProvider: HistoricalPriceProvider;
  currentUsdPrice(coingeckoId: string): number | undefined;
  strategy?: LotSelectionStrategy;
}

interface IndexedEvent extends PnlEvent {
  index: number;
}

interface LedgerBucket {
  accountId: string;
  chain: Chain;
  symbol: AssetSymbol;
  lots: OpenLot[];
}

function ledgerKey(event: Pick<PnlEvent, 'accountId' | 'chain' | 'symbol'>): string {
  return `${event.accountId}:${event.chain}:${event.symbol}`;
}

function assetKey(event: Pick<PnlEvent, 'chain' | 'symbol'>): string {
  return `${event.chain}:${event.symbol}`;
}

function emptyTotals(): PnlTotals {
  return {
    proceedsUsd: 0,
    basisUsd: 0,
    realizedGainUsd: 0,
    openBasisUsd: 0,
    openMarketValueUsd: 0,
    unrealizedGainUsd: 0,
  };
}

function addTotals(target: PnlTotals, delta: Partial<PnlTotals>): void {
  target.proceedsUsd += delta.proceedsUsd ?? 0;
  target.basisUsd += delta.basisUsd ?? 0;
  target.realizedGainUsd += delta.realizedGainUsd ?? 0;
  target.openBasisUsd += delta.openBasisUsd ?? 0;
  target.openMarketValueUsd += delta.openMarketValueUsd ?? 0;
  target.unrealizedGainUsd += delta.unrealizedGainUsd ?? 0;
}

function qty(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

function basisFor(raw: bigint, decimals: number, unitBasisUsd: number): number {
  return qty(raw, decimals) * unitBasisUsd;
}

function coingeckoIdFor(event: Pick<PnlEvent, 'chain' | 'symbol'>): string | undefined {
  return assetBySymbol(event.chain, event.symbol)?.coingeckoId;
}

async function historicalUsd(
  event: PnlEvent,
  priceProvider: HistoricalPriceProvider,
  warnings: string[],
): Promise<number | undefined> {
  const coingeckoId = coingeckoIdFor(event);
  if (coingeckoId === undefined) {
    warnings.push(`unpriceable:${event.txid}: no asset registry entry for ${event.chain}/${event.symbol}`);
    return undefined;
  }
  if (event.date === undefined) {
    warnings.push(`undated:${event.txid}: ${event.chain}/${event.symbol} has no confirmed UTC date`);
    return undefined;
  }

  try {
    const price = await priceProvider.getHistoricalUsdPrice(coingeckoId, event.date);
    if (price === undefined) {
      warnings.push(`unpriceable:${event.txid}: no historical USD price for ${coingeckoId} on ${event.date}`);
      return undefined;
    }
    return price.usd;
  } catch (error) {
    if (error instanceof HistoricalPriceCapabilityError) {
      warnings.push(
        `unpriceable:${event.txid}: provider cannot price ${coingeckoId} on ${event.date}: ${error.message}`,
      );
      return undefined;
    }
    throw error;
  }
}

function totalRaw(lots: readonly OpenLot[]): bigint {
  return lots.reduce((sum, lot) => sum + lot.rawAmount, 0n);
}

function consumeLots(
  lots: OpenLot[],
  selected: readonly OpenLot[],
  rawAmount: bigint,
): { consumed: ConsumedLot[]; movedLots: OpenLot[]; basisUsd: number } {
  const consumed: ConsumedLot[] = [];
  const movedLots: OpenLot[] = [];
  let remaining = rawAmount;
  let basisUsd = 0;

  for (const selectedLot of selected) {
    if (remaining <= 0n) {
      break;
    }
    const index = lots.findIndex((candidate) => candidate.lotId === selectedLot.lotId);
    if (index < 0) {
      continue;
    }

    const lot = lots[index];
    const take = lot.rawAmount < remaining ? lot.rawAmount : remaining;
    const consumedBasis = basisFor(take, lot.decimals, lot.unitBasisUsd);
    basisUsd += consumedBasis;
    consumed.push({
      lotId: lot.lotId,
      acquiredDate: lot.acquiredDate,
      acquisitionTxid: lot.acquisitionTxid,
      rawAmount: take,
      basisUsd: consumedBasis,
      source: lot.source,
    });
    movedLots.push({ ...lot, rawAmount: take });

    lot.rawAmount -= take;
    if (lot.rawAmount === 0n) {
      lots.splice(index, 1);
    }
    remaining -= take;
  }

  return { consumed, movedLots, basisUsd };
}

function bucketFor(ledgers: Map<string, LedgerBucket>, event: PnlEvent): LedgerBucket {
  const key = ledgerKey(event);
  let bucket = ledgers.get(key);
  if (bucket === undefined) {
    bucket = {
      accountId: event.accountId,
      chain: event.chain,
      symbol: event.symbol,
      lots: [],
    };
    ledgers.set(key, bucket);
  }
  return bucket;
}

export function txToPnlEvents(txs: readonly Tx[], accountId: string): PnlEvent[] {
  return txs.map((tx) => {
    const asset = assetBySymbol(tx.chain, tx.symbol);
    if (asset === undefined) {
      throw new Error(`No asset registry entry for ${tx.chain}/${tx.symbol}.`);
    }
    return {
      accountId,
      chain: tx.chain,
      symbol: tx.symbol,
      direction: tx.direction,
      selfTransferLeg: tx.selfTransferLeg,
      rawAmount: tx.raw,
      decimals: tx.decimals,
      date: tx.timestamp === undefined ? undefined : toUtcDateString(tx.timestamp * 1000),
      txid: tx.txid,
    };
  });
}

function groupSelfTransfers(events: IndexedEvent[]): Map<string, IndexedEvent[]> {
  const groups = new Map<string, IndexedEvent[]>();
  for (const event of events) {
    if (event.direction !== 'self' || event.date === undefined) {
      continue;
    }
    const key = selfTransferKey(event);
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return groups;
}

function selfTransferKey(event: PnlEvent): string {
  return `${event.txid}:${event.chain}:${event.symbol}`;
}

function resolveSelfTransferEnds(
  group: readonly IndexedEvent[],
  ledgers: Map<string, LedgerBucket>,
): { source?: IndexedEvent; destination?: IndexedEvent; ambiguous?: boolean } {
  const outLegs = group.filter((event) => event.selfTransferLeg === 'out');
  const inLegs = group.filter((event) => event.selfTransferLeg === 'in');
  if (outLegs.length === 1 && inLegs.length === 1 && outLegs[0].accountId !== inLegs[0].accountId) {
    return { source: outLegs[0], destination: inLegs[0] };
  }
  if (outLegs.length > 0 || inLegs.length > 0) {
    return { ambiguous: true };
  }

  const candidates = group
    .map((event) => ({ event, bucket: bucketFor(ledgers, event) }))
    .filter(({ event, bucket }) => totalRaw(bucket.lots) >= event.rawAmount);
  if (candidates.length !== 1) {
    return {};
  }

  const source = candidates[0];
  const destination = group.find((event) => event.accountId !== source.event.accountId);
  if (destination === undefined) {
    return {};
  }
  return { source: source.event, destination };
}

function moveSelfTransfer(
  group: readonly IndexedEvent[],
  ledgers: Map<string, LedgerBucket>,
  strategy: LotSelectionStrategy,
  excludedLedgerKeys: Set<string>,
  warnings: string[],
): void {
  if (group.length !== 2) {
    warnings.push(`unpaired_self_transfer:${group[0]?.txid ?? 'unknown'}: expected exactly two account events`);
    return;
  }

  const ends = resolveSelfTransferEnds(group, ledgers);
  if (ends.ambiguous === true) {
    warnings.push(`unpaired_self_transfer:${group[0].txid}: ambiguous self-transfer legs`);
    return;
  }
  if (ends.source === undefined || ends.destination === undefined) {
    warnings.push(`unpaired_self_transfer:${group[0].txid}: could not identify source and destination accounts`);
    return;
  }

  if (excludedLedgerKeys.has(ledgerKey(ends.source))) {
    warnings.push(`unpaired_self_transfer:${ends.source.txid}: source ledger has excluded events`);
    return;
  }

  const sourceBucket = bucketFor(ledgers, ends.source);
  const selected = strategy.selectLots(sourceBucket.lots, ends.source.rawAmount);
  if (totalRaw(selected) < ends.source.rawAmount) {
    warnings.push(`unpaired_self_transfer:${ends.source.txid}: insufficient source lots to move`);
    return;
  }

  const moved = consumeLots(sourceBucket.lots, selected, ends.source.rawAmount).movedLots;
  const destination = ends.destination;
  const destinationBucket = bucketFor(ledgers, destination);
  destinationBucket.lots.push(
    ...moved.map((lot) => ({
      ...lot,
      lotId: `${lot.lotId}->${destinationBucket.accountId}:${destination.txid}`,
      accountId: destinationBucket.accountId,
    })),
  );
}

export async function computePnl(
  events: readonly PnlEvent[],
  opts: ComputePnlOptions,
): Promise<PnlReport> {
  const strategy = opts.strategy ?? new FifoStrategy();
  const warnings: string[] = [];
  const realizedRows: RealizedRow[] = [];
  const ledgers = new Map<string, LedgerBucket>();
  const excludedLedgerKeys = new Set<string>();
  const indexed = events.map((event, index) => ({ ...event, index }));
  const ordered = [...indexed].sort((a, b) => {
    if (a.date === undefined && b.date === undefined) {
      return a.index - b.index;
    }
    if (a.date === undefined) {
      return -1;
    }
    if (b.date === undefined) {
      return 1;
    }
    return a.date === b.date ? a.index - b.index : a.date.localeCompare(b.date);
  });
  const selfTransferGroups = groupSelfTransfers(ordered);
  const processedSelfTransfers = new Set<string>();

  for (const event of ordered) {
    if (event.direction === 'unknown') {
      excludedLedgerKeys.add(ledgerKey(event));
      warnings.push(`unknown:${event.txid}: excluded unknown direction`);
      continue;
    }
    if (event.date === undefined) {
      if (event.direction === 'in' || event.direction === 'out') {
        excludedLedgerKeys.add(ledgerKey(event));
      }
      warnings.push(`undated:${event.txid}: ${event.chain}/${event.symbol} has no confirmed UTC date`);
      continue;
    }
    if (event.direction === 'self') {
      const key = selfTransferKey(event);
      if (processedSelfTransfers.has(key)) {
        continue;
      }
      const group = selfTransferGroups.get(key);
      if (group === undefined || group.length !== 2) {
        warnings.push(`unpaired_self_transfer:${event.txid}: no matching account event`);
      } else {
        moveSelfTransfer(group, ledgers, strategy, excludedLedgerKeys, warnings);
      }
      processedSelfTransfers.add(key);
      continue;
    }

    const declaredSource = event.source ?? (event.declaredUnitBasisUsd === undefined ? 'chain' : 'manual');
    const price =
      event.direction === 'in' && event.declaredUnitBasisUsd !== undefined
        ? event.declaredUnitBasisUsd
        : await historicalUsd(event, opts.priceProvider, warnings);
    if (price === undefined) {
      excludedLedgerKeys.add(ledgerKey(event));
      continue;
    }

    const bucket = bucketFor(ledgers, event);
    if (event.direction === 'in') {
      bucket.lots.push({
        lotId: `${event.accountId}:${event.txid}:${bucket.lots.length}`,
        accountId: event.accountId,
        chain: event.chain,
        symbol: event.symbol,
        rawAmount: event.rawAmount,
        decimals: event.decimals,
        acquiredDate: event.date,
        acquisitionTxid: event.txid,
        unitBasisUsd: price,
        source: declaredSource,
      });
      continue;
    }

    const selected = strategy.selectLots(bucket.lots, event.rawAmount);
    if (totalRaw(selected) < event.rawAmount) {
      warnings.push(`insufficient_lots:${event.txid}: not enough ${event.symbol} basis in ${event.accountId}`);
      continue;
    }

    const { consumed, basisUsd } = consumeLots(bucket.lots, selected, event.rawAmount);
    const proceedsUsd = qty(event.rawAmount, event.decimals) * price;
    realizedRows.push({
      date: event.date,
      accountId: event.accountId,
      chain: event.chain,
      symbol: event.symbol,
      qty: qty(event.rawAmount, event.decimals),
      proceedsUsd,
      basisUsd,
      gainUsd: proceedsUsd - basisUsd,
      disposalTxid: event.txid,
      consumedLots: consumed,
    });
  }

  const openLots = [...ledgers.values()].flatMap((bucket) => bucket.lots.map((lot) => ({ ...lot })));
  const totalsByAccountMap = new Map<string, AccountTotals>();
  const totalsByAssetMap = new Map<string, AssetTotals>();
  const aggregateTotals = emptyTotals();

  for (const row of realizedRows) {
    const delta = {
      proceedsUsd: row.proceedsUsd,
      basisUsd: row.basisUsd,
      realizedGainUsd: row.gainUsd,
    };
    const account = totalsByAccountMap.get(row.accountId) ?? { accountId: row.accountId, ...emptyTotals() };
    addTotals(account, delta);
    totalsByAccountMap.set(row.accountId, account);

    const key = assetKey(row);
    const asset = totalsByAssetMap.get(key) ?? { chain: row.chain, symbol: row.symbol, ...emptyTotals() };
    addTotals(asset, delta);
    totalsByAssetMap.set(key, asset);
    addTotals(aggregateTotals, delta);
  }

  for (const lot of openLots) {
    const coingeckoId = coingeckoIdFor(lot);
    const openBasisUsd = basisFor(lot.rawAmount, lot.decimals, lot.unitBasisUsd);
    const current = coingeckoId === undefined ? undefined : opts.currentUsdPrice(coingeckoId);
    const account = totalsByAccountMap.get(lot.accountId) ?? { accountId: lot.accountId, ...emptyTotals() };
    const key = assetKey(lot);
    const asset = totalsByAssetMap.get(key) ?? { chain: lot.chain, symbol: lot.symbol, ...emptyTotals() };
    const basisDelta = { openBasisUsd };
    addTotals(account, basisDelta);
    addTotals(asset, basisDelta);
    addTotals(aggregateTotals, basisDelta);

    if (current === undefined) {
      warnings.push(
        `unpriceable_current:${lot.acquisitionTxid}: no current USD price for ${lot.chain}/${lot.symbol}`,
      );
      totalsByAccountMap.set(lot.accountId, account);
      totalsByAssetMap.set(key, asset);
      continue;
    }
    const openMarketValueUsd = qty(lot.rawAmount, lot.decimals) * current;
    const delta = {
      openMarketValueUsd,
      unrealizedGainUsd: openMarketValueUsd - openBasisUsd,
    };
    addTotals(account, delta);
    totalsByAccountMap.set(lot.accountId, account);
    addTotals(asset, delta);
    totalsByAssetMap.set(key, asset);
    addTotals(aggregateTotals, delta);
  }

  return {
    method: strategy.method,
    realizedRows,
    openLots,
    totalsByAccount: [...totalsByAccountMap.values()].sort((a, b) =>
      a.accountId.localeCompare(b.accountId),
    ),
    totalsByAsset: [...totalsByAssetMap.values()].sort((a, b) =>
      a.chain === b.chain ? a.symbol.localeCompare(b.symbol) : a.chain.localeCompare(b.chain),
    ),
    aggregateTotals,
    warnings,
  };
}

import type { HistoricalPriceProvider } from '../adapters/chain-adapter.js';
import type { OpeningBalancesConfig, OpeningLot, BasisOverrideAdjustment } from '../config/load.js';
import { formatUnits } from '../core/money.js';
import type { AccountDescriptor } from '../domain/account.js';
import type { UtcDateString } from '../domain/historical-price.js';
import type { HistoryOptions } from '../domain/types.js';
import type { PortfolioService } from '../services/portfolio-service.js';
import {
  computePnl,
  txToPnlEvents,
  type AccountTotals,
  type AssetTotals,
  type PnlEvent,
  type PnlReport,
  type PnlTotals,
  type RealizedRow,
} from './pnl.js';

export interface AccountScopedPnlOptions {
  priceProvider: HistoricalPriceProvider;
  currentUsdPrice(coingeckoId: string): number | undefined;
  from?: UtcDateString;
  to?: UtcDateString;
  limit?: number;
  openingBalances?: OpeningBalancesConfig;
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

function applyRealized(target: PnlTotals, row: RealizedRow, sign: 1 | -1): void {
  target.proceedsUsd += sign * row.proceedsUsd;
  target.basisUsd += sign * row.basisUsd;
  target.realizedGainUsd += sign * row.gainUsd;
}

function accountTotals(map: Map<string, AccountTotals>, accountId: string): AccountTotals {
  let totals = map.get(accountId);
  if (totals === undefined) {
    totals = { accountId, ...emptyTotals() };
    map.set(accountId, totals);
  }
  return totals;
}

function assetTotals(map: Map<string, AssetTotals>, row: RealizedRow): AssetTotals {
  const key = `${row.chain}:${row.symbol}`;
  let totals = map.get(key);
  if (totals === undefined) {
    totals = { chain: row.chain, symbol: row.symbol, ...emptyTotals() };
    map.set(key, totals);
  }
  return totals;
}

function withFilteredRealizedRows(
  report: PnlReport,
  predicate: (row: RealizedRow) => boolean,
): PnlReport {
  const filtered = report.realizedRows.filter(predicate);
  if (filtered.length === report.realizedRows.length) {
    return report;
  }

  const totalsByAccount = new Map(report.totalsByAccount.map((entry) => [entry.accountId, { ...entry }]));
  const totalsByAsset = new Map(
    report.totalsByAsset.map((entry) => [`${entry.chain}:${entry.symbol}`, { ...entry }]),
  );
  const aggregateTotals = { ...report.aggregateTotals };

  for (const row of report.realizedRows) {
    applyRealized(accountTotals(totalsByAccount, row.accountId), row, -1);
    applyRealized(assetTotals(totalsByAsset, row), row, -1);
    applyRealized(aggregateTotals, row, -1);
  }
  for (const row of filtered) {
    applyRealized(accountTotals(totalsByAccount, row.accountId), row, 1);
    applyRealized(assetTotals(totalsByAsset, row), row, 1);
    applyRealized(aggregateTotals, row, 1);
  }

  return {
    ...report,
    realizedRows: filtered,
    totalsByAccount: [...totalsByAccount.values()].sort((a, b) =>
      a.accountId.localeCompare(b.accountId),
    ),
    totalsByAsset: [...totalsByAsset.values()].sort((a, b) =>
      a.chain === b.chain ? a.symbol.localeCompare(b.symbol) : a.chain.localeCompare(b.chain),
    ),
    aggregateTotals,
  };
}

function addressKey(account: AccountDescriptor, address: string): string {
  return `${account.family}:${address.toLowerCase()}`;
}

function duplicateAddressWarnings(accounts: readonly AccountDescriptor[]): string[] {
  const seen = new Map<string, { accountId: string; address: string }>();
  const warnings: string[] = [];
  for (const account of accounts) {
    if (account.source.kind !== 'addresses') {
      continue;
    }
    for (const address of account.source.addresses) {
      const key = addressKey(account, address);
      const prior = seen.get(key);
      if (prior === undefined) {
        seen.set(key, { accountId: account.id, address });
        continue;
      }
      warnings.push(
        `duplicate_account_address:${account.id}: ${address} also appears in account ${prior.accountId}`,
      );
    }
  }
  return warnings;
}

function manualUnitBasis(rawAmount: bigint, decimals: number, totalBasisUsd: number): number {
  return totalBasisUsd / Number(formatUnits(rawAmount, decimals));
}

function eventKey(event: Pick<PnlEvent, 'accountId' | 'chain' | 'symbol'>): string {
  return `${event.accountId}:${event.chain}:${event.symbol}`;
}

function openingLotKey(lot: Pick<OpeningLot, 'accountId' | 'chain' | 'symbol'>): string {
  return `${lot.accountId}:${lot.chain}:${lot.symbol}`;
}

function openingLotToEvent(lot: OpeningLot): PnlEvent {
  return {
    accountId: lot.accountId,
    chain: lot.chain,
    symbol: lot.symbol,
    direction: 'in',
    rawAmount: lot.rawAmount,
    decimals: lot.decimals,
    date: lot.acquiredDate,
    txid: `manual:${lot.id}`,
    declaredUnitBasisUsd: manualUnitBasis(lot.rawAmount, lot.decimals, lot.totalBasisUsd),
    source: 'manual',
  };
}

function applyBasisOverrides(
  events: PnlEvent[],
  adjustments: readonly BasisOverrideAdjustment[],
): string[] {
  const warnings: string[] = [];
  for (const adjustment of adjustments) {
    const match = events.find(
      (event) =>
        event.direction === 'in' &&
        event.accountId === adjustment.accountId &&
        event.chain === adjustment.chain &&
        event.symbol === adjustment.symbol &&
        event.txid === adjustment.txid,
    );
    if (match === undefined) {
      warnings.push(`basis_override_no_match:${adjustment.txid}: no visible inbound event matched`);
      continue;
    }
    match.declaredUnitBasisUsd =
      adjustment.unitBasisUsd ??
      manualUnitBasis(match.rawAmount, match.decimals, adjustment.totalBasisUsd ?? 0);
    match.source = 'override';
  }
  return warnings;
}

function openingOverlapWarnings(
  openingLots: readonly OpeningLot[],
  visibleEvents: readonly PnlEvent[],
): string[] {
  const earliestVisibleIn = new Map<string, UtcDateString>();
  for (const event of visibleEvents) {
    if (event.direction !== 'in' || event.date === undefined) {
      continue;
    }
    const key = eventKey(event);
    const prior = earliestVisibleIn.get(key);
    if (prior === undefined || event.date < prior) {
      earliestVisibleIn.set(key, event.date);
    }
  }

  const warnings: string[] = [];
  for (const lot of openingLots) {
    const earliest = earliestVisibleIn.get(openingLotKey(lot));
    if (earliest !== undefined && lot.acquiredDate >= earliest) {
      warnings.push(
        `opening_balance_overlap:${lot.id}: opening lot date ${lot.acquiredDate} is on/after visible inbound ${earliest}`,
      );
    }
  }
  return warnings;
}

export async function computeAccountScopedPnl(
  service: PortfolioService,
  accounts: readonly AccountDescriptor[],
  opts: AccountScopedPnlOptions,
): Promise<PnlReport> {
  const warnings = duplicateAddressWarnings(accounts);
  const visibleEvents: PnlEvent[] = [];
  const historyOpts: HistoryOptions = opts.limit === undefined ? {} : { limit: opts.limit };

  for (const account of accounts) {
    // Provider-side pageKey pagination is out of scope; each provider fetches up
    // to limit and this layer preserves the cross-account merge contract.
    const txs = await service.getHistory([account], historyOpts);
    visibleEvents.push(...txToPnlEvents(txs, account.id));
  }

  const openingBalances = opts.openingBalances ?? { openingLots: [], adjustments: [] };
  warnings.push(...applyBasisOverrides(visibleEvents, openingBalances.adjustments));
  warnings.push(...openingOverlapWarnings(openingBalances.openingLots, visibleEvents));
  const events = [...openingBalances.openingLots.map(openingLotToEvent), ...visibleEvents];

  if (opts.limit !== undefined) {
    warnings.push(`history_limited:all: limit ${opts.limit} may omit older acquisitions and skew basis`);
  }

  const report = await computePnl(events, {
    priceProvider: opts.priceProvider,
    currentUsdPrice: opts.currentUsdPrice,
  });
  const ranged = withFilteredRealizedRows(report, (row) => {
    if (opts.from !== undefined && row.date < opts.from) {
      return false;
    }
    if (opts.to !== undefined && row.date > opts.to) {
      return false;
    }
    return true;
  });

  return { ...ranged, warnings: [...ranged.warnings, ...warnings] };
}

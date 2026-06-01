import type { HistoricalPriceProvider } from '../adapters/chain-adapter.js';
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

export async function computeAccountScopedPnl(
  service: PortfolioService,
  accounts: readonly AccountDescriptor[],
  opts: AccountScopedPnlOptions,
): Promise<PnlReport> {
  const warnings = duplicateAddressWarnings(accounts);
  const events: PnlEvent[] = [];
  const historyOpts: HistoryOptions = opts.limit === undefined ? {} : { limit: opts.limit };

  for (const account of accounts) {
    // Provider-side pageKey pagination is out of scope; each provider fetches up
    // to limit and this layer preserves the cross-account merge contract.
    const txs = await service.getHistory([account], historyOpts);
    events.push(...txToPnlEvents(txs, account.id));
  }

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

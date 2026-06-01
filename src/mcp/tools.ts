import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { mergeHistoryRows, type PortfolioService } from '../services/portfolio-service.js';
import type { AccountDescriptor } from '../domain/account.js';
import type { AssetSymbol } from '../domain/assets.js';
import type { Chain } from '../domain/chains.js';
import { assertUtcDateString } from '../domain/historical-price.js';
import { assertTxCategory, txCategorySchema } from '../domain/categories.js';
import type { Tx } from '../domain/types.js';
import type { CacheStore } from '../db/cache-store.js';
import { categorizeTransactions, type CategorizedTx } from '../core/tx-category.js';
import type { HistoricalPriceProvider } from '../adapters/chain-adapter.js';
import type { OpeningBalancesConfig } from '../config/load.js';
import { pnlReportToCsvBundle, writePnlCsvBundle } from '../reporting/csv-export.js';
import { computeAccountScopedPnl } from '../reporting/pnl-report.js';
import {
  diffReconRecords,
  loadReconRecords,
  realizedRowsToReconRecords,
  writeReconArtifacts,
} from '../reporting/reconcile.js';
import { writeArtifactFile } from './artifact-file.js';

type ToolResult = { content: { type: 'text'; text: string }[] };

const asText = (text: string): ToolResult => ({
  content: [{ type: 'text', text }],
});

export interface PnlExportDependencies {
  priceProvider: HistoricalPriceProvider;
  currentUsdPrice(coingeckoId: string): number | undefined;
  openingBalances?: OpeningBalancesConfig;
  outputDir?: string;
}

function selectAccounts(accounts: AccountDescriptor[], ids?: string[]): AccountDescriptor[] {
  if (ids === undefined) {
    return accounts;
  }
  const requested = new Set(ids);
  const selected = accounts.filter((account) => requested.has(account.id));
  const found = new Set(selected.map((account) => account.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(`Unknown account id(s): ${missing.join(', ')}`);
  }
  return selected;
}

export function buildHandlers(
  service: PortfolioService,
  accounts: AccountDescriptor[],
  store?: CacheStore,
  pnlExport?: PnlExportDependencies,
) {
  return {
    get_portfolio: async (): Promise<ToolResult> => {
      const view = await service.getPortfolio(accounts);
      return asText(JSON.stringify(view, null, 2));
    },

    list_addresses: async (): Promise<ToolResult> => {
      const addresses = await service.listAddresses(accounts);
      const enriched =
        store === undefined
          ? addresses
          : await Promise.all(
              addresses.map(async (addr) => {
                const label = await store.getLabel(addr.chain, addr.address);
                return label === undefined ? addr : { ...addr, label };
              }),
            );
      return asText(JSON.stringify(enriched, null, 2));
    },

    derive_receive_address: async (args: {
      accountId: string;
      index?: number;
    }): Promise<ToolResult> => {
      const receive = await service.getReceiveAddress(accounts, args.accountId, args.index);
      return asText(JSON.stringify(receive, null, 2));
    },

    get_history: async (args: { limit?: number }): Promise<ToolResult> => {
      const historyOpts = { limit: args.limit };
      // Single provider fetch; merge matches PortfolioService.getHistory for PnL parity.
      const swapDetectionRows = await service.collectHistoryRows(accounts, historyOpts);
      const txs = mergeHistoryRows(swapDetectionRows, historyOpts);
      const categorized = categorizeTransactions(
        txs,
        await store?.getTxCategoryOverrides(),
        swapDetectionRows,
      );
      const safe = categorized.map((tx: CategorizedTx) => ({
        ...tx,
        raw: tx.raw.toString(),
      }));
      return asText(JSON.stringify(safe, null, 2));
    },

    set_tx_category_override: async (args: {
      chain: Chain;
      txid: string;
      symbol: AssetSymbol;
      category: string;
      note?: string;
    }): Promise<ToolResult> => {
      if (store === undefined) {
        throw new Error('Category overrides require a configured cache store (DATABASE_URL or local SQLite).');
      }
      const category = assertTxCategory(args.category);
      await store.setTxCategoryOverride({
        chain: args.chain,
        txid: args.txid,
        symbol: args.symbol,
        category,
        note: args.note,
      });
      return asText(
        JSON.stringify(
          {
            chain: args.chain,
            txid: args.txid,
            symbol: args.symbol,
            category,
            note: args.note,
          },
          null,
          2,
        ),
      );
    },

    clear_tx_category_override: async (args: {
      chain: Chain;
      txid: string;
      symbol: AssetSymbol;
    }): Promise<ToolResult> => {
      if (store === undefined) {
        throw new Error('Category overrides require a configured cache store (DATABASE_URL or local SQLite).');
      }
      await store.clearTxCategoryOverride(args.chain, args.txid, args.symbol);
      return asText(
        JSON.stringify(
          { chain: args.chain, txid: args.txid, symbol: args.symbol, cleared: true },
          null,
          2,
        ),
      );
    },

    prepare_transfer: async (args: {
      accountId: string;
      to: string;
      asset: AssetSymbol;
      amount: string;
      chain?: Chain;
      feeRate?: string;
    }): Promise<ToolResult> => {
      const artifact = await service.prepareTransfer(accounts, args);
      const file = writeArtifactFile(artifact, `${Date.now()}`);
      return asText(JSON.stringify({ ...artifact, file }, null, 2));
    },

    export_pnl: async (args: {
      accountIds?: string[];
      from?: string;
      to?: string;
      limit?: number;
    }): Promise<ToolResult> => {
      if (pnlExport === undefined) {
        throw new Error('PnL export is not configured.');
      }
      const selected = selectAccounts(accounts, args.accountIds);
      const report = await computeAccountScopedPnl(service, selected, {
        priceProvider: pnlExport.priceProvider,
        currentUsdPrice: pnlExport.currentUsdPrice,
        openingBalances: pnlExport.openingBalances,
        from: args.from === undefined ? undefined : assertUtcDateString(args.from),
        to: args.to === undefined ? undefined : assertUtcDateString(args.to),
        limit: args.limit,
      });
      const bundle = pnlReportToCsvBundle(report);
      const files = writePnlCsvBundle(bundle, `${Date.now()}`, pnlExport.outputDir);
      return asText(
        JSON.stringify(
          {
            files,
            aggregateTotals: report.aggregateTotals,
            warnings: report.warnings,
          },
          null,
          2,
        ),
      );
    },

    reconcile: async (args: {
      externalPath: string;
      accountIds?: string[];
      from?: string;
      to?: string;
      usdToleranceUsd?: number;
    }): Promise<ToolResult> => {
      if (pnlExport === undefined) {
        throw new Error('PnL export is not configured.');
      }
      const selected = selectAccounts(accounts, args.accountIds);
      const report = await computeAccountScopedPnl(service, selected, {
        priceProvider: pnlExport.priceProvider,
        currentUsdPrice: pnlExport.currentUsdPrice,
        openingBalances: pnlExport.openingBalances,
        from: args.from === undefined ? undefined : assertUtcDateString(args.from),
        to: args.to === undefined ? undefined : assertUtcDateString(args.to),
      });
      const external = loadReconRecords(args.externalPath);
      const diff = diffReconRecords(realizedRowsToReconRecords(report), external.records, {
        usdToleranceUsd: args.usdToleranceUsd,
        invalidExternalRows: external.invalidExternalRows,
      });
      const files = writeReconArtifacts(diff, `${Date.now()}`, pnlExport.outputDir);
      return asText(JSON.stringify({ files, summary: diff.summary }, null, 2));
    },
  };
}

export function buildTools(
  service: PortfolioService,
  accounts: AccountDescriptor[],
  store?: CacheStore,
  pnlExport?: PnlExportDependencies,
) {
  const handlers = buildHandlers(service, accounts, store, pnlExport);

  return [
    tool(
      'get_portfolio',
      'Return the watch-only USD portfolio view across all configured accounts. Read-only; never signs.',
      {},
      async () => handlers.get_portfolio(),
    ),
    tool(
      'list_addresses',
      'List the derived/watched addresses for all configured accounts. Read-only; reveals only public addresses.',
      {},
      async () => handlers.list_addresses(),
    ),
    tool(
      'derive_receive_address',
      'Derive a receive address for an account. Watch-only: returns a public address with an on-device verification note.',
      { accountId: z.string(), index: z.number().optional() },
      async (args) => handlers.derive_receive_address(args),
    ),
    tool(
      'get_history',
      'Return recent transactions across all configured accounts. Raw bigint amounts are serialized as decimal strings.',
      { limit: z.number().optional() },
      async (args) => handlers.get_history(args),
    ),
    tool(
      'prepare_transfer',
      'Construct an UNSIGNED transaction for an external signer, write it to a local file, and return a human-readable summary to verify on your signing device. coinwatch NEVER signs or broadcasts.',
      {
        accountId: z.string(),
        to: z.string(),
        asset: z.string(),
        amount: z.string(),
        chain: z.string().optional(),
        feeRate: z.string().optional(),
      },
      async (args) =>
        handlers.prepare_transfer(
          args as {
            accountId: string;
            to: string;
            asset: AssetSymbol;
            amount: string;
            chain?: Chain;
            feeRate?: string;
          },
        ),
    ),
    tool(
      'export_pnl',
      'Export the computed watch-only FIFO PnL report to local CSV files. Read-only; never signs or broadcasts.',
      {
        accountIds: z.array(z.string()).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().optional(),
      },
      async (args) =>
        handlers.export_pnl(
          args as {
            accountIds?: string[];
            from?: string;
            to?: string;
            limit?: number;
          },
        ),
    ),
    tool(
      'reconcile',
      'Compare coinwatch realized PnL disposals against a generic external JSON/CSV export and write diff artifacts. Read-only; never writes back to any bookkeeping system.',
      {
        externalPath: z.string(),
        accountIds: z.array(z.string()).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        usdToleranceUsd: z.number().optional(),
      },
      async (args) =>
        handlers.reconcile(
          args as {
            externalPath: string;
            accountIds?: string[];
            from?: string;
            to?: string;
            usdToleranceUsd?: number;
          },
        ),
    ),
    tool(
      'set_tx_category_override',
      'Persist a manual transaction category override in the local coinwatch.db. Does not change PnL math; only affects categorized history output.',
      {
        chain: z.string(),
        txid: z.string(),
        symbol: z.string(),
        category: txCategorySchema,
        note: z.string().optional(),
      },
      async (args) =>
        handlers.set_tx_category_override(
          args as {
            chain: Chain;
            txid: string;
            symbol: AssetSymbol;
            category: string;
            note?: string;
          },
        ),
    ),
    tool(
      'clear_tx_category_override',
      'Remove a manual transaction category override from the local coinwatch.db.',
      {
        chain: z.string(),
        txid: z.string(),
        symbol: z.string(),
      },
      async (args) =>
        handlers.clear_tx_category_override(
          args as { chain: Chain; txid: string; symbol: AssetSymbol },
        ),
    ),
  ];
}

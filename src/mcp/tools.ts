import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { PortfolioService } from '../services/portfolio-service.js';
import type { AccountDescriptor } from '../domain/account.js';
import type { AssetSymbol } from '../domain/assets.js';
import type { Chain } from '../domain/chains.js';
import type { Tx } from '../domain/types.js';
import type { Store } from '../db/store.js';
import { writeArtifactFile } from './artifact-file.js';

type ToolResult = { content: { type: 'text'; text: string }[] };

const asText = (text: string): ToolResult => ({
  content: [{ type: 'text', text }],
});

export function buildHandlers(
  service: PortfolioService,
  accounts: AccountDescriptor[],
  store?: Store,
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
          : addresses.map((addr) => {
              const label = store.getLabel(addr.chain, addr.address);
              return label === undefined ? addr : { ...addr, label };
            });
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
      // Caching is owned by PortfolioService.getHistory (single write-through path);
      // the store is used here only for list_addresses labels.
      const txs = await service.getHistory(accounts, { limit: args.limit });
      const safe = txs.map((tx: Tx) => ({ ...tx, raw: tx.raw.toString() }));
      return asText(JSON.stringify(safe, null, 2));
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
  };
}

export function buildTools(
  service: PortfolioService,
  accounts: AccountDescriptor[],
  store?: Store,
) {
  const handlers = buildHandlers(service, accounts, store);

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
  ];
}

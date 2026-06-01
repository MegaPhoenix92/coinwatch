#!/usr/bin/env node
import { query, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import type { ChainAdapter } from './adapters/chain-adapter.js';
import { BitcoinAdapter } from './adapters/bitcoin-adapter.js';
import { EvmAdapter } from './adapters/evm-adapter.js';
import { SolanaAdapter } from './adapters/solana-adapter.js';
import {
  parseConfigCommand,
  runConfigTemplate,
  runConfigValidate,
} from './cli/config-commands.js';
import { parseRegistryCommand, runRegistryVerify } from './cli/registry-commands.js';
import { loadAccounts, loadEnv, loadOpeningBalances } from './config/load.js';
import { loadProviderEndpoints, resolveSolanaRpcUrl } from './config/provider-endpoints.js';
import {
  DEFAULT_ACCOUNTS_PATH,
  DEFAULT_OPENING_BALANCES_PATH,
} from './config/paths.js';
import { openStore } from './db/open-store.js';
import type { CacheStore } from './db/cache-store.js';
import { allCoingeckoIds } from './domain/assets.js';
import type { ChainFamily } from './domain/chains.js';
import { buildServer } from './mcp/server.js';
import { buildHandlers } from './mcp/tools.js';
import { CoinGeckoPriceProvider } from './providers/coingecko.js';
import {
  CachingHistoricalPriceProvider,
  CoinGeckoHistoricalPriceProvider,
} from './providers/coingecko-historical.js';
import { MempoolProvider } from './providers/mempool.js';
import { createSolanaKitProvider } from './providers/solana-kit.js';
import { ViemProvider } from './providers/viem.js';
import { log } from './core/logger.js';
import { PortfolioService } from './services/portfolio-service.js';

export const SYSTEM_PROMPT = [
  'You are coinwatch, a strictly watch-only crypto portfolio analyst.',
  'You inspect balances, valuations, receive addresses, and transaction history through the coinwatch MCP tools ONLY.',
  'You NEVER move, send, sign, or spend funds, and you hold no private keys.',
  'If asked to transfer, sign, or broadcast anything, refuse and explain that coinwatch is read-only.',
  'Use only the available mcp__coinwatch__* tools to answer portfolio questions.',
  'Be concise. Report USD figures with source caveats because prices are best-effort.',
].join(' ');

type McpServers = NonNullable<Options['mcpServers']>;
type CoinwatchServer = McpServers[string];

interface ExportPnlCommand {
  accountIds?: string[];
  from?: string;
  to?: string;
  limit?: number;
}

interface ReconcileCommand {
  externalPath: string;
  accountIds?: string[];
  from?: string;
  to?: string;
  usdToleranceUsd?: number;
}

export function buildQueryOptions(server: CoinwatchServer): Options {
  return {
    model: 'claude-opus-4-8',
    systemPrompt: SYSTEM_PROMPT,
    mcpServers: { coinwatch: server },
    tools: [],
    allowedTools: ['mcp__coinwatch__*'],
    settingSources: [],
    permissionMode: 'default',
  };
}

export function parseExportPnlCommand(argv: readonly string[]): ExportPnlCommand | undefined {
  if (argv[0] !== 'export-pnl') {
    return undefined;
  }

  const command: ExportPnlCommand = {};
  const accountIds: string[] = [];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === '--account' || arg === '--account-id') && next !== undefined) {
      accountIds.push(next);
      i += 1;
    } else if (arg === '--from' && next !== undefined) {
      command.from = next;
      i += 1;
    } else if (arg === '--to' && next !== undefined) {
      command.to = next;
      i += 1;
    } else if (arg === '--limit' && next !== undefined) {
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit "${next}": expected a positive integer.`);
      }
      command.limit = parsed;
      i += 1;
    } else {
      throw new Error(`Unknown export-pnl argument: ${arg}`);
    }
  }
  if (accountIds.length > 0) {
    command.accountIds = accountIds;
  }
  return command;
}

export function parseReconcileCommand(argv: readonly string[]): ReconcileCommand | undefined {
  if (argv[0] !== 'reconcile') {
    return undefined;
  }

  const command: Partial<ReconcileCommand> = {};
  const accountIds: string[] = [];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--external' && next !== undefined) {
      command.externalPath = next;
      i += 1;
    } else if ((arg === '--account' || arg === '--account-id') && next !== undefined) {
      accountIds.push(next);
      i += 1;
    } else if (arg === '--from' && next !== undefined) {
      command.from = next;
      i += 1;
    } else if (arg === '--to' && next !== undefined) {
      command.to = next;
      i += 1;
    } else if (arg === '--usd-tolerance' && next !== undefined) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid --usd-tolerance "${next}": expected a non-negative number.`);
      }
      command.usdToleranceUsd = parsed;
      i += 1;
    } else {
      throw new Error(`Unknown reconcile argument: ${arg}`);
    }
  }
  if (command.externalPath === undefined) {
    throw new Error('reconcile requires --external <path>.');
  }
  if (accountIds.length > 0) {
    command.accountIds = accountIds;
  }
  return command as ReconcileCommand;
}

export async function* userMessages(): AsyncGenerator<SDKUserMessage> {
  const rl = createInterface({ input, output });
  try {
    output.write('coinwatch (watch-only). Ask about your portfolio. Type "exit" to quit.\n');
    for (;;) {
      const line = (await rl.question('> ')).trim();
      if (line === 'exit' || line === 'quit') return;
      if (line.length === 0) continue;

      yield {
        type: 'user',
        parent_tool_use_id: null,
        message: { role: 'user', content: line },
      };
    }
  } finally {
    rl.close();
  }
}

export async function main(): Promise<void> {
  const registryCommand = parseRegistryCommand(process.argv.slice(2));
  if (registryCommand !== undefined) {
    if (!runRegistryVerify(registryCommand)) {
      process.exitCode = 1;
    }
    return;
  }

  const configCommand = parseConfigCommand(process.argv.slice(2));
  if (configCommand !== undefined) {
    if (configCommand.kind === 'validate') {
      if (!runConfigValidate(configCommand)) {
        process.exitCode = 1;
      }
      return;
    }
    runConfigTemplate(configCommand);
    return;
  }

  const env = loadEnv();
  const providerEndpoints = loadProviderEndpoints();
  const accounts = loadAccounts(DEFAULT_ACCOUNTS_PATH);
  const openingBalances = loadOpeningBalances(DEFAULT_OPENING_BALANCES_PATH, accounts);

  const adapters = new Map<ChainFamily, ChainAdapter>();
  adapters.set(
    'bitcoin',
    new BitcoinAdapter(new MempoolProvider(providerEndpoints.mempoolApiBase)),
  );
  adapters.set(
    'evm',
    new EvmAdapter(
      new ViemProvider({
        alchemyApiKey: env.alchemyApiKey,
        rpcUrls: providerEndpoints.evmRpcUrls,
      }),
    ),
  );
  adapters.set(
    'solana',
    new SolanaAdapter(
      createSolanaKitProvider(resolveSolanaRpcUrl(providerEndpoints, env.heliusApiKey)),
    ),
  );

  const prices = new CoinGeckoPriceProvider({ apiKey: env.coingeckoApiKey });
  const store: CacheStore = await openStore();

  try {
    const historicalPrices = new CachingHistoricalPriceProvider(
      new CoinGeckoHistoricalPriceProvider({ apiKey: env.coingeckoApiKey }),
      store,
    );
    const currentPrices = await prices.getUsdPrices(allCoingeckoIds());
    const pnlExport = {
      priceProvider: historicalPrices,
      currentUsdPrice: (coingeckoId: string) => currentPrices.get(coingeckoId),
      openingBalances,
    };
    // Single cache owner: PortfolioService write-through caches tx history.
    // The tools layer also receives the store, but only for address labels.
    const service = new PortfolioService(adapters, prices, store);
    const server = buildServer(service, accounts, store, pnlExport);
    const exportCommand = parseExportPnlCommand(process.argv.slice(2));
    if (exportCommand !== undefined) {
      const handlers = buildHandlers(service, accounts, store, pnlExport);
      const result = await handlers.export_pnl(exportCommand);
      output.write(`${result.content[0].text}\n`);
      return;
    }
    const reconcileCommand = parseReconcileCommand(process.argv.slice(2));
    if (reconcileCommand !== undefined) {
      const handlers = buildHandlers(service, accounts, store, pnlExport);
      const result = await handlers.reconcile(reconcileCommand);
      output.write(`${result.content[0].text}\n`);
      return;
    }

    for await (const msg of query({
      prompt: userMessages(),
      options: buildQueryOptions(server),
    })) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            output.write(`${block.text}\n`);
          }
        }
      } else if (msg.type === 'result') {
        output.write(`[coinwatch] result: ${msg.subtype}\n`);
      }
    }
  } finally {
    await store.close();
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    log.error('fatal', { error });
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
import { query, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import type { ChainAdapter } from './adapters/chain-adapter.js';
import { BitcoinAdapter } from './adapters/bitcoin-adapter.js';
import { loadAccounts, loadEnv } from './config/load.js';
import type { ChainFamily } from './domain/chains.js';
import { buildServer } from './mcp/server.js';
import { CoinGeckoPriceProvider } from './providers/coingecko.js';
import { MempoolProvider } from './providers/mempool.js';
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
  const env = loadEnv();
  const accounts = loadAccounts('config/accounts.local.json');

  const adapters = new Map<ChainFamily, ChainAdapter>();
  adapters.set('bitcoin', new BitcoinAdapter(new MempoolProvider()));

  const prices = new CoinGeckoPriceProvider({ apiKey: env.coingeckoApiKey });
  const service = new PortfolioService(adapters, prices);
  const server = buildServer(service, accounts);

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
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[coinwatch] fatal: ${message}`);
    process.exitCode = 1;
  });
}

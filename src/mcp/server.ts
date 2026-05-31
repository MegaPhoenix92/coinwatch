import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { PortfolioService } from '../services/portfolio-service.js';
import type { AccountDescriptor } from '../domain/account.js';
import type { Store } from '../db/store.js';
import { buildTools } from './tools.js';

export function buildServer(
  service: PortfolioService,
  accounts: AccountDescriptor[],
  store?: Store,
) {
  return createSdkMcpServer({
    name: 'coinwatch',
    version: '0.1.0',
    tools: buildTools(service, accounts, store),
  });
}

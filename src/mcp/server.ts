import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { PortfolioService } from '../services/portfolio-service.js';
import type { AccountDescriptor } from '../domain/account.js';
import type { CacheStore } from '../db/cache-store.js';
import { buildTools, type PnlExportDependencies } from './tools.js';

export function buildServer(
  service: PortfolioService,
  accounts: AccountDescriptor[],
  store?: CacheStore,
  pnlExport?: PnlExportDependencies,
) {
  return createSdkMcpServer({
    name: 'coinwatch',
    version: '0.1.0',
    tools: buildTools(service, accounts, store, pnlExport),
  });
}

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoricalPriceProvider } from '../../src/adapters/chain-adapter.js';
import type { AccountDescriptor } from '../../src/domain/account.js';
import type { HistoricalUsdPrice, UtcDateString } from '../../src/domain/historical-price.js';
import type { Tx } from '../../src/domain/types.js';
import { buildHandlers } from '../../src/mcp/tools.js';
import type { PortfolioService } from '../../src/services/portfolio-service.js';

const seconds = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);

const accounts: AccountDescriptor[] = [
  {
    id: 'acct-1',
    label: 'BTC',
    family: 'bitcoin',
    chains: ['bitcoin'],
    source: { kind: 'addresses', addresses: ['bc1qexample'] },
  },
];

class FakeHistoricalPriceProvider implements HistoricalPriceProvider {
  async getHistoricalUsdPrice(
    _coingeckoId: string,
    date: UtcDateString,
  ): Promise<HistoricalUsdPrice | undefined> {
    const usd = date === '2026-01-01' ? 10_000 : 30_000;
    return { usd, source: 'coingecko', date };
  }
}

const txs: Tx[] = [
  {
    chain: 'bitcoin',
    txid: 'buy',
    timestamp: seconds('2026-01-01'),
    direction: 'in',
    symbol: 'BTC',
    raw: 100_000_000n,
    decimals: 8,
    confirmed: true,
  },
  {
    chain: 'bitcoin',
    txid: 'sell',
    timestamp: seconds('2026-03-01'),
    direction: 'out',
    symbol: 'BTC',
    raw: 50_000_000n,
    decimals: 8,
    confirmed: true,
  },
];

describe('reconcile MCP handler', () => {
  let dir: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('writes reconciliation JSON/CSV artifacts and returns summary counts', async () => {
    dir = mkdtempSync(join(tmpdir(), 'coinwatch-recon-handler-'));
    const external = join(dir, 'external.csv');
    writeFileSync(
      external,
      [
        'record_id,source,kind,account_id,chain,symbol,date,txid,quantity,proceeds_usd,basis_usd,gain_usd',
        'ext-1,external,realized_disposal,acct-1,bitcoin,BTC,2026-03-01,sell,0.5,15000,5000,10000',
      ].join('\n'),
      'utf8',
    );
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_030_000);
    const service = {
      getHistory: async () => txs,
    } as unknown as PortfolioService;
    const handlers = buildHandlers(service, accounts, undefined, {
      priceProvider: new FakeHistoricalPriceProvider(),
      currentUsdPrice: (id) => (id === 'bitcoin' ? 40_000 : undefined),
      outputDir: dir,
    });

    const result = await handlers.reconcile({ externalPath: external, accountIds: ['acct-1'] });
    const parsed = JSON.parse(result.content[0].text) as {
      files: { json: string; matchedCsv: string; valueMismatchCsv: string };
      summary: { matched: number; valueMismatch: number };
    };

    expect(parsed.summary).toMatchObject({ matched: 1, valueMismatch: 0 });
    expect(parsed.files.json).toBe(join(dir, 'coinwatch-recon-1700000030000.json'));
    expect(parsed.files.matchedCsv).toBe(join(dir, 'coinwatch-recon-1700000030000-matched.csv'));
    expect(existsSync(parsed.files.json)).toBe(true);
    expect(existsSync(parsed.files.matchedCsv)).toBe(true);
    expect(readFileSync(parsed.files.json, 'utf8')).toContain('"matched": 1');
    expect(readFileSync(parsed.files.matchedCsv, 'utf8')).toContain('sell');
  });
});

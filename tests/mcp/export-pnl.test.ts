import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

describe('export_pnl MCP handler', () => {
  let dir: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('writes the realized/open-lots/warnings CSV files and returns aggregate totals', async () => {
    dir = mkdtempSync(join(tmpdir(), 'coinwatch-pnl-export-'));
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_020_000);
    const service = {
      getHistory: async (selected: AccountDescriptor[]) => {
        expect(selected.map((account) => account.id)).toEqual(['acct-1']);
        return txs;
      },
    } as unknown as PortfolioService;
    const handlers = buildHandlers(service, accounts, undefined, {
      priceProvider: new FakeHistoricalPriceProvider(),
      currentUsdPrice: (id) => (id === 'bitcoin' ? 40_000 : undefined),
      outputDir: dir,
    });

    const result = await handlers.export_pnl({ accountIds: ['acct-1'] });
    const parsed = JSON.parse(result.content[0].text) as {
      files: { realized: string; openLots: string; warnings: string };
      aggregateTotals: { realizedGainUsd: number };
      warnings: string[];
    };

    expect(parsed.files.realized).toBe(join(dir, 'coinwatch-pnl-1700000020000-realized.csv'));
    expect(parsed.files.openLots).toBe(join(dir, 'coinwatch-pnl-1700000020000-open-lots.csv'));
    expect(parsed.files.warnings).toBe(join(dir, 'coinwatch-pnl-1700000020000-warnings.csv'));
    expect(Object.values(parsed.files).every((file) => existsSync(file))).toBe(true);
    expect(readFileSync(parsed.files.realized, 'utf8')).toContain('sell');
    expect(readFileSync(parsed.files.openLots, 'utf8')).toContain('50000000');
    expect(readFileSync(parsed.files.warnings, 'utf8')).toBe(
      'schema_version,code,txid,message,raw_warning\n',
    );
    expect(parsed.aggregateTotals.realizedGainUsd).toBe(10_000);
    expect(parsed.warnings).toEqual([]);
  });
});

import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import type { HistoricalPriceProvider } from '../../src/adapters/chain-adapter.js';
import { Store } from '../../src/db/store.js';
import {
  HistoricalPriceCapabilityError,
  assertUtcDateString,
  type HistoricalUsdPrice,
  type UtcDateString,
} from '../../src/domain/historical-price.js';
import {
  CachingHistoricalPriceProvider,
  CoinGeckoHistoricalPriceProvider,
  coinGeckoHistoryDateParam,
} from '../../src/providers/coingecko-historical.js';

const DATE = assertUtcDateString('2026-01-01');

describe('CoinGeckoHistoricalPriceProvider', () => {
  it('fetches and parses a historical USD price with the current YYYY-MM-DD date param', async () => {
    let calledUrl = '';
    let calledHeaders: Record<string, string> = {};
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      calledUrl = String(url);
      calledHeaders = (init?.headers as Record<string, string>) ?? {};
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          market_data: { current_price: { usd: 43_000.25 } },
        }),
      } as Response;
    }) as typeof fetch;

    const provider = new CoinGeckoHistoricalPriceProvider({
      apiKey: 'demo-key',
      baseUrl: 'https://example.test/api/v3',
      fetchFn: fakeFetch,
    });

    await expect(provider.getHistoricalUsdPrice('bitcoin', DATE)).resolves.toEqual({
      usd: 43_000.25,
      source: 'coingecko',
      date: DATE,
    });
    const url = new URL(calledUrl);
    expect(url.pathname).toBe('/api/v3/coins/bitcoin/history');
    expect(url.searchParams.get('date')).toBe('2026-01-01');
    expect(url.searchParams.get('localization')).toBe('false');
    expect(calledHeaders['x-cg-demo-api-key']).toBe('demo-key');
    expect(coinGeckoHistoryDateParam(DATE)).toBe('2026-01-01');
  });

  it('returns undefined when CoinGecko omits market_data/current_price.usd', async () => {
    const provider = new CoinGeckoHistoricalPriceProvider({
      fetchFn: (async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({}),
        }) as Response) as typeof fetch,
    });

    await expect(provider.getHistoricalUsdPrice('bitcoin', DATE)).resolves.toBeUndefined();
  });

  it('throws a capability error for out-of-range or unauthorized responses', async () => {
    for (const status of [400, 403]) {
      const provider = new CoinGeckoHistoricalPriceProvider({
        fetchFn: (async () =>
          ({
            ok: false,
            status,
            statusText: status === 400 ? 'Bad Request' : 'Forbidden',
          }) as Response) as typeof fetch,
        resilience: { sleep: async () => undefined },
      });

      await expect(provider.getHistoricalUsdPrice('bitcoin', DATE)).rejects.toBeInstanceOf(
        HistoricalPriceCapabilityError,
      );
    }
  });

  it('throws provider errors for non-capability HTTP failures', async () => {
    const provider = new CoinGeckoHistoricalPriceProvider({
      fetchFn: (async () =>
        ({
          ok: false,
          status: 500,
          statusText: 'Server Error',
        }) as Response) as typeof fetch,
      resilience: { sleep: async () => undefined },
    });

    await expect(provider.getHistoricalUsdPrice('bitcoin', DATE)).rejects.toThrow(
      'CoinGecko historical 500: Server Error',
    );
  });
});

class FakeHistoricalProvider implements HistoricalPriceProvider {
  calls = 0;

  constructor(
    private readonly result: HistoricalUsdPrice | undefined,
    private readonly error?: Error,
  ) {}

  async getHistoricalUsdPrice(_coingeckoId: string, _date: UtcDateString) {
    this.calls += 1;
    if (this.error !== undefined) {
      throw this.error;
    }
    return this.result;
  }
}

describe('CachingHistoricalPriceProvider', () => {
  it('returns cached prices without calling the inner provider', async () => {
    const store = new Store(new Database(':memory:'));
    store.cacheHistoricalPrice({
      coingeckoId: 'bitcoin',
      date: DATE,
      usd: 40_000,
      source: 'coingecko',
      fetchedAt: 1_700_000_000_000,
    });
    const inner = new FakeHistoricalProvider({
      usd: 41_000,
      source: 'coingecko',
      date: DATE,
    });

    const provider = new CachingHistoricalPriceProvider(inner, store);
    await expect(provider.getHistoricalUsdPrice('bitcoin', DATE)).resolves.toEqual({
      usd: 40_000,
      source: 'coingecko',
      date: DATE,
    });
    expect(inner.calls).toBe(0);
    store.close();
  });

  it('writes through on cache miss and serves the second call from cache', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const store = new Store(new Database(':memory:'));
    const inner = new FakeHistoricalProvider({
      usd: 42_000,
      source: 'coingecko',
      date: DATE,
    });
    const provider = new CachingHistoricalPriceProvider(inner, store);

    await expect(provider.getHistoricalUsdPrice('bitcoin', DATE)).resolves.toEqual({
      usd: 42_000,
      source: 'coingecko',
      date: DATE,
    });
    await expect(provider.getHistoricalUsdPrice('bitcoin', DATE)).resolves.toEqual({
      usd: 42_000,
      source: 'coingecko',
      date: DATE,
    });
    expect(inner.calls).toBe(1);
    expect(store.getHistoricalPrice('bitcoin', DATE)?.usd).toBe(42_000);
    store.close();
    vi.restoreAllMocks();
  });

  it('does not cache capability errors', async () => {
    const store = new Store(new Database(':memory:'));
    const error = new HistoricalPriceCapabilityError('tier cannot answer');
    const inner = new FakeHistoricalProvider(undefined, error);
    const provider = new CachingHistoricalPriceProvider(inner, store);

    await expect(provider.getHistoricalUsdPrice('bitcoin', DATE)).rejects.toBe(error);
    await expect(provider.getHistoricalUsdPrice('bitcoin', DATE)).rejects.toBe(error);
    expect(inner.calls).toBe(2);
    expect(store.getHistoricalPrice('bitcoin', DATE)).toBeUndefined();
    store.close();
  });
});

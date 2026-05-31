import { describe, expect, it } from 'vitest';
import { CoinGeckoPriceProvider } from '../../src/providers/coingecko.js';

describe('CoinGeckoPriceProvider', () => {
  it('parses /simple/price into a Map, dedupes ids, and sends the demo key header', async () => {
    let calledUrl = '';
    let calledHeaders: Record<string, string> = {};
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      calledUrl = String(url);
      calledHeaders = (init?.headers as Record<string, string>) ?? {};
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ bitcoin: { usd: 60000 }, 'usd-coin': { usd: 1 } }),
      } as Response;
    }) as typeof fetch;

    const provider = new CoinGeckoPriceProvider({ apiKey: 'demo-key', fetchFn: fakeFetch });
    const prices = await provider.getUsdPrices(['bitcoin', 'usd-coin', 'bitcoin']);

    expect(prices.get('bitcoin')).toBe(60000);
    expect(prices.get('usd-coin')).toBe(1);
    expect(calledUrl).toContain('ids=bitcoin,usd-coin');
    expect(calledUrl).toContain('vs_currencies=usd');
    expect(calledHeaders['x-cg-demo-api-key']).toBe('demo-key');
  });

  it('returns an empty Map for no ids without calling fetch', async () => {
    const provider = new CoinGeckoPriceProvider({
      fetchFn: (() => {
        throw new Error('fetch should not be called');
      }) as unknown as typeof fetch,
    });

    expect((await provider.getUsdPrices([])).size).toBe(0);
  });

  it('throws a provider error for non-OK responses', async () => {
    const provider = new CoinGeckoPriceProvider({
      fetchFn: (async () =>
        ({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
        }) as Response) as typeof fetch,
    });

    await expect(provider.getUsdPrices(['bitcoin'])).rejects.toThrow(
      'CoinGecko 429: Too Many Requests',
    );
  });
});

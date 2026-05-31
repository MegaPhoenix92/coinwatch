import type { PriceProvider } from '../adapters/chain-adapter.js';

const DEMO_BASE = 'https://api.coingecko.com/api/v3';

export interface CoinGeckoOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class CoinGeckoPriceProvider implements PriceProvider {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: CoinGeckoOptions = {}) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEMO_BASE;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async getUsdPrices(coingeckoIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const ids = [...new Set(coingeckoIds)].filter(Boolean);
    if (ids.length === 0) {
      return result;
    }

    const url = `${this.baseUrl}/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
    const headers: Record<string, string> = {};
    if (this.apiKey !== undefined) {
      headers['x-cg-demo-api-key'] = this.apiKey;
    }

    const res = await this.fetchFn(url, { headers });
    if (!res.ok) {
      throw new Error(`CoinGecko ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as Record<string, { usd?: number }>;
    for (const [id, value] of Object.entries(json)) {
      if (typeof value.usd === 'number') {
        result.set(id, value.usd);
      }
    }

    return result;
  }
}

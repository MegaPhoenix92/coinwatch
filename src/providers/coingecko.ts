import type { PriceProvider } from '../adapters/chain-adapter.js';
import {
  HttpStatusError,
  type ProviderResilienceConfig,
  withProviderResilience,
} from './resilience.js';

const DEMO_BASE = 'https://api.coingecko.com/api/v3';

export interface CoinGeckoOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  resilience?: ProviderResilienceConfig;
}

export class CoinGeckoPriceProvider implements PriceProvider {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly resilience: ProviderResilienceConfig;

  constructor(opts: CoinGeckoOptions = {}) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEMO_BASE;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.resilience = { diagnosticsScope: 'coingecko', ...opts.resilience };
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

    const res = await withProviderResilience(
      async (signal) => {
        const response = await this.fetchFn(url, { headers, signal });
        if (!response.ok) {
          throw new HttpStatusError('CoinGecko', response.status, response.statusText);
        }
        return response;
      },
      this.resilience,
    );

    const json = (await res.json()) as Record<string, { usd?: number }>;
    for (const [id, value] of Object.entries(json)) {
      if (typeof value.usd === 'number') {
        result.set(id, value.usd);
      }
    }

    return result;
  }
}

import type { HistoricalPriceProvider } from '../adapters/chain-adapter.js';
import type { Store } from '../db/store.js';
import {
  HistoricalPriceCapabilityError,
  type HistoricalUsdPrice,
  type UtcDateString,
} from '../domain/historical-price.js';
import {
  HttpStatusError,
  type ProviderResilienceConfig,
  withProviderResilience,
} from './resilience.js';

export { HistoricalPriceCapabilityError } from '../domain/historical-price.js';

const DEMO_BASE = 'https://api.coingecko.com/api/v3';

export interface CoinGeckoHistoricalOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  resilience?: ProviderResilienceConfig;
}

interface CoinGeckoHistoryResponse {
  market_data?: {
    current_price?: {
      usd?: unknown;
    };
  };
}

export function coinGeckoHistoryDateParam(date: UtcDateString): string {
  // CoinGecko's historical endpoint has used both YYYY-MM-DD and legacy
  // dd-mm-yyyy examples. Phase-3 uses the current YYYY-MM-DD reference and keeps
  // this isolated for a future live smoke check if the API changes again.
  return date;
}

export class CoinGeckoHistoricalPriceProvider implements HistoricalPriceProvider {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly resilience: ProviderResilienceConfig;

  constructor(opts: CoinGeckoHistoricalOptions = {}) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEMO_BASE;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.resilience = { diagnosticsScope: 'coingecko-historical', ...opts.resilience };
  }

  async getHistoricalUsdPrice(
    coingeckoId: string,
    date: UtcDateString,
  ): Promise<HistoricalUsdPrice | undefined> {
    const url = new URL(
      `${this.baseUrl.replace(/\/$/, '')}/coins/${encodeURIComponent(coingeckoId)}/history`,
    );
    url.searchParams.set('date', coinGeckoHistoryDateParam(date));
    url.searchParams.set('localization', 'false');

    const headers: Record<string, string> = {};
    if (this.apiKey !== undefined) {
      headers['x-cg-demo-api-key'] = this.apiKey;
    }

    const res = await withProviderResilience(
      async (signal) => {
        const response = await this.fetchFn(url, { headers, signal });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new HistoricalPriceCapabilityError(
              `CoinGecko historical price unavailable for ${coingeckoId} on ${date}: ${response.status} ${response.statusText}`,
            );
          }
          throw new HttpStatusError('CoinGecko historical', response.status, response.statusText);
        }
        return response;
      },
      this.resilience,
    );

    const json = (await res.json()) as CoinGeckoHistoryResponse;
    const usd = json.market_data?.current_price?.usd;
    if (typeof usd !== 'number') {
      return undefined;
    }

    return { usd, source: 'coingecko', date };
  }
}

export class CachingHistoricalPriceProvider implements HistoricalPriceProvider {
  constructor(
    private readonly inner: HistoricalPriceProvider,
    private readonly store: Store,
  ) {}

  async getHistoricalUsdPrice(
    coingeckoId: string,
    date: UtcDateString,
  ): Promise<HistoricalUsdPrice | undefined> {
    const cached = this.store.getHistoricalPrice(coingeckoId, date);
    if (cached !== undefined) {
      return cached;
    }

    const price = await this.inner.getHistoricalUsdPrice(coingeckoId, date);
    if (price !== undefined) {
      this.store.cacheHistoricalPrice({ coingeckoId, ...price });
    }
    return price;
  }
}

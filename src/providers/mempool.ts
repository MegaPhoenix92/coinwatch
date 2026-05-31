import type {
  BtcDataProvider,
  BtcUtxo,
  MempoolAddressResponse,
  MempoolTx,
} from '../adapters/chain-adapter.js';
import {
  HttpStatusError,
  type ProviderResilienceConfig,
  withProviderResilience,
} from './resilience.js';

const MEMPOOL_BASE = 'https://mempool.space/api';

export interface MempoolProviderOptions {
  fetchFn?: typeof fetch;
  resilience?: ProviderResilienceConfig;
}

export class MempoolProvider implements BtcDataProvider {
  private readonly fetchFn: typeof fetch;
  private readonly resilience: ProviderResilienceConfig;

  constructor(
    private readonly baseUrl: string = MEMPOOL_BASE,
    opts: MempoolProviderOptions = {},
  ) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.resilience = opts.resilience ?? {};
  }

  async getAddress(address: string): Promise<MempoolAddressResponse> {
    const res = await withProviderResilience(
      async (signal) => {
        const response = await this.fetchFn(`${this.baseUrl}/address/${address}`, { signal });
        if (!response.ok) {
          throw new HttpStatusError(
            'mempool getAddress failed',
            response.status,
            response.statusText,
          );
        }
        return response;
      },
      this.resilience,
    );
    return (await res.json()) as MempoolAddressResponse;
  }

  async getAddressTxs(address: string): Promise<MempoolTx[]> {
    const res = await withProviderResilience(
      async (signal) => {
        const response = await this.fetchFn(`${this.baseUrl}/address/${address}/txs`, { signal });
        if (!response.ok) {
          throw new HttpStatusError(
            'mempool getAddressTxs failed',
            response.status,
            response.statusText,
          );
        }
        return response;
      },
      this.resilience,
    );
    return (await res.json()) as MempoolTx[];
  }

  async getUtxos(address: string): Promise<BtcUtxo[]> {
    const res = await withProviderResilience(
      async (signal) => {
        const response = await this.fetchFn(`${this.baseUrl}/address/${address}/utxo`, { signal });
        if (!response.ok) {
          throw new HttpStatusError(
            'mempool getUtxos failed',
            response.status,
            response.statusText,
          );
        }
        return response;
      },
      this.resilience,
    );
    const utxos = (await res.json()) as Array<BtcUtxo & { status?: unknown }>;
    return utxos.map(({ txid, vout, value }) => ({ txid, vout, value }));
  }
}

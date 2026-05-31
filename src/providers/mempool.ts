import type {
  BtcDataProvider,
  MempoolAddressResponse,
  MempoolTx,
} from '../adapters/chain-adapter.js';

const MEMPOOL_BASE = 'https://mempool.space/api';

export class MempoolProvider implements BtcDataProvider {
  constructor(private readonly baseUrl: string = MEMPOOL_BASE) {}

  async getAddress(address: string): Promise<MempoolAddressResponse> {
    const res = await fetch(`${this.baseUrl}/address/${address}`);
    if (!res.ok) {
      throw new Error(`mempool getAddress failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as MempoolAddressResponse;
  }

  async getAddressTxs(address: string): Promise<MempoolTx[]> {
    const res = await fetch(`${this.baseUrl}/address/${address}/txs`);
    if (!res.ok) {
      throw new Error(`mempool getAddressTxs failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as MempoolTx[];
  }
}

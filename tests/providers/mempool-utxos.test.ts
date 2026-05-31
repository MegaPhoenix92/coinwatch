import { describe, expect, it, vi } from 'vitest';
import { MempoolProvider } from '../../src/providers/mempool.js';

describe('MempoolProvider.getUtxos', () => {
  it('maps the Esplora /utxo response to BtcUtxo[]', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [
        { txid: 'aa', vout: 0, value: 100000, status: { confirmed: true } },
      ],
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const provider = new MempoolProvider('https://mempool.space/api');
    const utxos = await provider.getUtxos('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');

    expect(utxos).toEqual([{ txid: 'aa', vout: 0, value: 100000 }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mempool.space/api/address/bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu/utxo',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

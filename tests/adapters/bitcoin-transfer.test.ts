import { describe, expect, it } from 'vitest';
import { base64 } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { BitcoinAdapter } from '../../src/adapters/bitcoin-adapter.js';
import type {
  BtcDataProvider,
  BtcUtxo,
  MempoolAddressResponse,
  MempoolTx,
} from '../../src/adapters/chain-adapter.js';

const WATCHED = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const RECIPIENT = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const account = {
  id: 'btc',
  label: 'BTC',
  family: 'bitcoin' as const,
  chains: ['bitcoin' as const],
  source: { kind: 'addresses' as const, addresses: [WATCHED] },
};

const fake: BtcDataProvider = {
  async getAddress(): Promise<MempoolAddressResponse> {
    return {
      address: WATCHED,
      chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
      mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
    };
  },
  async getAddressTxs(): Promise<MempoolTx[]> {
    return [];
  },
  async getUtxos(): Promise<BtcUtxo[]> {
    return [{ txid: 'a'.repeat(64), vout: 0, value: 200_000 }];
  },
};

describe('BitcoinAdapter.buildUnsignedTransfer', () => {
  it('builds an unsigned PSBT with change, fee, and verification summary', async () => {
    const adapter = new BitcoinAdapter(fake);
    const artifact = await adapter.buildUnsignedTransfer({
      account,
      chain: 'bitcoin',
      to: RECIPIENT,
      asset: 'BTC',
      rawAmount: 50_000n,
      feeRate: 2n,
    });

    expect(adapter.capabilities.preparesTransfers).toBe(true);
    expect(artifact.kind).toBe('btc-psbt');
    const psbt = base64.decode(artifact.payload);
    const reparsed = btc.Transaction.fromPSBT(psbt);
    expect(reparsed.inputsLength).toBeGreaterThan(0);
    expect(reparsed.outputsLength).toBeGreaterThanOrEqual(2);
    expect(reparsed.isFinal).toBe(false);
    for (let index = 0; index < reparsed.inputsLength; index += 1) {
      expect(reparsed.getInput(index).finalScriptWitness).toBeUndefined();
    }
    expect(artifact.summary.to).toBe(RECIPIENT);
    expect(artifact.summary.rawAmount).toBe('50000');
    expect(BigInt(artifact.summary.rawFee)).toBeGreaterThan(0n);
    expect(artifact.summary.artifactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.verifyNote).toContain('coinwatch never signs or broadcasts');
  });
});

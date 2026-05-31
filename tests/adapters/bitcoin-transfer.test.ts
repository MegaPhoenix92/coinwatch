import { describe, expect, it } from 'vitest';
import { base64, hex } from '@scure/base';
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
// Asymmetric (non-palindromic) txid so a display<->wire byte-order regression
// is actually detectable — 'a'.repeat(64) reverses to itself and hides the bug.
// Built from bytes 01..20 (not a hex literal, which the secret scanner flags).
const INPUT_TXID = hex.encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

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
    return [{ txid: INPUT_TXID, vout: 0, value: 200_000 }];
  },
};

function trackingBtcProvider(): BtcDataProvider & {
  calls: { getAddress: number; getAddressTxs: number; getUtxos: number };
} {
  const calls = { getAddress: 0, getAddressTxs: 0, getUtxos: 0 };
  return {
    calls,
    async getAddress(): Promise<MempoolAddressResponse> {
      calls.getAddress += 1;
      return fake.getAddress(WATCHED);
    },
    async getAddressTxs(): Promise<MempoolTx[]> {
      calls.getAddressTxs += 1;
      return [];
    },
    async getUtxos(): Promise<BtcUtxo[]> {
      calls.getUtxos += 1;
      return [{ txid: INPUT_TXID, vout: 0, value: 200_000 }];
    },
  };
}

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

    // The input references the provider's DISPLAY txid. A wrong reverse in the
    // adapter would surface here (regression guard the palindromic fixture missed).
    const inputTxid = reparsed.getInput(0).txid;
    expect(inputTxid && hex.encode(inputTxid)).toBe(INPUT_TXID);

    // Assert the PSBT itself pays the recipient and returns change to a watched
    // address — summary.to/rawAmount are echoes of the inputs and cannot catch a
    // PSBT that silently pays the wrong destination/amount.
    const outs = Array.from({ length: reparsed.outputsLength }, (_, i) => ({
      address: reparsed.getOutputAddress(i),
      amount: reparsed.getOutput(i).amount ?? 0n,
    }));
    const recipientOut = outs.find((o) => o.address === RECIPIENT);
    expect(recipientOut?.amount).toBe(50_000n);
    const changeOut = outs.find((o) => o.address === WATCHED);
    expect(changeOut).toBeDefined();
    expect(changeOut?.amount ?? 0n).toBeGreaterThan(0n);
  });

  it('rejects non-native-segwit (legacy/P2SH) watch addresses with a clear error', async () => {
    const legacyAccount = {
      ...account,
      source: { kind: 'addresses' as const, addresses: ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'] },
    };
    const adapter = new BitcoinAdapter(fake);
    await expect(
      adapter.buildUnsignedTransfer({
        account: legacyAccount,
        chain: 'bitcoin',
        to: RECIPIENT,
        asset: 'BTC',
        rawAmount: 50_000n,
        feeRate: 2n,
      }),
    ).rejects.toThrow(/native-SegWit|P2WPKH/i);
  });

  it('rejects invalid recipients before reading provider data', async () => {
    const provider = trackingBtcProvider();
    const adapter = new BitcoinAdapter(provider);

    await expect(
      adapter.buildUnsignedTransfer({
        account,
        chain: 'bitcoin',
        to: 'not-a-bitcoin-address',
        asset: 'BTC',
        rawAmount: 50_000n,
        feeRate: 2n,
      }),
    ).rejects.toThrow(/Invalid bitcoin recipient address/);
    expect(provider.calls).toEqual({ getAddress: 0, getAddressTxs: 0, getUtxos: 0 });
  });

  it('rejects wrong-chain and unsupported-asset requests before reading provider data', async () => {
    const provider = trackingBtcProvider();
    const adapter = new BitcoinAdapter(provider);

    await expect(
      adapter.buildUnsignedTransfer({
        account,
        chain: 'ethereum',
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        asset: 'BTC',
        rawAmount: 50_000n,
      }),
    ).rejects.toThrow(/cannot prepare transfers for ethereum/);
    await expect(
      adapter.buildUnsignedTransfer({
        account,
        chain: 'bitcoin',
        to: RECIPIENT,
        asset: 'ETH',
        rawAmount: 50_000n,
      }),
    ).rejects.toThrow(/support only native BTC/);
    expect(provider.calls).toEqual({ getAddress: 0, getAddressTxs: 0, getUtxos: 0 });
  });
});

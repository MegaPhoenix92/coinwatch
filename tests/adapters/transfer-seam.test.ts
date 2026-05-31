import { describe, expect, it } from 'vitest';
import { BitcoinAdapter } from '../../src/adapters/bitcoin-adapter.js';
import { EvmAdapter } from '../../src/adapters/evm-adapter.js';
import { SolanaAdapter } from '../../src/adapters/solana-adapter.js';
import type {
  BtcDataProvider,
  EvmDataProvider,
  SolDataProvider,
} from '../../src/adapters/chain-adapter.js';
import type { AccountDescriptor } from '../../src/domain/account.js';
import type {
  ChainAdapterTransferParams,
  TransferRequest,
  UnsignedArtifact,
} from '../../src/domain/transfer.js';
import { VERIFY_NOTE } from '../../src/domain/transfer.js';

const account: AccountDescriptor = {
  id: 'acct-btc',
  label: 'BTC',
  family: 'bitcoin',
  chains: ['bitcoin'],
  source: { kind: 'addresses', addresses: ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'] },
};

const transferParams: ChainAdapterTransferParams = {
  account,
  chain: 'bitcoin',
  to: 'bc1qrecipient0000000000000000000000000000',
  asset: 'BTC',
  rawAmount: 1000n,
};

const fakeBtcProvider: BtcDataProvider = {
  async getAddress(address) {
    return {
      address,
      chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
      mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
    };
  },
  async getAddressTxs() {
    return [];
  },
  async getUtxos() {
    return [];
  },
};

const fakeEvmProvider: EvmDataProvider = {
  async getNativeBalance() {
    return 0n;
  },
  async getTokenBalances() {
    return [];
  },
  async getTransfers() {
    return [];
  },
};

const fakeSolProvider: SolDataProvider = {
  async getLamports() {
    return 0n;
  },
  async getTokenAccounts() {
    return [];
  },
  async getSignatures() {
    return [];
  },
  async getTransaction() {
    return undefined;
  },
};

describe('transfer construction seam', () => {
  it('defines transfer request and unsigned artifact types with the verification note', () => {
    const request: TransferRequest = {
      accountId: 'acct-btc',
      to: 'bc1qrecipient0000000000000000000000000000',
      asset: 'BTC',
      amount: '0.00001',
    };
    const artifact: UnsignedArtifact = {
      kind: 'btc-psbt',
      payload: 'cHNidP8BAHECAAAAAA==',
      summary: {
        chain: 'bitcoin',
        asset: request.asset,
        from: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
        to: request.to,
        amount: request.amount,
        rawAmount: '1000',
        decimals: 8,
        fee: '0',
        rawFee: '0',
        feeAsset: 'BTC',
        artifactHash: '0'.repeat(64),
      },
      verifyNote: VERIFY_NOTE,
    };

    expect(artifact.verifyNote).toContain('coinwatch never signs or broadcasts');
    expect(artifact.summary.rawAmount).toBe(transferParams.rawAmount.toString());
  });

  it('reports transfer preparation as unavailable until chain implementations land', async () => {
    const adapters = [
      new BitcoinAdapter(fakeBtcProvider),
      new EvmAdapter(fakeEvmProvider),
      new SolanaAdapter(fakeSolProvider),
    ];

    for (const adapter of adapters) {
      expect(adapter.capabilities.preparesTransfers).toBe(false);
      await expect(adapter.buildUnsignedTransfer(transferParams)).rejects.toThrow(
        'buildUnsignedTransfer not implemented for this chain yet',
      );
    }
  });
});

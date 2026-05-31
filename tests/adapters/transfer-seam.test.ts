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

const evmTransferParams: ChainAdapterTransferParams = {
  account: {
    id: 'acct-evm',
    label: 'EVM',
    family: 'evm',
    chains: ['ethereum'],
    source: { kind: 'addresses', addresses: ['0x0000000000000000000000000000000000000001'] },
  },
  chain: 'ethereum',
  to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  asset: 'ETH',
  rawAmount: 1_000_000_000_000_000n,
};

const solTransferParams: ChainAdapterTransferParams = {
  account: {
    id: 'acct-sol',
    label: 'SOL',
    family: 'solana',
    chains: ['solana'],
    source: { kind: 'addresses', addresses: ['11111111111111111111111111111112'] },
  },
  chain: 'solana',
  to: '11111111111111111111111111111113',
  asset: 'SOL',
  rawAmount: 1_000_000n,
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
  async getTransactionCount() {
    return 0;
  },
  async estimateGas() {
    return 21_000n;
  },
  async getFeesPerGas() {
    return { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  },
  getChainId() {
    return 1;
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
  async getLatestBlockhash() {
    return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 123n };
  },
  async getAccountExists() {
    return true;
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

  it('reports BTC, EVM, and native Solana preparation as available', async () => {
    const bitcoin = new BitcoinAdapter(fakeBtcProvider);
    expect(bitcoin.capabilities.preparesTransfers).toBe(true);
    await expect(bitcoin.buildUnsignedTransfer(transferParams)).rejects.toThrow(
      'No spendable UTXOs for this bitcoin account.',
    );

    const evm = new EvmAdapter(fakeEvmProvider);
    expect(evm.capabilities.preparesTransfers).toBe(true);
    await expect(evm.buildUnsignedTransfer(evmTransferParams)).resolves.toMatchObject({
      kind: 'evm-eip1559',
    });

    const solana = new SolanaAdapter(fakeSolProvider);
    expect(solana.capabilities.preparesTransfers).toBe(true);
    await expect(solana.buildUnsignedTransfer(solTransferParams)).resolves.toMatchObject({
      kind: 'solana-message',
    });
  });
});

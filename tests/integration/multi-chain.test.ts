import { describe, expect, it } from 'vitest';
import { BitcoinAdapter } from '../../src/adapters/bitcoin-adapter.js';
import { EvmAdapter } from '../../src/adapters/evm-adapter.js';
import { SolanaAdapter } from '../../src/adapters/solana-adapter.js';
import type {
  BtcDataProvider,
  ChainAdapter,
  EvmDataProvider,
  EvmRawTransfer,
  EvmTokenBalance,
  MempoolAddressResponse,
  MempoolTx,
  PriceProvider,
  SolDataProvider,
  SolRawTx,
  SolTokenAccount,
} from '../../src/adapters/chain-adapter.js';
import type { AccountDescriptor } from '../../src/domain/account.js';
import type { ChainFamily } from '../../src/domain/chains.js';
import { PortfolioService } from '../../src/services/portfolio-service.js';

// Fixture providers — ZERO live network. One unit of the native asset per chain.
const fakeBtcProvider: BtcDataProvider = {
  async getAddress(): Promise<MempoolAddressResponse> {
    return {
      address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
      chain_stats: { funded_txo_sum: 100_000_000, spent_txo_sum: 0, tx_count: 1 },
      mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
    };
  },
  async getAddressTxs(): Promise<MempoolTx[]> {
    return [];
  },
  async getUtxos() {
    return [];
  },
};

const fakeEvmProvider: EvmDataProvider = {
  async getNativeBalance(): Promise<bigint> {
    return 1_000_000_000_000_000_000n; // 1 ETH
  },
  async getTokenBalances(): Promise<EvmTokenBalance[]> {
    return [];
  },
  async getTransfers(): Promise<EvmRawTransfer[]> {
    return [];
  },
  async getTransactionCount(): Promise<number> {
    return 0;
  },
  async estimateGas(): Promise<bigint> {
    return 21_000n;
  },
  async getFeesPerGas(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    return { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  },
  getChainId(): number {
    return 1;
  },
};

const fakeSolProvider: SolDataProvider = {
  async getLamports(): Promise<bigint> {
    return 1_000_000_000n; // 1 SOL
  },
  async getTokenAccounts(): Promise<SolTokenAccount[]> {
    return [];
  },
  async getSignatures(): Promise<SolRawTx[]> {
    return [];
  },
  async getTransaction(): Promise<SolRawTx | undefined> {
    return undefined;
  },
  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    return {
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 123n,
    };
  },
  async getAccountExists(): Promise<boolean> {
    return true;
  },
  async getMinimumBalanceForRentExemption(_space: bigint): Promise<bigint> {
    return 890_880n;
  },
};

const fakePrices: PriceProvider = {
  async getUsdPrices(): Promise<Map<string, number>> {
    return new Map([
      ['bitcoin', 60_000],
      ['ethereum', 3_000],
      ['solana', 150],
    ]);
  },
};

const accounts: AccountDescriptor[] = [
  {
    id: 'btc',
    label: 'BTC',
    family: 'bitcoin',
    chains: ['bitcoin'],
    source: { kind: 'addresses', addresses: ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'] },
  },
  {
    id: 'evm',
    label: 'EVM',
    family: 'evm',
    chains: ['ethereum'],
    source: { kind: 'addresses', addresses: ['0x0000000000000000000000000000000000000001'] },
  },
  {
    id: 'sol',
    label: 'SOL',
    family: 'solana',
    chains: ['solana'],
    source: { kind: 'addresses', addresses: ['So11111111111111111111111111111111111111112'] },
  },
];

describe('multi-chain wiring (Phase-1 DoD)', () => {
  it('aggregates a portfolio across BTC + EVM + Solana via injected providers', async () => {
    const adapters = new Map<ChainFamily, ChainAdapter>([
      ['bitcoin', new BitcoinAdapter(fakeBtcProvider)],
      ['evm', new EvmAdapter(fakeEvmProvider)],
      ['solana', new SolanaAdapter(fakeSolProvider)],
    ]);
    const service = new PortfolioService(adapters, fakePrices);

    const view = await service.getPortfolio(accounts);

    const chains = view.byChain.map((entry) => entry.chain).sort();
    expect(chains).toEqual(['bitcoin', 'ethereum', 'solana']);
    expect(view.totalUsd).toBe(63_150); // 1 BTC*60000 + 1 ETH*3000 + 1 SOL*150
    expect(view.warnings).toEqual([]);
  });
});

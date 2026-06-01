import { existsSync, unlinkSync } from 'node:fs';
import { base64, hex } from '@scure/base';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BitcoinAdapter } from '../../src/adapters/bitcoin-adapter.js';
import { EvmAdapter } from '../../src/adapters/evm-adapter.js';
import { SolanaAdapter } from '../../src/adapters/solana-adapter.js';
import type {
  BtcDataProvider,
  BtcUtxo,
  ChainAdapter,
  EvmDataProvider,
  EvmGasEstimateRequest,
  EvmRawTransfer,
  EvmTokenBalance,
  MempoolAddressResponse,
  MempoolTx,
  PriceProvider,
  SolDataProvider,
  SolRawTx,
  SolTokenAccount,
} from '../../src/adapters/chain-adapter.js';
import { buildQueryOptions } from '../../src/cli.js';
import { Store } from '../../src/db/store.js';
import type { AccountDescriptor } from '../../src/domain/account.js';
import type { ChainFamily, EvmChain } from '../../src/domain/chains.js';
import type { UnsignedArtifact } from '../../src/domain/transfer.js';
import { buildHandlers, buildTools } from '../../src/mcp/tools.js';
import { PortfolioService } from '../../src/services/portfolio-service.js';

const BTC_FROM = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const BTC_TO = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const EVM_FROM = '0x0000000000000000000000000000000000000001';
const EVM_TO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const SOL_FROM = '11111111111111111111111111111112';
const SOL_TO = '11111111111111111111111111111113';
const SOL_BLOCKHASH = 'Gk1noHWTQfA1n4Jc3pj3vHWqUdt4PUmTPGUNQv88L7gd';
const BTC_INPUT_TXID = hex.encode(Uint8Array.from({ length: 32 }, (_, i) => 64 - i));

const accounts: AccountDescriptor[] = [
  {
    id: 'btc-main',
    label: 'BTC',
    family: 'bitcoin',
    chains: ['bitcoin'],
    source: { kind: 'addresses', addresses: [BTC_FROM] },
  },
  {
    id: 'evm-main',
    label: 'EVM',
    family: 'evm',
    chains: ['ethereum'],
    source: { kind: 'addresses', addresses: [EVM_FROM] },
  },
  {
    id: 'sol-main',
    label: 'SOL',
    family: 'solana',
    chains: ['solana'],
    source: { kind: 'addresses', addresses: [SOL_FROM] },
  },
];

const fakeBtcProvider: BtcDataProvider = {
  async getAddress(address: string): Promise<MempoolAddressResponse> {
    return {
      address,
      chain_stats: { funded_txo_sum: 200_000, spent_txo_sum: 0, tx_count: 1 },
      mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
    };
  },
  async getAddressTxs(): Promise<MempoolTx[]> {
    return [];
  },
  async getUtxos(): Promise<BtcUtxo[]> {
    return [{ txid: BTC_INPUT_TXID, vout: 0, value: 200_000 }];
  },
};

const fakeEvmProvider: EvmDataProvider = {
  async getNativeBalance(): Promise<bigint> {
    return 10_000_000_000_000_000_000n;
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
  async estimateGas(_chain: EvmChain, _req: EvmGasEstimateRequest): Promise<bigint> {
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
    return 10_000_000n;
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
    return { blockhash: SOL_BLOCKHASH, lastValidBlockHeight: 123n };
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
    return new Map();
  },
};

interface PreparedResponse extends UnsignedArtifact {
  file: string;
}

function parseToolText<T>(text: string): T {
  return JSON.parse(text) as T;
}

describe('multi-chain prepare_transfer e2e and Phase-2 DoD guards', () => {
  let store: Store | undefined;
  const filesToRemove = new Set<string>();

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const file of filesToRemove) {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    }
    filesToRemove.clear();
    await store?.close();
    store = undefined;
  });

  function buildFixtureStack() {
    store = new Store(new Database(':memory:'));
    const adapters = new Map<ChainFamily, ChainAdapter>([
      ['bitcoin', new BitcoinAdapter(fakeBtcProvider)],
      ['evm', new EvmAdapter(fakeEvmProvider)],
      ['solana', new SolanaAdapter(fakeSolProvider)],
    ]);
    const service = new PortfolioService(adapters, fakePrices, store);
    return { handlers: buildHandlers(service, accounts, store), service };
  }

  it('prepares unsigned transfer artifacts for BTC, EVM, and native SOL through the MCP handler', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_010_000);
    const { handlers } = buildFixtureStack();

    const btc = parseToolText<PreparedResponse>(
      (await handlers.prepare_transfer({
        accountId: 'btc-main',
        to: BTC_TO,
        asset: 'BTC',
        amount: '0.0005',
      })).content[0].text,
    );
    filesToRemove.add(btc.file);
    expect(btc.kind).toBe('btc-psbt');
    expect(btc.summary).toMatchObject({
      to: BTC_TO,
      rawAmount: '50000',
      feeAsset: 'BTC',
    });
    expect(BigInt(btc.summary.rawFee)).toBeGreaterThan(0n);
    expect(btc.verifyNote).toContain('Verify');
    expect(btc.file).toMatch(/coinwatch-unsigned-btc-psbt-\d+\.psbt$/);
    expect(existsSync(btc.file)).toBe(true);

    const evm = parseToolText<PreparedResponse>(
      (await handlers.prepare_transfer({
        accountId: 'evm-main',
        to: EVM_TO,
        asset: 'ETH',
        amount: '0.001',
      })).content[0].text,
    );
    filesToRemove.add(evm.file);
    expect(evm.kind).toBe('evm-eip1559');
    expect(evm.summary).toMatchObject({
      to: EVM_TO,
      rawAmount: '1000000000000000',
      rawFee: '630000000000000',
      feeAsset: 'ETH',
    });
    expect(evm.verifyNote).toContain('Verify');
    expect(evm.file).toMatch(/coinwatch-unsigned-evm-eip1559-\d+\.evmtx$/);
    expect(existsSync(evm.file)).toBe(true);

    const sol = parseToolText<PreparedResponse>(
      (await handlers.prepare_transfer({
        accountId: 'sol-main',
        to: SOL_TO,
        asset: 'SOL',
        amount: '0.001',
      })).content[0].text,
    );
    filesToRemove.add(sol.file);
    expect(sol.kind).toBe('solana-message');
    expect(sol.summary).toMatchObject({
      to: SOL_TO,
      rawAmount: '1000000',
      rawFee: '5000',
      feeAsset: 'SOL',
    });
    expect(sol.verifyNote).toContain('Verify');
    expect(sol.file).toMatch(/coinwatch-unsigned-solana-message-\d+\.solmsg$/);
    expect(base64.decode(sol.payload).length).toBeGreaterThan(0);
    expect(existsSync(sol.file)).toBe(true);
  });

  it('keeps the MCP registry and CLI agent lockdown at the Phase-2 DoD shape', () => {
    const { service } = buildFixtureStack();
    const names = buildTools(service, accounts).map((mcpTool) => mcpTool.name).sort();
    expect(names).toEqual([
      'clear_tx_category_override',
      'derive_receive_address',
      'export_pnl',
      'get_history',
      'get_portfolio',
      'list_addresses',
      'prepare_transfer',
      'reconcile',
      'set_tx_category_override',
    ]);
    expect(names.some((name) => /sign|broadcast/i.test(name))).toBe(false);

    const server = { type: 'sdk', name: 'coinwatch' } as Parameters<typeof buildQueryOptions>[0];
    const options = buildQueryOptions(server);
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual(['mcp__coinwatch__*']);
    expect(options.settingSources).toEqual([]);
    expect(options.permissionMode).toBe('default');
    expect(JSON.stringify(options)).not.toContain('bypassPermissions');
  });
});

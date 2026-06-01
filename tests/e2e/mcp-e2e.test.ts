import { unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
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
import { buildQueryOptions } from '../../src/cli.js';
import { Store } from '../../src/db/store.js';
import type { AccountDescriptor } from '../../src/domain/account.js';
import type { ChainFamily } from '../../src/domain/chains.js';
import type { PortfolioView, Tx } from '../../src/domain/types.js';
import { buildHandlers } from '../../src/mcp/tools.js';
import { PortfolioService } from '../../src/services/portfolio-service.js';

const BTC = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const BTC_EXTERNAL = 'bc1qsender00000000000000000000000000000000';
const EVM = '0x1111111111111111111111111111111111111111';
const EVM_EXTERNAL = '0x2222222222222222222222222222222222222222';
const SOL = 'So11111111111111111111111111111111111111112';
const SOL_EXTERNAL = 'Ex11111111111111111111111111111111111111111';

const btcTx: MempoolTx = {
  txid: 'btc-in',
  vin: [{ prevout: { scriptpubkey_address: BTC_EXTERNAL, value: 50_000 } }],
  vout: [{ scriptpubkey_address: BTC, value: 50_000 }],
  status: { confirmed: true, block_time: 1_700_000_000 },
  fee: 500,
};

const fakeBtcProvider: BtcDataProvider = {
  async getAddress(address: string): Promise<MempoolAddressResponse> {
    return {
      address,
      chain_stats: { funded_txo_sum: 50_000_000, spent_txo_sum: 0, tx_count: 1 },
      mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
    };
  },
  async getAddressTxs(): Promise<MempoolTx[]> {
    return [btcTx];
  },
  async getUtxos() {
    return [{ txid: 'c'.repeat(64), vout: 0, value: 200_000 }];
  },
};

const fakeEvmProvider: EvmDataProvider = {
  async getNativeBalance(): Promise<bigint> {
    return 1_000_000_000_000_000_000n;
  },
  async getTokenBalances(): Promise<EvmTokenBalance[]> {
    return [];
  },
  async getTransfers(): Promise<EvmRawTransfer[]> {
    return [
      {
        txid: 'evm-in',
        from: EVM_EXTERNAL,
        to: EVM,
        rawValue: 1_000_000_000_000_000_000n,
        asset: 'ETH',
        timestamp: 1_700_000_100,
      },
    ];
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
    return 2_000_000_000n;
  },
  async getTokenAccounts(): Promise<SolTokenAccount[]> {
    return [];
  },
  async getSignatures(): Promise<SolRawTx[]> {
    return [{ signature: 'sol-in', blockTime: 1_700_000_200 }];
  },
  async getTransaction(): Promise<SolRawTx> {
    return {
      signature: 'sol-in',
      blockTime: 1_700_000_200,
      fee: 5_000n,
      accountKeys: [SOL_EXTERNAL, SOL],
      preBalances: [3_000_005_000n, 0n],
      postBalances: [1_000_000_000n, 2_000_000_000n],
      preTokenBalances: [],
      postTokenBalances: [],
    };
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
    id: 'btc-main',
    label: 'BTC',
    family: 'bitcoin',
    chains: ['bitcoin'],
    source: { kind: 'addresses', addresses: [BTC] },
  },
  {
    id: 'evm-main',
    label: 'EVM',
    family: 'evm',
    chains: ['ethereum'],
    source: { kind: 'addresses', addresses: [EVM] },
  },
  {
    id: 'sol-main',
    label: 'SOL',
    family: 'solana',
    chains: ['solana'],
    source: { kind: 'addresses', addresses: [SOL] },
  },
];

function parseToolText<T>(text: string): T {
  return JSON.parse(text) as T;
}

describe('headless MCP e2e regression suite', () => {
  let store: Store | undefined;

  afterEach(() => {
    store?.close();
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
    return { handlers: buildHandlers(service, accounts, store), store };
  }

  it('exercises the core MCP handlers against the real fixture stack', async () => {
    const { handlers, store: fixtureStore } = buildFixtureStack();
    fixtureStore.setLabel('bitcoin', BTC, 'labeled BTC vault');

    const portfolio = parseToolText<PortfolioView>(
      (await handlers.get_portfolio()).content[0].text,
    );
    expect(portfolio.totalUsd).toBe(33_300);
    expect(portfolio.byChain.map((entry) => entry.chain).sort()).toEqual([
      'bitcoin',
      'ethereum',
      'solana',
    ]);
    expect(portfolio.warnings).toEqual([]);

    const addresses = parseToolText<Array<{ address: string; label?: string }>>(
      (await handlers.list_addresses()).content[0].text,
    );
    expect(addresses.map((entry) => entry.address)).toEqual([BTC, EVM, SOL]);
    expect(addresses.find((entry) => entry.address === BTC)?.label).toBe('labeled BTC vault');

    const receive = parseToolText<{ address: string; note: string }>(
      (await handlers.derive_receive_address({ accountId: 'evm-main' })).content[0].text,
    );
    expect(receive.address).toBe(EVM);
    expect(receive.note).toContain('verify on your signing device before use');

    const history = parseToolText<Array<Omit<Tx, 'raw'> & { raw: string }>>(
      (await handlers.get_history({ limit: 10 })).content[0].text,
    );
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ txid: 'btc-in', raw: '50000' }),
        expect.objectContaining({ txid: 'evm-in', raw: '1000000000000000000' }),
        expect.objectContaining({ txid: 'sol-in', raw: '2000000000' }),
      ]),
    );
    expect(history.every((tx) => typeof tx.raw === 'string')).toBe(true);

    const prepared = parseToolText<{
      kind: string;
      summary: { to: string; rawAmount: string };
      verifyNote: string;
      file: string;
    }>(
      (await handlers.prepare_transfer({
        accountId: 'btc-main',
        to: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        asset: 'BTC',
        amount: '0.0005',
      })).content[0].text,
    );
    expect(prepared.kind).toBe('btc-psbt');
    expect(prepared.summary).toMatchObject({
      to: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      rawAmount: '50000',
    });
    expect(prepared.verifyNote).toContain('Verify');
    expect(prepared.file).toMatch(/coinwatch-unsigned-btc-psbt-\d+\.psbt$/);
    unlinkSync(prepared.file);
  });

  it('keeps the CLI query options locked down to coinwatch MCP tools only', () => {
    const options = buildQueryOptions({ type: 'sdk', name: 'coinwatch' } as never);
    expect(options).toMatchObject({
      tools: [],
      allowedTools: ['mcp__coinwatch__*'],
      settingSources: [],
      permissionMode: 'default',
    });
    expect('bypassPermissions' in options).toBe(false);
  });
});

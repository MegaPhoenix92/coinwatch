import { describe, expect, it } from 'vitest';
import { SolanaAdapter } from '../../src/adapters/solana-adapter.js';
import type {
  SolDataProvider,
  SolRawTx,
  SolTokenAccount,
} from '../../src/adapters/chain-adapter.js';
import type { AccountDescriptor, DerivedAddress } from '../../src/domain/account.js';
import {
  SOL_TOKEN_2022_PROGRAM,
  SOL_TOKEN_PROGRAM,
} from '../../src/domain/assets.js';

const ADDRESS = 'So11111111111111111111111111111111111111112';
const SECOND_ADDRESS = 'So22222222222222222222222222222222222222222';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PYUSD_MINT = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const EXTERNAL_ADDRESS = 'Ex11111111111111111111111111111111111111111';

const nativeInTx: SolRawTx = {
  signature: 'sig-native-in',
  blockTime: 1_717_000_000,
  fee: 5_000n,
  accountKeys: [EXTERNAL_ADDRESS, ADDRESS],
  preBalances: [10_000_005_000n, 1_000_000_000n],
  postBalances: [9_000_000_000n, 2_000_000_000n],
  preTokenBalances: [],
  postTokenBalances: [],
};

const usdcOutTx: SolRawTx = {
  signature: 'sig-usdc-out',
  blockTime: 1_717_000_100,
  fee: 5_000n,
  accountKeys: [ADDRESS, EXTERNAL_ADDRESS],
  preBalances: [2_000_000_000n, 9_000_000_000n],
  postBalances: [1_999_995_000n, 9_000_000_000n],
  preTokenBalances: [
    {
      accountIndex: 0,
      mint: USDC_MINT,
      owner: ADDRESS,
      amount: '100000000',
      decimals: 6,
    },
    {
      accountIndex: 1,
      mint: USDC_MINT,
      owner: EXTERNAL_ADDRESS,
      amount: '0',
      decimals: 6,
    },
  ],
  postTokenBalances: [
    {
      accountIndex: 0,
      mint: USDC_MINT,
      owner: ADDRESS,
      amount: '75000000',
      decimals: 6,
    },
    {
      accountIndex: 1,
      mint: USDC_MINT,
      owner: EXTERNAL_ADDRESS,
      amount: '25000000',
      decimals: 6,
    },
  ],
};

const selfTx: SolRawTx = {
  signature: 'sig-self',
  blockTime: 1_717_000_200,
  fee: 0n,
  accountKeys: [ADDRESS, SECOND_ADDRESS],
  preBalances: [2_000_000_000n, 0n],
  postBalances: [1_500_000_000n, 500_000_000n],
  preTokenBalances: [],
  postTokenBalances: [],
};

const pyusdInTx: SolRawTx = {
  signature: 'sig-pyusd-in',
  blockTime: 1_717_000_300,
  fee: 5_000n,
  accountKeys: [EXTERNAL_ADDRESS, ADDRESS],
  preBalances: [9_000_000_000n, 1_999_995_000n],
  postBalances: [8_999_995_000n, 1_999_995_000n],
  preTokenBalances: [
    {
      accountIndex: 0,
      mint: PYUSD_MINT,
      owner: EXTERNAL_ADDRESS,
      amount: '50000000',
      decimals: 6,
    },
    {
      accountIndex: 1,
      mint: PYUSD_MINT,
      owner: ADDRESS,
      amount: '0',
      decimals: 6,
    },
  ],
  postTokenBalances: [
    {
      accountIndex: 0,
      mint: PYUSD_MINT,
      owner: EXTERNAL_ADDRESS,
      amount: '0',
      decimals: 6,
    },
    {
      accountIndex: 1,
      mint: PYUSD_MINT,
      owner: ADDRESS,
      amount: '50000000',
      decimals: 6,
    },
  ],
};

class FakeSolProvider implements SolDataProvider {
  readonly tokenProgramQueries: string[] = [];
  readonly transactionRequests: string[] = [];
  private readonly transactions = new Map(
    [nativeInTx, usdcOutTx, selfTx, pyusdInTx].map((tx) => [tx.signature, tx]),
  );

  async getLamports(_address: string): Promise<bigint> {
    return 2_500_000_000n;
  }

  async getTokenAccounts(address: string, programId: string): Promise<SolTokenAccount[]> {
    this.tokenProgramQueries.push(`${address}:${programId}`);
    if (programId === SOL_TOKEN_PROGRAM) {
      return [
        {
          mint: USDC_MINT,
          amount: '100000000',
          decimals: 6,
          uiAmountString: '100',
        },
        {
          mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
          amount: '0',
          decimals: 6,
          uiAmountString: '0',
        },
      ];
    }
    if (programId === SOL_TOKEN_2022_PROGRAM) {
      return [
        {
          mint: PYUSD_MINT,
          amount: '50000000',
          decimals: 6,
          uiAmountString: '50',
        },
        {
          mint: 'UnknownMint1111111111111111111111111111111',
          amount: '999',
          decimals: 0,
          uiAmountString: '999',
        },
      ];
    }
    return [];
  }

  async getSignatures(_address: string, _limit: number): Promise<SolRawTx[]> {
    if (_address === SECOND_ADDRESS) {
      return [{ signature: selfTx.signature, blockTime: selfTx.blockTime }];
    }
    return [
      { signature: nativeInTx.signature, blockTime: nativeInTx.blockTime },
      { signature: usdcOutTx.signature, blockTime: usdcOutTx.blockTime },
      { signature: selfTx.signature, blockTime: selfTx.blockTime },
      { signature: pyusdInTx.signature, blockTime: pyusdInTx.blockTime },
    ];
  }

  async getTransaction(signature: string): Promise<SolRawTx | undefined> {
    this.transactionRequests.push(signature);
    return this.transactions.get(signature);
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    return {
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 123n,
    };
  }

  async getAccountExists(): Promise<boolean> {
    return true;
  }

  async getMinimumBalanceForRentExemption(_space: bigint): Promise<bigint> {
    return 890_880n;
  }
}

const account: AccountDescriptor = {
  id: 'sol-1',
  label: 'My Solana',
  family: 'solana',
  chains: ['solana'],
  source: { kind: 'addresses', addresses: [ADDRESS, SECOND_ADDRESS] },
};

describe('SolanaAdapter', () => {
  it('reports family solana and does not derive', () => {
    const adapter = new SolanaAdapter(new FakeSolProvider());
    expect(adapter.family).toBe('solana');
    expect(adapter.capabilities.derivesAddresses).toBe(false);
  });

  it('resolves literal pubkeys as non-derived Solana addresses', async () => {
    const adapter = new SolanaAdapter(new FakeSolProvider());
    const expected: DerivedAddress[] = [
      { address: ADDRESS, chain: 'solana', derived: false },
      { address: SECOND_ADDRESS, chain: 'solana', derived: false },
    ];
    await expect(adapter.resolveAddresses(account)).resolves.toEqual(expected);
  });

  it('returns the first pubkey as receive address with the device-verify note', async () => {
    const adapter = new SolanaAdapter(new FakeSolProvider());
    const receive = await adapter.getReceiveAddress(account);

    expect(receive.address).toBe(ADDRESS);
    expect(receive.derived).toBe(false);
    expect(receive.note).toContain('verify on your signing device before use');
  });

  it('returns SOL, classic SPL, and Token-2022 balances from registry mints', async () => {
    const provider = new FakeSolProvider();
    const adapter = new SolanaAdapter(provider);
    const balances = await adapter.getBalances([
      { address: ADDRESS, chain: 'solana', derived: false },
    ]);

    expect(provider.tokenProgramQueries).toEqual([
      `${ADDRESS}:${SOL_TOKEN_PROGRAM}`,
      `${ADDRESS}:${SOL_TOKEN_2022_PROGRAM}`,
    ]);
    expect(balances).toEqual([
      {
        chain: 'solana',
        address: ADDRESS,
        symbol: 'SOL',
        raw: 2_500_000_000n,
        decimals: 9,
      },
      {
        chain: 'solana',
        address: ADDRESS,
        symbol: 'USDC',
        raw: 100_000_000n,
        decimals: 6,
      },
      {
        chain: 'solana',
        address: ADDRESS,
        symbol: 'PYUSD',
        raw: 50_000_000n,
        decimals: 6,
      },
    ]);
  });

  it('parses Solana history with native and token deltas, signature dedupe, and counterparty', async () => {
    const provider = new FakeSolProvider();
    const adapter = new SolanaAdapter(provider);
    const history = await adapter.getHistory(
      [
        { address: ADDRESS, chain: 'solana', derived: false },
        { address: SECOND_ADDRESS, chain: 'solana', derived: false },
      ],
      { limit: 10 },
    );

    expect(provider.transactionRequests.filter((sig) => sig === selfTx.signature)).toHaveLength(1);
    expect(history).toEqual([
      {
        chain: 'solana',
        txid: 'sig-pyusd-in',
        timestamp: 1_717_000_300,
        direction: 'in',
        symbol: 'PYUSD',
        raw: 50_000_000n,
        decimals: 6,
        counterparty: EXTERNAL_ADDRESS,
        confirmed: true,
      },
      {
        chain: 'solana',
        txid: 'sig-self',
        timestamp: 1_717_000_200,
        direction: 'self',
        symbol: 'SOL',
        raw: 0n,
        decimals: 9,
        confirmed: true,
      },
      {
        chain: 'solana',
        txid: 'sig-usdc-out',
        timestamp: 1_717_000_100,
        direction: 'out',
        symbol: 'USDC',
        raw: 25_000_000n,
        decimals: 6,
        counterparty: EXTERNAL_ADDRESS,
        confirmed: true,
      },
      {
        chain: 'solana',
        txid: 'sig-native-in',
        timestamp: 1_717_000_000,
        direction: 'in',
        symbol: 'SOL',
        raw: 1_000_000_000n,
        decimals: 9,
        counterparty: EXTERNAL_ADDRESS,
        confirmed: true,
      },
    ]);
  });

  it('respects history limits after timestamp sorting', async () => {
    const adapter = new SolanaAdapter(new FakeSolProvider());
    const history = await adapter.getHistory(
      [
        { address: ADDRESS, chain: 'solana', derived: false },
        { address: SECOND_ADDRESS, chain: 'solana', derived: false },
      ],
      { limit: 2 },
    );

    expect(history.map((tx) => tx.txid)).toEqual(['sig-pyusd-in', 'sig-self']);
  });
});

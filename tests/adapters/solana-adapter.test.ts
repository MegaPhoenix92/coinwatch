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

class FakeSolProvider implements SolDataProvider {
  readonly tokenProgramQueries: string[] = [];

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
    return [];
  }

  async getTransaction(_signature: string): Promise<SolRawTx | undefined> {
    return undefined;
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
    await expect(adapter.resolveAddresses(account)).resolves.toEqual<DerivedAddress[]>([
      { address: ADDRESS, chain: 'solana', derived: false },
      { address: SECOND_ADDRESS, chain: 'solana', derived: false },
    ]);
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
});

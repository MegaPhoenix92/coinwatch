import { describe, expect, it } from 'vitest';
import { EvmAdapter } from '../../src/adapters/evm-adapter.js';
import type {
  EvmDataProvider,
  EvmRawTransfer,
  EvmTokenBalance,
} from '../../src/adapters/chain-adapter.js';
import type { AccountDescriptor, DerivedAddress } from '../../src/domain/account.js';
import type { EvmChain } from '../../src/domain/chains.js';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const USDC_ETH = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

class FakeEvmProvider implements EvmDataProvider {
  async getNativeBalance(_chain: EvmChain, _address: string): Promise<bigint> {
    return 1_000_000_000_000_000_000n;
  }

  async getTokenBalances(
    _chain: EvmChain,
    _address: string,
    tokenAddresses: string[],
  ): Promise<EvmTokenBalance[]> {
    return tokenAddresses.map((tokenAddress) => ({
      address: tokenAddress.toLowerCase(),
      raw: tokenAddress.toLowerCase() === USDC_ETH ? 100_000_000n : 0n,
    }));
  }

  async getTransfers(
    _chain: EvmChain,
    _address: string,
    _limit: number,
  ): Promise<EvmRawTransfer[]> {
    return [];
  }
}

const account: AccountDescriptor = {
  id: 'evm-1',
  label: 'My EVM wallet',
  family: 'evm',
  chains: ['ethereum', 'base'],
  source: { kind: 'addresses', addresses: [ADDRESS.toUpperCase()] },
};

describe('EvmAdapter', () => {
  it('reports false for derivesAddresses', () => {
    const adapter = new EvmAdapter(new FakeEvmProvider());
    expect(adapter.family).toBe('evm');
    expect(adapter.capabilities.derivesAddresses).toBe(false);
  });

  it('resolves literal addresses lowercased for every configured EVM chain', async () => {
    const adapter = new EvmAdapter(new FakeEvmProvider());
    const resolved = await adapter.resolveAddresses(account);

    expect(resolved).toEqual<DerivedAddress[]>([
      { address: ADDRESS, chain: 'ethereum', derived: false },
      { address: ADDRESS, chain: 'base', derived: false },
    ]);
  });

  it('returns the first address as receive address with the device-verify note', async () => {
    const adapter = new EvmAdapter(new FakeEvmProvider());
    const recv = await adapter.getReceiveAddress(account);

    expect(recv.address).toBe(ADDRESS);
    expect(recv.derived).toBe(false);
    expect(recv.note).toContain('verify on your signing device before use');
  });

  it('returns native ETH and non-zero registry token balances', async () => {
    const adapter = new EvmAdapter(new FakeEvmProvider());
    const resolved = await adapter.resolveAddresses({ ...account, chains: ['ethereum'] });
    const balances = await adapter.getBalances(resolved);

    const eth = balances.find((balance) => balance.symbol === 'ETH');
    expect(eth).toEqual({
      chain: 'ethereum',
      address: ADDRESS,
      symbol: 'ETH',
      raw: 1_000_000_000_000_000_000n,
      decimals: 18,
    });

    const usdc = balances.find((balance) => balance.symbol === 'USDC');
    expect(usdc).toEqual({
      chain: 'ethereum',
      address: ADDRESS,
      symbol: 'USDC',
      raw: 100_000_000n,
      decimals: 6,
    });

    expect(balances.some((balance) => balance.symbol === 'USDT')).toBe(false);
  });
});

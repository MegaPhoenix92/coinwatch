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
const CHANGE_ADDRESS = '0x2222222222222222222222222222222222222222';
const EXTERNAL_ADDRESS = '0x3333333333333333333333333333333333333333';
const USDC_ETH = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

const inboundNativeTransfer: EvmRawTransfer = {
  txid: '0xaaa',
  from: EXTERNAL_ADDRESS,
  to: ADDRESS,
  rawValue: 1_000_000_000_000_000_000n,
  asset: 'ETH',
  timestamp: 1700000000,
};

const outboundUsdcLeg1: EvmRawTransfer = {
  txid: '0xbbb',
  from: ADDRESS,
  to: EXTERNAL_ADDRESS,
  rawValue: 25_000_000n,
  asset: USDC_ETH,
  timestamp: 1700000100,
};

const outboundUsdcDuplicateFromSecondAddress: EvmRawTransfer = {
  ...outboundUsdcLeg1,
};

const selfNativeLeg1: EvmRawTransfer = {
  txid: '0xccc',
  from: ADDRESS,
  to: CHANGE_ADDRESS,
  rawValue: 5_000_000_000_000_000n,
  asset: 'ETH',
  timestamp: 1700000200,
};

const selfNativeLeg2: EvmRawTransfer = {
  ...selfNativeLeg1,
  from: CHANGE_ADDRESS,
  to: ADDRESS,
};

class FakeEvmProvider implements EvmDataProvider {
  constructor(private readonly transfers: EvmRawTransfer[] = []) {}

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
    address: string,
    _limit: number,
  ): Promise<EvmRawTransfer[]> {
    const lower = address.toLowerCase();
    return this.transfers.filter((transfer) => {
      return transfer.from.toLowerCase() === lower || transfer.to.toLowerCase() === lower;
    });
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

  it('maps EVM transfer history with txid dedupe, watched-set netting, counterparty, and timestamp ordering', async () => {
    const adapter = new EvmAdapter(
      new FakeEvmProvider([
        inboundNativeTransfer,
        outboundUsdcLeg1,
        outboundUsdcDuplicateFromSecondAddress,
        selfNativeLeg1,
        selfNativeLeg2,
      ]),
    );
    const addresses: DerivedAddress[] = [
      { address: ADDRESS, chain: 'ethereum', derived: false },
      { address: CHANGE_ADDRESS, chain: 'ethereum', derived: false },
    ];

    const history = await adapter.getHistory(addresses, { limit: 10 });

    expect(history).toEqual([
      {
        chain: 'ethereum',
        txid: '0xccc',
        timestamp: 1700000200,
        direction: 'self',
        symbol: 'ETH',
        raw: 0n,
        decimals: 18,
        confirmed: true,
      },
      {
        chain: 'ethereum',
        txid: '0xbbb',
        timestamp: 1700000100,
        direction: 'out',
        symbol: 'USDC',
        raw: 25_000_000n,
        decimals: 6,
        counterparty: EXTERNAL_ADDRESS,
        confirmed: true,
      },
      {
        chain: 'ethereum',
        txid: '0xaaa',
        timestamp: 1700000000,
        direction: 'in',
        symbol: 'ETH',
        raw: 1_000_000_000_000_000_000n,
        decimals: 18,
        counterparty: EXTERNAL_ADDRESS,
        confirmed: true,
      },
    ]);
  });

  it('respects history limits after timestamp sorting', async () => {
    const adapter = new EvmAdapter(
      new FakeEvmProvider([inboundNativeTransfer, outboundUsdcLeg1, selfNativeLeg1]),
    );
    const history = await adapter.getHistory(
      [
        { address: ADDRESS, chain: 'ethereum', derived: false },
        { address: CHANGE_ADDRESS, chain: 'ethereum', derived: false },
      ],
      { limit: 1 },
    );

    expect(history).toHaveLength(1);
    expect(history[0]?.txid).toBe('0xccc');
  });
});

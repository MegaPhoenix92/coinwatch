import { describe, expect, it } from 'vitest';
import { ViemProvider, type ViemClient } from '../../src/providers/viem.js';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const EXTERNAL = '0x2222222222222222222222222222222222222222';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

class FakeViemClient implements ViemClient {
  readonly requests: {
    method: 'alchemy_getAssetTransfers';
    params: Parameters<ViemClient['request']>[0]['params'];
  }[] = [];

  async getBalance(): Promise<bigint> {
    return 0n;
  }

  async getTransactionCount(): Promise<number> {
    return 7;
  }

  async estimateGas(): Promise<bigint> {
    return 21_000n;
  }

  async estimateFeesPerGas(): Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }> {
    return { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  }

  async multicall(): Promise<readonly []> {
    return [];
  }

  async request(args: Parameters<ViemClient['request']>[0]) {
    this.requests.push(args);
    const [params] = args.params;
    if (params.fromAddress !== undefined) {
      return {
        transfers: [
          {
            uniqueId: 'native-out',
            hash: '0xnativeout',
            from: ADDRESS,
            to: EXTERNAL,
            value: 1,
            asset: 'ETH',
            category: 'external',
            rawContract: { value: '0xde0b6b3a7640000', address: null, decimal: '0x12' },
            metadata: { blockTimestamp: '2024-01-01T00:00:00.000Z' },
          },
          {
            uniqueId: 'self-transfer',
            hash: '0xself',
            from: ADDRESS,
            to: ADDRESS,
            value: 0.25,
            asset: 'ETH',
            category: 'external',
            rawContract: { value: '0x3782dace9d90000', address: null, decimal: '0x12' },
            metadata: { blockTimestamp: '2024-01-01T00:02:00.000Z' },
          },
        ],
      };
    }

    return {
      transfers: [
        {
          uniqueId: 'erc20-in',
          hash: '0xerc20in',
          from: EXTERNAL,
          to: ADDRESS,
          value: 25,
          asset: null,
          category: 'erc20',
          rawContract: { value: '0x17d7840', address: USDC, decimal: '0x6' },
          metadata: { blockTimestamp: '2024-01-01T00:01:00.000Z' },
        },
        {
          uniqueId: 'self-transfer',
          hash: '0xself',
          from: ADDRESS,
          to: ADDRESS,
          value: 0.25,
          asset: 'ETH',
          category: 'external',
          rawContract: { value: '0x3782dace9d90000', address: null, decimal: '0x12' },
          metadata: { blockTimestamp: '2024-01-01T00:02:00.000Z' },
        },
      ],
    };
  }
}

describe('ViemProvider.getTransfers', () => {
  it('fetches Alchemy asset transfers from and to the watched address', async () => {
    const client = new FakeViemClient();
    const provider = new ViemProvider({
      alchemyApiKey: 'test-key',
      clients: { ethereum: client },
    });

    const transfers = await provider.getTransfers('ethereum', ADDRESS.toUpperCase(), 25);

    expect(client.requests).toHaveLength(2);
    expect(client.requests[0]).toEqual({
      method: 'alchemy_getAssetTransfers',
      params: [
        {
          fromBlock: '0x0',
          toBlock: 'latest',
          category: ['external', 'internal', 'erc20'],
          withMetadata: true,
          excludeZeroValue: true,
          order: 'desc',
          maxCount: '0x19',
          fromAddress: ADDRESS,
        },
      ],
    });
    expect(client.requests[1]?.params[0]).toMatchObject({ toAddress: ADDRESS });
    expect(client.requests[1]?.params[0]).not.toHaveProperty('fromAddress');
    expect(transfers).toEqual([
      {
        txid: '0xnativeout',
        from: ADDRESS,
        to: EXTERNAL,
        rawValue: 1_000_000_000_000_000_000n,
        asset: 'ETH',
        timestamp: 1704067200,
      },
      {
        txid: '0xself',
        from: ADDRESS,
        to: ADDRESS,
        rawValue: 250_000_000_000_000_000n,
        asset: 'ETH',
        timestamp: 1704067320,
      },
      {
        txid: '0xerc20in',
        from: EXTERNAL,
        to: ADDRESS,
        rawValue: 25_000_000n,
        asset: USDC,
        timestamp: 1704067260,
      },
    ]);
  });

  it('returns no history without an Alchemy key', async () => {
    const client = new FakeViemClient();
    const provider = new ViemProvider({ clients: { ethereum: client } });

    await expect(provider.getTransfers('ethereum', ADDRESS, 25)).resolves.toEqual([]);
    expect(client.requests).toEqual([]);
  });

  it('degrades to no history when the RPC does not support alchemy_getAssetTransfers', async () => {
    const client = new FakeViemClient();
    client.request = async () => {
      throw { code: -32601, message: 'method not found' };
    };
    const provider = new ViemProvider({
      alchemyApiKey: 'test-key',
      clients: { ethereum: client },
    });

    await expect(provider.getTransfers('ethereum', ADDRESS, 25)).resolves.toEqual([]);
  });

  it('exposes read-only nonce, gas, fee, and chain-id calls for transfer construction', async () => {
    const client = new FakeViemClient();
    const provider = new ViemProvider({ clients: { ethereum: client } });

    await expect(provider.getTransactionCount('ethereum', ADDRESS)).resolves.toBe(7);
    await expect(
      provider.estimateGas('ethereum', {
        from: ADDRESS,
        to: EXTERNAL,
        value: 1n,
      }),
    ).resolves.toBe(21_000n);
    await expect(provider.getFeesPerGas('ethereum')).resolves.toEqual({
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    });
    expect(provider.getChainId('ethereum')).toBe(1);
  });
});

import { sha256 } from '@noble/hashes/sha2.js';
import { hex } from '@scure/base';
import { encodeFunctionData, erc20Abi, parseTransaction } from 'viem';
import { describe, expect, it } from 'vitest';
import { EvmAdapter } from '../../src/adapters/evm-adapter.js';
import type {
  EvmDataProvider,
  EvmGasEstimateRequest,
  EvmRawTransfer,
  EvmTokenBalance,
} from '../../src/adapters/chain-adapter.js';
import type { EvmChain } from '../../src/domain/chains.js';

const FROM = '0x0000000000000000000000000000000000000001';
const TO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

const account = {
  id: 'evm',
  label: 'EVM',
  family: 'evm' as const,
  chains: ['ethereum' as const],
  source: { kind: 'addresses' as const, addresses: [FROM] },
};

class FakeEvmProvider implements EvmDataProvider {
  readonly gasRequests: EvmGasEstimateRequest[] = [];
  readonly calls = { getTransactionCount: 0, estimateGas: 0, getFeesPerGas: 0, getChainId: 0 };

  async getNativeBalance(): Promise<bigint> {
    return 0n;
  }

  async getTokenBalances(): Promise<EvmTokenBalance[]> {
    return [];
  }

  async getTransfers(): Promise<EvmRawTransfer[]> {
    return [];
  }

  async getTransactionCount(): Promise<number> {
    this.calls.getTransactionCount += 1;
    return 7;
  }

  async estimateGas(_chain: EvmChain, req: EvmGasEstimateRequest): Promise<bigint> {
    this.calls.estimateGas += 1;
    this.gasRequests.push(req);
    return req.data === undefined ? 21_000n : 65_000n;
  }

  async getFeesPerGas(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    this.calls.getFeesPerGas += 1;
    return { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  }

  getChainId(): number {
    this.calls.getChainId += 1;
    return 1;
  }
}

function expectUnsigned(parsed: ReturnType<typeof parseTransaction>): void {
  expect('v' in parsed).toBe(false);
  expect('r' in parsed).toBe(false);
  expect('s' in parsed).toBe(false);
}

describe('EvmAdapter.buildUnsignedTransfer', () => {
  it('builds an unsigned EIP-1559 native ETH transaction', async () => {
    const provider = new FakeEvmProvider();
    const adapter = new EvmAdapter(provider);

    const artifact = await adapter.buildUnsignedTransfer({
      account,
      chain: 'ethereum',
      to: TO,
      asset: 'ETH',
      rawAmount: 1_000_000_000_000_000n,
    });

    expect(adapter.capabilities.preparesTransfers).toBe(true);
    expect(artifact.kind).toBe('evm-eip1559');
    expect(artifact.payload.startsWith('0x02')).toBe(true);
    const parsed = parseTransaction(artifact.payload as `0x${string}`);
    expect(parsed.to?.toLowerCase()).toBe(TO.toLowerCase());
    expect(parsed.value).toBe(1_000_000_000_000_000n);
    expect(parsed.nonce).toBe(7);
    expect(parsed.gas).toBe(21_000n);
    expectUnsigned(parsed);
    expect(artifact.summary).toMatchObject({
      chain: 'ethereum',
      asset: 'ETH',
      from: FROM,
      to: TO,
      rawAmount: '1000000000000000',
      feeAsset: 'ETH',
    });
    expect(artifact.summary.rawFee).toBe((21_000n * 30_000_000_000n).toString());
    expect(artifact.summary.artifactHash).toBe(
      hex.encode(sha256(new TextEncoder().encode(artifact.payload))),
    );
  });

  it('builds an unsigned EIP-1559 ERC-20 transfer transaction', async () => {
    const provider = new FakeEvmProvider();
    const adapter = new EvmAdapter(provider);
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [TO, 25_000_000n],
    });

    const artifact = await adapter.buildUnsignedTransfer({
      account,
      chain: 'ethereum',
      to: TO,
      asset: 'USDC',
      rawAmount: 25_000_000n,
    });

    const parsed = parseTransaction(artifact.payload as `0x${string}`);
    expect(parsed.to?.toLowerCase()).toBe(USDC);
    expect(parsed.value ?? 0n).toBe(0n);
    expect(parsed.data).toBe(data);
    expectUnsigned(parsed);
    expect(provider.gasRequests[0]).toEqual({
      from: FROM,
      to: USDC,
      value: 0n,
      data,
    });
    expect(artifact.summary).toMatchObject({
      asset: 'USDC',
      to: TO,
      amount: '25',
      rawAmount: '25000000',
      decimals: 6,
      feeAsset: 'ETH',
    });
  });

  it('treats the feeRate override as gwei and converts it to wei', async () => {
    const provider = new FakeEvmProvider();
    const adapter = new EvmAdapter(provider);

    const artifact = await adapter.buildUnsignedTransfer({
      account,
      chain: 'ethereum',
      to: TO,
      asset: 'ETH',
      rawAmount: 1_000_000_000_000_000n,
      feeRate: 30n, // 30 gwei
    });

    const parsed = parseTransaction(artifact.payload as `0x${string}`);
    // 30 gwei -> 30e9 wei (NOT 30 wei). Priority = max / 2.
    expect(parsed.maxFeePerGas).toBe(30_000_000_000n);
    expect(parsed.maxPriorityFeePerGas).toBe(15_000_000_000n);
    // rawFee = gas (21_000 native) * maxFeePerGas (30 gwei in wei).
    expect(artifact.summary.rawFee).toBe((21_000n * 30_000_000_000n).toString());
    expectUnsigned(parsed);
  });

  it('rejects invalid recipients before reading provider data', async () => {
    const provider = new FakeEvmProvider();
    const adapter = new EvmAdapter(provider);

    await expect(
      adapter.buildUnsignedTransfer({
        account,
        chain: 'ethereum',
        to: '0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
        asset: 'ETH',
        rawAmount: 1_000_000_000_000_000n,
      }),
    ).rejects.toThrow(/Invalid ethereum recipient address/);
    expect(provider.calls).toEqual({
      getTransactionCount: 0,
      estimateGas: 0,
      getFeesPerGas: 0,
      getChainId: 0,
    });
    expect(provider.gasRequests).toEqual([]);
  });

  it('rejects wrong-chain and unsupported-asset requests before reading provider data', async () => {
    const provider = new FakeEvmProvider();
    const adapter = new EvmAdapter(provider);

    await expect(
      adapter.buildUnsignedTransfer({
        account,
        chain: 'solana',
        to: '11111111111111111111111111111112',
        asset: 'SOL',
        rawAmount: 1_000_000n,
      }),
    ).rejects.toThrow(/not an EVM chain/);
    await expect(
      adapter.buildUnsignedTransfer({
        account,
        chain: 'ethereum',
        to: TO,
        asset: 'POL',
        rawAmount: 1_000_000_000_000_000n,
      }),
    ).rejects.toThrow(/Asset POL is not available on ethereum/);
    expect(provider.calls).toEqual({
      getTransactionCount: 0,
      estimateGas: 0,
      getFeesPerGas: 0,
      getChainId: 0,
    });
    expect(provider.gasRequests).toEqual([]);
  });
});

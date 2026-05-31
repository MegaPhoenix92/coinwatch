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
    return 7;
  }

  async estimateGas(_chain: EvmChain, req: EvmGasEstimateRequest): Promise<bigint> {
    this.gasRequests.push(req);
    return req.data === undefined ? 21_000n : 65_000n;
  }

  async getFeesPerGas(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    return { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  }

  getChainId(): number {
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
});

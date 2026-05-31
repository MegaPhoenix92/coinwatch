import { sha256 } from '@noble/hashes/sha2.js';
import { base64, hex } from '@scure/base';
import { getCompiledTransactionMessageDecoder } from '@solana/kit';
import { getTransferSolInstructionDataDecoder } from '@solana-program/system';
import { describe, expect, it } from 'vitest';
import { SolanaAdapter } from '../../src/adapters/solana-adapter.js';
import type {
  SolDataProvider,
  SolRawTx,
  SolTokenAccount,
} from '../../src/adapters/chain-adapter.js';

const FROM = '11111111111111111111111111111112';
const TO = '11111111111111111111111111111113';
// A real-shaped blockhash DISTINCT from the SystemProgram id, so the
// lifetimeToken assertion below genuinely exercises blockhash threading.
// (The all-1s placeholder collides with SystemProgram = staticAccounts[2],
// which made the prior blockhash check a structural no-op.)
const BLOCKHASH = 'Gk1noHWTQfA1n4Jc3pj3vHWqUdt4PUmTPGUNQv88L7gd';

const account = {
  id: 'sol',
  label: 'SOL',
  family: 'solana' as const,
  chains: ['solana' as const],
  source: { kind: 'addresses' as const, addresses: [FROM] },
};

const fake: SolDataProvider = {
  async getLamports(): Promise<bigint> {
    return 0n;
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
    return { blockhash: BLOCKHASH, lastValidBlockHeight: 123n };
  },
  async getAccountExists(): Promise<boolean> {
    return true;
  },
};

function trackingSolProvider(): SolDataProvider & {
  calls: {
    getLamports: number;
    getTokenAccounts: number;
    getSignatures: number;
    getTransaction: number;
    getLatestBlockhash: number;
    getAccountExists: number;
  };
} {
  const calls = {
    getLamports: 0,
    getTokenAccounts: 0,
    getSignatures: 0,
    getTransaction: 0,
    getLatestBlockhash: 0,
    getAccountExists: 0,
  };
  return {
    calls,
    async getLamports(): Promise<bigint> {
      calls.getLamports += 1;
      return 0n;
    },
    async getTokenAccounts(): Promise<SolTokenAccount[]> {
      calls.getTokenAccounts += 1;
      return [];
    },
    async getSignatures(): Promise<SolRawTx[]> {
      calls.getSignatures += 1;
      return [];
    },
    async getTransaction(): Promise<SolRawTx | undefined> {
      calls.getTransaction += 1;
      return undefined;
    },
    async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
      calls.getLatestBlockhash += 1;
      return { blockhash: BLOCKHASH, lastValidBlockHeight: 123n };
    },
    async getAccountExists(): Promise<boolean> {
      calls.getAccountExists += 1;
      return true;
    },
  };
}

describe('SolanaAdapter.buildUnsignedTransfer', () => {
  it('builds unsigned Solana message bytes for a native SOL transfer', async () => {
    const adapter = new SolanaAdapter(fake);
    const artifact = await adapter.buildUnsignedTransfer({
      account,
      chain: 'solana',
      to: TO,
      asset: 'SOL',
      rawAmount: 1_000_000n,
    });

    expect(adapter.capabilities.preparesTransfers).toBe(true);
    expect(artifact.kind).toBe('solana-message');
    const messageBytes = base64.decode(artifact.payload);
    expect(messageBytes.length).toBeGreaterThan(0);
    const decoded = getCompiledTransactionMessageDecoder().decode(messageBytes);
    expect(decoded.version).toBe(0);
    expect(decoded.header.numSignerAccounts).toBe(1);
    expect(decoded.staticAccounts).toEqual([
      FROM,
      TO,
      '11111111111111111111111111111111',
    ]);
    expect((decoded as { instructions: unknown[] }).instructions).toHaveLength(1);
    expect('signatures' in decoded).toBe(false);
    // Blockhash genuinely threaded into the message (lifetimeToken, NOT the
    // staticAccounts[2]=SystemProgram structural invariant a no-op check hit).
    expect((decoded as { lifetimeToken: string }).lifetimeToken).toBe(BLOCKHASH);
    // Decode the instruction so a source/dest SWAP or WRONG AMOUNT is caught —
    // both compile to identical staticAccounts and would otherwise pass green.
    const instruction = (
      decoded as unknown as {
        instructions: { programAddressIndex: number; accountIndices?: readonly number[]; data: Uint8Array }[];
      }
    ).instructions[0];
    expect(instruction.programAddressIndex).toBe(2); // SystemProgram
    expect(Array.from(instruction.accountIndices ?? [])).toEqual([0, 1]); // [source=FROM, destination=TO]
    expect(getTransferSolInstructionDataDecoder().decode(instruction.data).amount).toBe(1_000_000n);
    expect(artifact.summary).toMatchObject({
      chain: 'solana',
      asset: 'SOL',
      from: FROM,
      to: TO,
      amount: '0.001',
      rawAmount: '1000000',
      decimals: 9,
      fee: '0.000005',
      rawFee: '5000',
      feeAsset: 'SOL',
    });
    expect(artifact.summary.artifactHash).toBe(hex.encode(sha256(messageBytes)));
  });

  it('builds SPL token transfer construction in Phase 2.1', async () => {
    const adapter = new SolanaAdapter(fake);

    const artifact = await adapter.buildUnsignedTransfer({
      account,
      chain: 'solana',
      to: TO,
      asset: 'USDC',
      rawAmount: 1_000_000n,
    });

    expect(artifact.kind).toBe('solana-message');
    expect(artifact.summary).toMatchObject({
      asset: 'USDC',
      to: TO,
      rawAmount: '1000000',
      decimals: 6,
      feeAsset: 'SOL',
    });
  });

  it('rejects invalid recipients before reading provider data', async () => {
    const provider = trackingSolProvider();
    const adapter = new SolanaAdapter(provider);

    await expect(
      adapter.buildUnsignedTransfer({
        account,
        chain: 'solana',
        to: 'bad sol',
        asset: 'SOL',
        rawAmount: 1_000_000n,
      }),
    ).rejects.toThrow(/Invalid solana recipient address/);
    expect(provider.calls).toEqual({
      getLamports: 0,
      getTokenAccounts: 0,
      getSignatures: 0,
      getTransaction: 0,
      getLatestBlockhash: 0,
      getAccountExists: 0,
    });
  });

  it('rejects wrong-chain and unsupported-asset requests before reading provider data', async () => {
    const provider = trackingSolProvider();
    const adapter = new SolanaAdapter(provider);

    await expect(
      adapter.buildUnsignedTransfer({
        account,
        chain: 'ethereum',
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        asset: 'ETH',
        rawAmount: 1_000_000n,
      }),
    ).rejects.toThrow(/cannot prepare transfers for ethereum/);
    await expect(
      adapter.buildUnsignedTransfer({
        account,
        chain: 'solana',
        to: TO,
        asset: 'BTC',
        rawAmount: 1_000_000n,
      }),
    ).rejects.toThrow(/Asset BTC is not available on solana/);
    expect(provider.calls).toEqual({
      getLamports: 0,
      getTokenAccounts: 0,
      getSignatures: 0,
      getTransaction: 0,
      getLatestBlockhash: 0,
      getAccountExists: 0,
    });
  });
});

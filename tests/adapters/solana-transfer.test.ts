import { sha256 } from '@noble/hashes/sha2.js';
import { base64, hex } from '@scure/base';
import { getCompiledTransactionMessageDecoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { SolanaAdapter } from '../../src/adapters/solana-adapter.js';
import type {
  SolDataProvider,
  SolRawTx,
  SolTokenAccount,
} from '../../src/adapters/chain-adapter.js';

const FROM = '11111111111111111111111111111112';
const TO = '11111111111111111111111111111113';

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
    return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 123n };
  },
};

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

  it('defers SPL token transfer construction to Phase 2.1', async () => {
    const adapter = new SolanaAdapter(fake);

    await expect(
      adapter.buildUnsignedTransfer({
        account,
        chain: 'solana',
        to: TO,
        asset: 'USDC',
        rawAmount: 1_000_000n,
      }),
    ).rejects.toThrow('Solana SPL token transfers are deferred (Phase 2.1).');
  });
});

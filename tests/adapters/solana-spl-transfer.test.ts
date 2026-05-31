import { sha256 } from '@noble/hashes/sha2.js';
import { base64, hex } from '@scure/base';
import { address, getCompiledTransactionMessageDecoder } from '@solana/kit';
import {
  findAssociatedTokenPda as findSplAssociatedTokenPda,
  getTransferCheckedInstructionDataDecoder as getSplTransferCheckedInstructionDataDecoder,
} from '@solana-program/token';
import {
  findAssociatedTokenPda as findToken2022AssociatedTokenPda,
  getTransferCheckedInstructionDataDecoder as getToken2022TransferCheckedInstructionDataDecoder,
} from '@solana-program/token-2022';
import { describe, expect, it } from 'vitest';
import { SolanaAdapter } from '../../src/adapters/solana-adapter.js';
import type {
  SolDataProvider,
  SolRawTx,
  SolTokenAccount,
} from '../../src/adapters/chain-adapter.js';
import {
  SOL_TOKEN_2022_PROGRAM,
  SOL_TOKEN_PROGRAM,
  assetBySymbol,
} from '../../src/domain/assets.js';

const FROM = '11111111111111111111111111111112';
const TO = '11111111111111111111111111111113';
const BLOCKHASH = 'Gk1noHWTQfA1n4Jc3pj3vHWqUdt4PUmTPGUNQv88L7gd';
const USDC = assetBySymbol('solana', 'USDC');
const PYUSD = assetBySymbol('solana', 'PYUSD');

const account = {
  id: 'sol',
  label: 'SOL',
  family: 'solana' as const,
  chains: ['solana' as const],
  source: { kind: 'addresses' as const, addresses: [FROM] },
};

class FakeSolProvider implements SolDataProvider {
  readonly existsQueries: string[] = [];

  constructor(private readonly existingAccounts: Set<string>) {}

  async getLamports(): Promise<bigint> {
    return 0n;
  }

  async getTokenAccounts(): Promise<SolTokenAccount[]> {
    return [];
  }

  async getSignatures(): Promise<SolRawTx[]> {
    return [];
  }

  async getTransaction(): Promise<SolRawTx | undefined> {
    return undefined;
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    return { blockhash: BLOCKHASH, lastValidBlockHeight: 123n };
  }

  async getAccountExists(accountAddress: string): Promise<boolean> {
    this.existsQueries.push(accountAddress);
    return this.existingAccounts.has(accountAddress);
  }
}

async function splAtas() {
  if (USDC?.address === undefined) {
    throw new Error('USDC mint missing from registry');
  }
  const mint = address(USDC.address);
  const tokenProgram = address(SOL_TOKEN_PROGRAM);
  const [source] = await findSplAssociatedTokenPda({
    owner: address(FROM),
    mint,
    tokenProgram,
  });
  const [destination] = await findSplAssociatedTokenPda({
    owner: address(TO),
    mint,
    tokenProgram,
  });
  return { mint, tokenProgram, source, destination };
}

async function token2022Atas() {
  if (PYUSD?.address === undefined) {
    throw new Error('PYUSD mint missing from registry');
  }
  const mint = address(PYUSD.address);
  const tokenProgram = address(SOL_TOKEN_2022_PROGRAM);
  const [source] = await findToken2022AssociatedTokenPda({
    owner: address(FROM),
    mint,
    tokenProgram,
  });
  const [destination] = await findToken2022AssociatedTokenPda({
    owner: address(TO),
    mint,
    tokenProgram,
  });
  return { mint, tokenProgram, source, destination };
}

function decodePayload(payload: string) {
  return getCompiledTransactionMessageDecoder().decode(base64.decode(payload));
}

describe('SolanaAdapter.buildUnsignedTransfer SPL tokens', () => {
  it('builds an unsigned SPL Token transfer_checked message for USDC', async () => {
    const atas = await splAtas();
    const provider = new FakeSolProvider(new Set([atas.source, atas.destination]));
    const adapter = new SolanaAdapter(provider);

    const artifact = await adapter.buildUnsignedTransfer({
      account,
      chain: 'solana',
      to: TO,
      asset: 'USDC',
      rawAmount: 25_000_000n,
    });

    expect(artifact.kind).toBe('solana-message');
    expect(artifact.summary).toMatchObject({
      chain: 'solana',
      asset: 'USDC',
      from: FROM,
      to: TO,
      amount: '25',
      rawAmount: '25000000',
      decimals: 6,
      fee: '0.000005',
      rawFee: '5000',
      feeAsset: 'SOL',
    });
    expect(artifact.summary.artifactHash).toBe(hex.encode(sha256(base64.decode(artifact.payload))));
    expect(provider.existsQueries).toEqual([atas.source, atas.destination]);

    const decoded = decodePayload(artifact.payload);
    expect(decoded.header.numSignerAccounts).toBe(1);
    expect(decoded.staticAccounts).toEqual([FROM, atas.destination, atas.source, atas.mint, atas.tokenProgram]);
    const instruction = (
      decoded as unknown as {
        instructions: { programAddressIndex: number; accountIndices?: readonly number[]; data: Uint8Array }[];
      }
    ).instructions[0];
    expect(decoded.staticAccounts[instruction.programAddressIndex]).toBe(atas.tokenProgram);
    expect((instruction.accountIndices ?? []).map((index) => decoded.staticAccounts[index])).toEqual([
      atas.source,
      atas.mint,
      atas.destination,
      FROM,
    ]);
    expect(getSplTransferCheckedInstructionDataDecoder().decode(instruction.data)).toEqual({
      discriminator: 12,
      amount: 25_000_000n,
      decimals: 6,
    });
  });

  it('builds an unsigned Token-2022 transfer_checked message for PYUSD', async () => {
    const atas = await token2022Atas();
    const provider = new FakeSolProvider(new Set([atas.source, atas.destination]));
    const adapter = new SolanaAdapter(provider);

    const artifact = await adapter.buildUnsignedTransfer({
      account,
      chain: 'solana',
      to: TO,
      asset: 'PYUSD',
      rawAmount: 12_345_678n,
    });

    expect(artifact.summary).toMatchObject({
      asset: 'PYUSD',
      to: TO,
      amount: '12.345678',
      rawAmount: '12345678',
      decimals: 6,
      feeAsset: 'SOL',
    });
    expect(provider.existsQueries).toEqual([atas.source, atas.destination]);

    const decoded = decodePayload(artifact.payload);
    const instruction = (
      decoded as unknown as {
        instructions: { programAddressIndex: number; accountIndices?: readonly number[]; data: Uint8Array }[];
      }
    ).instructions[0];
    expect(decoded.staticAccounts[instruction.programAddressIndex]).toBe(atas.tokenProgram);
    expect((instruction.accountIndices ?? []).map((index) => decoded.staticAccounts[index])).toEqual([
      atas.source,
      atas.mint,
      atas.destination,
      FROM,
    ]);
    expect(getToken2022TransferCheckedInstructionDataDecoder().decode(instruction.data)).toEqual({
      discriminator: 12,
      amount: 12_345_678n,
      decimals: 6,
    });
  });

  it('requires the recipient token account to already exist', async () => {
    const atas = await splAtas();
    const provider = new FakeSolProvider(new Set([atas.source]));
    const adapter = new SolanaAdapter(provider);

    await expect(
      adapter.buildUnsignedTransfer({
        account,
        chain: 'solana',
        to: TO,
        asset: 'USDC',
        rawAmount: 1_000_000n,
      }),
    ).rejects.toThrow(
      'Recipient has no USDC token account; have them create it first - coinwatch never creates accounts.',
    );
    expect(provider.existsQueries).toEqual([atas.source, atas.destination]);
  });

  it('requires the sender token account to already exist', async () => {
    const atas = await splAtas();
    const provider = new FakeSolProvider(new Set([atas.destination]));
    const adapter = new SolanaAdapter(provider);

    await expect(
      adapter.buildUnsignedTransfer({
        account,
        chain: 'solana',
        to: TO,
        asset: 'USDC',
        rawAmount: 1_000_000n,
      }),
    ).rejects.toThrow('This account has no USDC token account.');
    expect(provider.existsQueries).toEqual([atas.source]);
  });
});

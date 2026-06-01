import { sha256 } from '@noble/hashes/sha2.js';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
  address,
  assertIsFullySignedTransaction,
  generateKeyPairSigner,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  signTransaction,
  type Transaction,
} from '@solana/kit';
import {
  findAssociatedTokenPda as findSplAssociatedTokenPda,
  getTransferCheckedInstructionDataDecoder as getSplTransferCheckedInstructionDataDecoder,
} from '@solana-program/token';
import { getTransferSolInstructionDataDecoder } from '@solana-program/system';
import { describe, expect, it } from 'vitest';
import { parseTransaction, recoverTransactionAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BitcoinAdapter } from '../../src/adapters/bitcoin-adapter.js';
import { EvmAdapter } from '../../src/adapters/evm-adapter.js';
import { SolanaAdapter } from '../../src/adapters/solana-adapter.js';
import type {
  BtcDataProvider,
  BtcUtxo,
  EvmDataProvider,
  EvmGasEstimateRequest,
  EvmRawTransfer,
  EvmTokenBalance,
  MempoolAddressResponse,
  MempoolTx,
  SolDataProvider,
  SolRawTx,
  SolTokenAccount,
} from '../../src/adapters/chain-adapter.js';
import type { AccountDescriptor } from '../../src/domain/account.js';
import { SOL_TOKEN_PROGRAM, assetBySymbol } from '../../src/domain/assets.js';
import type { EvmChain } from '../../src/domain/chains.js';

const BTC_TO = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const EVM_TO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const SOL_BLOCKHASH = 'Gk1noHWTQfA1n4Jc3pj3vHWqUdt4PUmTPGUNQv88L7gd';
const BTC_INPUT_TXID = hex.encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

class FakeBtcProvider implements BtcDataProvider {
  constructor(private readonly utxoAddress: string) {}

  async getAddress(address: string): Promise<MempoolAddressResponse> {
    return {
      address,
      chain_stats: { funded_txo_sum: 200_000, spent_txo_sum: 0, tx_count: 1 },
      mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
    };
  }

  async getAddressTxs(): Promise<MempoolTx[]> {
    return [];
  }

  async getUtxos(address: string): Promise<BtcUtxo[]> {
    return address === this.utxoAddress
      ? [{ txid: BTC_INPUT_TXID, vout: 0, value: 200_000 }]
      : [];
  }
}

class FakeEvmProvider implements EvmDataProvider {
  async getNativeBalance(): Promise<bigint> {
    return 10_000_000_000_000_000_000n;
  }

  async getTokenBalances(): Promise<EvmTokenBalance[]> {
    return [];
  }

  async getTransfers(): Promise<EvmRawTransfer[]> {
    return [];
  }

  async getTransactionCount(): Promise<number> {
    return 0;
  }

  async estimateGas(_chain: EvmChain, req: EvmGasEstimateRequest): Promise<bigint> {
    return req.data === undefined ? 21_000n : 65_000n;
  }

  async getFeesPerGas(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    return { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  }

  getChainId(): number {
    return 1;
  }
}

class FakeSolProvider implements SolDataProvider {
  async getLamports(): Promise<bigint> {
    return 10_000_000n;
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
    return { blockhash: SOL_BLOCKHASH, lastValidBlockHeight: 123n };
  }

  async getAccountExists(): Promise<boolean> {
    return true;
  }

  async getMinimumBalanceForRentExemption(_space: bigint): Promise<bigint> {
    return 890_880n;
  }
}

function btcAccount(address: string): AccountDescriptor {
  return {
    id: 'btc-signability',
    label: 'BTC signability',
    family: 'bitcoin',
    chains: ['bitcoin'],
    source: { kind: 'addresses', addresses: [address] },
  };
}

function evmAccount(address: string): AccountDescriptor {
  return {
    id: 'evm-signability',
    label: 'EVM signability',
    family: 'evm',
    chains: ['ethereum'],
    source: { kind: 'addresses', addresses: [address] },
  };
}

function solAccount(address: string): AccountDescriptor {
  return {
    id: 'sol-signability',
    label: 'SOL signability',
    family: 'solana',
    chains: ['solana'],
    source: { kind: 'addresses', addresses: [address] },
  };
}

describe('unsigned artifact signability conformance', () => {
  it('builds a BTC PSBT that a controlled throwaway key can complete', async () => {
    const testPrivKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const payment = btc.p2wpkh(secp256k1.getPublicKey(testPrivKey, true));
    const watchedAddress = payment.address;
    expect(watchedAddress).toBeDefined();

    const adapter = new BitcoinAdapter(new FakeBtcProvider(watchedAddress));
    const artifact = await adapter.buildUnsignedTransfer({
      account: btcAccount(watchedAddress),
      chain: 'bitcoin',
      to: BTC_TO,
      asset: 'BTC',
      rawAmount: 50_000n,
      feeRate: 2n,
    });

    const psbt = base64.decode(artifact.payload);
    const tx = btc.Transaction.fromPSBT(psbt);
    expect(tx.isFinal).toBe(false);

    tx.sign(testPrivKey);
    tx.finalize();

    expect(tx.isFinal).toBe(true);
    expect(tx.hex).toMatch(/^[0-9a-f]+$/);
    const recipientOut = Array.from({ length: tx.outputsLength }, (_, i) => ({
      address: tx.getOutputAddress(i),
      amount: tx.getOutput(i).amount,
    })).find((out) => out.address === BTC_TO);
    expect(recipientOut?.amount).toBe(50_000n);
    expect(artifact.summary.artifactHash).toBe(hex.encode(sha256(psbt)));
  });

  it('builds an EVM EIP-1559 transaction that a controlled throwaway key can sign', async () => {
    const testAccount = privateKeyToAccount(`0x${'11'.repeat(32)}`);
    const adapter = new EvmAdapter(new FakeEvmProvider());
    const artifact = await adapter.buildUnsignedTransfer({
      account: evmAccount(testAccount.address),
      chain: 'ethereum',
      to: EVM_TO,
      asset: 'ETH',
      rawAmount: 1_000_000_000_000_000n,
    });

    const parsed = parseTransaction(artifact.payload as `0x${string}`);
    expect(parsed.to?.toLowerCase()).toBe(EVM_TO.toLowerCase());
    expect(parsed.value).toBe(1_000_000_000_000_000n);
    expect('v' in parsed).toBe(false);
    expect('r' in parsed).toBe(false);
    expect('s' in parsed).toBe(false);

    const signed = await testAccount.signTransaction(parsed);
    const recovered = await recoverTransactionAddress({
      serializedTransaction: signed as `0x02${string}`,
    });
    expect(recovered.toLowerCase()).toBe(testAccount.address.toLowerCase());
    expect(artifact.summary.artifactHash).toBe(
      hex.encode(sha256(new TextEncoder().encode(artifact.payload))),
    );
  });

  it('builds a Solana message that a controlled throwaway key can complete', async () => {
    const signer = await generateKeyPairSigner();
    const recipient = await generateKeyPairSigner();
    const adapter = new SolanaAdapter(new FakeSolProvider());
    const artifact = await adapter.buildUnsignedTransfer({
      account: solAccount(signer.address),
      chain: 'solana',
      to: recipient.address,
      asset: 'SOL',
      rawAmount: 1_000_000n,
    });

    const messageBytes = base64.decode(artifact.payload);
    // Content proof (symmetric with the BTC amount + EVM to/value checks above):
    // decode the compiled message and assert it actually pays `recipient` the
    // right lamports. Signability alone would pass on a wrong-dest/wrong-amount
    // message — verified by mutation probe.
    const compiledMessage = getCompiledTransactionMessageDecoder().decode(messageBytes);
    const transferIx = (
      compiledMessage as unknown as {
        instructions: { accountIndices?: readonly number[]; data: Uint8Array }[];
      }
    ).instructions[0];
    const destIndex = transferIx.accountIndices?.[1] ?? -1;
    expect(compiledMessage.staticAccounts[destIndex]).toBe(recipient.address);
    expect(getTransferSolInstructionDataDecoder().decode(transferIx.data).amount).toBe(1_000_000n);

    const unsigned: Transaction = {
      messageBytes: messageBytes as unknown as Transaction['messageBytes'],
      signatures: { [signer.address]: null },
    };
    const signed = await signTransaction([signer.keyPair], unsigned);
    assertIsFullySignedTransaction(signed);

    const wireBytes = getTransactionEncoder().encode(signed);
    expect(wireBytes.length).toBeGreaterThan(messageBytes.length);
    const decoded = getTransactionDecoder().decode(wireBytes);
    expect(decoded.messageBytes).toEqual(messageBytes);
    expect(decoded.signatures[signer.address]).toBeInstanceOf(Uint8Array);
    expect(decoded.signatures[signer.address]?.byteLength).toBe(64);
    expect(artifact.summary.artifactHash).toBe(hex.encode(sha256(messageBytes)));
  });

  it('builds a Solana SPL message that a controlled throwaway key can complete', async () => {
    const signer = await generateKeyPairSigner();
    const recipient = await generateKeyPairSigner();
    const usdc = assetBySymbol('solana', 'USDC');
    if (usdc?.address === undefined) {
      throw new Error('USDC mint missing from registry');
    }
    const mint = address(usdc.address);
    const tokenProgram = address(SOL_TOKEN_PROGRAM);
    const [source] = await findSplAssociatedTokenPda({
      owner: signer.address,
      mint,
      tokenProgram,
    });
    const [destination] = await findSplAssociatedTokenPda({
      owner: recipient.address,
      mint,
      tokenProgram,
    });

    const adapter = new SolanaAdapter(new FakeSolProvider());
    const artifact = await adapter.buildUnsignedTransfer({
      account: solAccount(signer.address),
      chain: 'solana',
      to: recipient.address,
      asset: 'USDC',
      rawAmount: 2_500_000n,
    });

    const messageBytes = base64.decode(artifact.payload);
    const compiledMessage = getCompiledTransactionMessageDecoder().decode(messageBytes);
    const transferIx = (
      compiledMessage as unknown as {
        instructions: { programAddressIndex: number; accountIndices?: readonly number[]; data: Uint8Array }[];
      }
    ).instructions[0];
    expect(compiledMessage.staticAccounts[transferIx.programAddressIndex]).toBe(tokenProgram);
    expect((transferIx.accountIndices ?? []).map((index) => compiledMessage.staticAccounts[index])).toEqual([
      source,
      mint,
      destination,
      signer.address,
    ]);
    expect(getSplTransferCheckedInstructionDataDecoder().decode(transferIx.data)).toEqual({
      discriminator: 12,
      amount: 2_500_000n,
      decimals: 6,
    });

    const unsigned: Transaction = {
      messageBytes: messageBytes as unknown as Transaction['messageBytes'],
      signatures: { [signer.address]: null },
    };
    const signed = await signTransaction([signer.keyPair], unsigned);
    assertIsFullySignedTransaction(signed);
    expect(getTransactionEncoder().encode(signed).length).toBeGreaterThan(messageBytes.length);
    expect(artifact.summary.artifactHash).toBe(hex.encode(sha256(messageBytes)));
  });
});

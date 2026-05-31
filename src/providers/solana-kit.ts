import { address, createSolanaRpc, type Signature } from '@solana/kit';
import type {
  SolDataProvider,
  SolRawTokenBalance,
  SolRawTx,
  SolTokenAccount,
} from '../adapters/chain-adapter.js';
import { type ProviderResilienceConfig, withProviderResilience } from './resilience.js';

const DEFAULT_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

interface ParsedTokenAmount {
  amount: string;
  decimals: number;
  uiAmountString: string;
}

interface ParsedTokenAccountEntry {
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          tokenAmount: ParsedTokenAmount;
        };
      };
    };
  };
}

interface RpcTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
  };
}

interface RpcTransaction {
  blockTime: number | bigint | null;
  meta: {
    err: unknown;
    fee: number | bigint;
    preBalances: readonly (number | bigint)[];
    postBalances: readonly (number | bigint)[];
    preTokenBalances?: readonly RpcTokenBalance[];
    postTokenBalances?: readonly RpcTokenBalance[];
  } | null;
  transaction: {
    message: {
      accountKeys: readonly (string | { pubkey: string })[];
    };
  };
}

function parseTokenAccount(entry: ParsedTokenAccountEntry): SolTokenAccount {
  const info = entry.account.data.parsed.info;
  return {
    mint: info.mint,
    amount: info.tokenAmount.amount,
    decimals: info.tokenAmount.decimals,
    uiAmountString: info.tokenAmount.uiAmountString,
  };
}

function parseTokenBalance(balance: RpcTokenBalance): SolRawTokenBalance {
  const parsed: SolRawTokenBalance = {
    accountIndex: balance.accountIndex,
    mint: balance.mint,
    amount: balance.uiTokenAmount.amount,
    decimals: balance.uiTokenAmount.decimals,
  };
  if (balance.owner !== undefined) {
    parsed.owner = balance.owner;
  }
  if (balance.programId !== undefined) {
    parsed.programId = balance.programId;
  }
  return parsed;
}

function parseTransaction(signature: string, tx: RpcTransaction): SolRawTx | undefined {
  const meta = tx.meta;
  if (meta === null) {
    return undefined;
  }

  return {
    signature,
    blockTime: tx.blockTime == null ? undefined : Number(tx.blockTime),
    err: meta.err,
    fee: BigInt(meta.fee),
    accountKeys: tx.transaction.message.accountKeys.map((key) =>
      typeof key === 'string' ? key : key.pubkey,
    ),
    preBalances: meta.preBalances.map((value) => BigInt(value)),
    postBalances: meta.postBalances.map((value) => BigInt(value)),
    preTokenBalances: meta.preTokenBalances?.map(parseTokenBalance),
    postTokenBalances: meta.postTokenBalances?.map(parseTokenBalance),
  };
}

export class SolanaKitProvider implements SolDataProvider {
  private readonly rpc: ReturnType<typeof createSolanaRpc>;
  private readonly resilience: ProviderResilienceConfig;

  constructor(rpcUrl = DEFAULT_SOLANA_RPC, resilience: ProviderResilienceConfig = {}) {
    this.rpc = createSolanaRpc(rpcUrl);
    this.resilience = resilience;
  }

  async getLamports(addr: string): Promise<bigint> {
    const res = await withProviderResilience(
      () => this.rpc.getBalance(address(addr)).send(),
      this.resilience,
    );
    return BigInt(res.value);
  }

  async getTokenAccounts(addr: string, programId: string): Promise<SolTokenAccount[]> {
    const res = await withProviderResilience(
      () =>
        this.rpc
          .getTokenAccountsByOwner(
            address(addr),
            { programId: address(programId) },
            { encoding: 'jsonParsed' },
          )
          .send(),
      this.resilience,
    );

    return (res.value as readonly ParsedTokenAccountEntry[]).map(parseTokenAccount);
  }

  async getSignatures(addr: string, limit: number): Promise<SolRawTx[]> {
    const res = await withProviderResilience(
      () => this.rpc.getSignaturesForAddress(address(addr), { limit }).send(),
      this.resilience,
    );

    return res.map((sig) => ({
      signature: String(sig.signature),
      blockTime: sig.blockTime == null ? undefined : Number(sig.blockTime),
      err: sig.err,
    }));
  }

  async getTransaction(signature: string): Promise<SolRawTx | undefined> {
    const tx = await withProviderResilience(
      () =>
        this.rpc
          .getTransaction(signature as Signature, {
            encoding: 'jsonParsed',
            maxSupportedTransactionVersion: 0,
          })
          .send(),
      this.resilience,
    );

    return tx === null ? undefined : parseTransaction(signature, tx as RpcTransaction);
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
    const res = await withProviderResilience(
      () => this.rpc.getLatestBlockhash().send(),
      this.resilience,
    );
    return {
      blockhash: String(res.value.blockhash),
      lastValidBlockHeight: BigInt(res.value.lastValidBlockHeight),
    };
  }

  async getAccountExists(addr: string): Promise<boolean> {
    const res = await withProviderResilience(
      () => this.rpc.getAccountInfo(address(addr), { encoding: 'base64' }).send(),
      this.resilience,
    );
    return res.value !== null;
  }
}

export function createSolanaKitProvider(
  rpcUrl?: string,
  resilience?: ProviderResilienceConfig,
): SolDataProvider {
  return new SolanaKitProvider(rpcUrl, resilience);
}

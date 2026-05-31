import type {
  ChainAdapter,
  ReceiveAddress,
  SolDataProvider,
  SolRawTokenBalance,
  SolRawTx,
} from './chain-adapter.js';
import type { AccountDescriptor, DerivedAddress } from '../domain/account.js';
import type { Balance, HistoryOptions, Tx } from '../domain/types.js';
import {
  SOL_TOKEN_2022_PROGRAM,
  SOL_TOKEN_PROGRAM,
  nativeAsset,
  tokensForChain,
  type AssetDef,
  type AssetSymbol,
} from '../domain/assets.js';

const RECEIVE_NOTE =
  'Solana addresses are reusable - verify on your signing device before use.';
const SOLANA_PROGRAMS = [SOL_TOKEN_PROGRAM, SOL_TOKEN_2022_PROGRAM] as const;

function pubkeysOf(account: AccountDescriptor): string[] {
  return account.source.kind === 'addresses' ? account.source.addresses : [];
}

function solanaTokensByMint(): Map<string, AssetDef> {
  return new Map(
    tokensForChain('solana').flatMap((asset) =>
      asset.address === undefined ? [] : [[asset.address, asset]],
    ),
  );
}

interface AssetDelta {
  symbol: AssetSymbol;
  decimals: number;
  net: bigint;
  watchedIncoming: bigint;
  watchedOutgoing: bigint;
  externalFrom?: string;
  externalTo?: string;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function ownerForTokenBalance(balance: SolRawTokenBalance, tx: SolRawTx): string | undefined {
  return balance.owner ?? tx.accountKeys?.[balance.accountIndex];
}

function tokenAmountByOwner(
  tx: SolRawTx,
  balances: readonly SolRawTokenBalance[] | undefined,
): Map<string, { mint: string; owner: string; amount: bigint }> {
  const out = new Map<string, { mint: string; owner: string; amount: bigint }>();
  for (const balance of balances ?? []) {
    const owner = ownerForTokenBalance(balance, tx);
    if (owner === undefined) {
      continue;
    }

    const key = `${balance.mint}:${owner}`;
    const existing = out.get(key);
    if (existing === undefined) {
      out.set(key, { mint: balance.mint, owner, amount: BigInt(balance.amount) });
    } else {
      existing.amount += BigInt(balance.amount);
    }
  }
  return out;
}

function tokenDeltas(tx: SolRawTx, watched: Set<string>, tokens: Map<string, AssetDef>): AssetDelta[] {
  const pre = tokenAmountByOwner(tx, tx.preTokenBalances);
  const post = tokenAmountByOwner(tx, tx.postTokenBalances);
  const keys = new Set([...pre.keys(), ...post.keys()]);
  const byMint = new Map<string, AssetDelta>();

  for (const key of keys) {
    const before = pre.get(key);
    const after = post.get(key);
    const mint = after?.mint ?? before?.mint;
    const owner = after?.owner ?? before?.owner;
    if (mint === undefined || owner === undefined) {
      continue;
    }

    const asset = tokens.get(mint);
    if (asset === undefined) {
      continue;
    }

    const delta = (after?.amount ?? 0n) - (before?.amount ?? 0n);
    if (delta === 0n) {
      continue;
    }

    let grouped = byMint.get(mint);
    if (grouped === undefined) {
      grouped = {
        symbol: asset.symbol,
        decimals: asset.decimals,
        net: 0n,
        watchedIncoming: 0n,
        watchedOutgoing: 0n,
      };
      byMint.set(mint, grouped);
    }

    if (watched.has(owner)) {
      grouped.net += delta;
      if (delta > 0n) {
        grouped.watchedIncoming += delta;
      } else {
        grouped.watchedOutgoing += -delta;
      }
    } else if (delta < 0n) {
      grouped.externalFrom ??= owner;
    } else {
      grouped.externalTo ??= owner;
    }
  }

  return [...byMint.values()].filter(
    (delta) => delta.net !== 0n || delta.watchedIncoming !== 0n || delta.watchedOutgoing !== 0n,
  );
}

function nativeDelta(tx: SolRawTx, watched: Set<string>): AssetDelta | undefined {
  const accountKeys = tx.accountKeys ?? [];
  const preBalances = tx.preBalances ?? [];
  const postBalances = tx.postBalances ?? [];
  const native = nativeAsset('solana');
  const delta: AssetDelta = {
    symbol: native.symbol,
    decimals: native.decimals,
    net: 0n,
    watchedIncoming: 0n,
    watchedOutgoing: 0n,
  };

  for (const [index, account] of accountKeys.entries()) {
    const before = preBalances[index] ?? 0n;
    const after = postBalances[index] ?? 0n;
    const change = after - before;
    if (change === 0n) {
      continue;
    }

    if (watched.has(account)) {
      delta.net += change;
      if (change > 0n) {
        delta.watchedIncoming += change;
      } else {
        delta.watchedOutgoing += -change;
      }
    } else if (change < 0n) {
      delta.externalFrom ??= account;
    } else {
      delta.externalTo ??= account;
    }
  }

  if (delta.net === 0n && delta.watchedIncoming === 0n && delta.watchedOutgoing === 0n) {
    return undefined;
  }
  return delta;
}

function bestDelta(tx: SolRawTx, watched: Set<string>, tokens: Map<string, AssetDef>): AssetDelta | undefined {
  const token = tokenDeltas(tx, watched, tokens)
    .sort((a, b) => Number(abs(b.net) - abs(a.net)))[0];
  return token ?? nativeDelta(tx, watched);
}

function txFromDelta(raw: SolRawTx, delta: AssetDelta): Tx {
  let direction: Tx['direction'];
  let counterparty: string | undefined;

  if (delta.net > 0n) {
    direction = 'in';
    counterparty = delta.externalFrom;
  } else if (delta.net < 0n) {
    direction =
      delta.externalTo === undefined && delta.watchedIncoming > 0n ? 'self' : 'out';
    counterparty = direction === 'out' ? delta.externalTo : undefined;
  } else if (delta.watchedIncoming > 0n || delta.watchedOutgoing > 0n) {
    direction = 'self';
  } else {
    direction = 'unknown';
  }

  const tx: Tx = {
    chain: 'solana',
    txid: raw.signature,
    timestamp: raw.blockTime,
    direction,
    symbol: delta.symbol,
    raw: direction === 'self' && delta.net === 0n ? 0n : abs(delta.net),
    decimals: delta.decimals,
    confirmed: raw.err == null,
  };
  if (counterparty !== undefined) {
    tx.counterparty = counterparty;
  }
  return tx;
}

function unknownTx(raw: SolRawTx): Tx {
  const native = nativeAsset('solana');
  return {
    chain: 'solana',
    txid: raw.signature,
    timestamp: raw.blockTime,
    direction: 'unknown',
    symbol: native.symbol,
    raw: 0n,
    decimals: native.decimals,
    confirmed: raw.err == null,
  };
}

export class SolanaAdapter implements ChainAdapter {
  readonly family = 'solana' as const;
  readonly capabilities = { derivesAddresses: false } as const;

  constructor(private readonly provider: SolDataProvider) {}

  async resolveAddresses(account: AccountDescriptor): Promise<DerivedAddress[]> {
    return pubkeysOf(account).map((address) => ({
      address,
      chain: 'solana',
      derived: false,
    }));
  }

  async getReceiveAddress(account: AccountDescriptor): Promise<ReceiveAddress> {
    const address = pubkeysOf(account)[0];
    if (address === undefined) {
      throw new Error('Solana account has no literal address');
    }

    return {
      address,
      derived: false,
      note: RECEIVE_NOTE,
    };
  }

  async getBalances(addresses: DerivedAddress[]): Promise<Balance[]> {
    const balances: Balance[] = [];
    const native = nativeAsset('solana');
    const tokens = solanaTokensByMint();

    for (const { address, chain } of addresses) {
      if (chain !== 'solana') {
        continue;
      }

      balances.push({
        chain: 'solana',
        address,
        symbol: native.symbol,
        raw: await this.provider.getLamports(address),
        decimals: native.decimals,
      });

      for (const programId of SOLANA_PROGRAMS) {
        const accounts = await this.provider.getTokenAccounts(address, programId);
        for (const account of accounts) {
          const token = tokens.get(account.mint);
          if (token === undefined || account.amount === '0') {
            continue;
          }

          balances.push({
            chain: 'solana',
            address,
            symbol: token.symbol,
            raw: BigInt(account.amount),
            decimals: token.decimals,
          });
        }
      }
    }

    return balances;
  }

  async getHistory(addresses: DerivedAddress[], opts?: HistoryOptions): Promise<Tx[]> {
    const limit = opts?.limit ?? 25;
    const watched = new Set(
      addresses
        .filter(({ chain }) => chain === 'solana')
        .map(({ address }) => address),
    );
    const tokens = solanaTokensByMint();
    const seen = new Set<string>();
    const txs: Tx[] = [];

    for (const { address, chain } of addresses) {
      if (chain !== 'solana') {
        continue;
      }

      const signatures = await this.provider.getSignatures(address, limit);
      for (const signature of signatures) {
        if (seen.has(signature.signature)) {
          continue;
        }
        seen.add(signature.signature);

        const detail = await this.provider.getTransaction(signature.signature);
        const raw = detail ?? signature;
        const delta = bestDelta(raw, watched, tokens);
        txs.push(delta === undefined ? unknownTx(raw) : txFromDelta(raw, delta));
      }
    }

    return txs
      .sort((a, b) => {
        // Unconfirmed txs (no blockTime) are the newest — sort them to the top.
        const ta = a.timestamp ?? Number.POSITIVE_INFINITY;
        const tb = b.timestamp ?? Number.POSITIVE_INFINITY;
        return ta === tb ? 0 : tb - ta;
      })
      .slice(0, limit);
  }
}

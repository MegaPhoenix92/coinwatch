import type {
  ChainAdapter,
  ReceiveAddress,
  SolDataProvider,
} from './chain-adapter.js';
import type { AccountDescriptor, DerivedAddress } from '../domain/account.js';
import type { Balance, HistoryOptions, Tx } from '../domain/types.js';
import {
  SOL_TOKEN_2022_PROGRAM,
  SOL_TOKEN_PROGRAM,
  nativeAsset,
  tokensForChain,
  type AssetDef,
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
    const seen = new Set<string>();
    const native = nativeAsset('solana');
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
        txs.push({
          chain: 'solana',
          txid: signature.signature,
          timestamp: signature.blockTime,
          direction: 'unknown',
          symbol: native.symbol,
          raw: 0n,
          decimals: native.decimals,
          confirmed: signature.err == null,
        });
      }
    }

    return txs
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, limit);
  }
}

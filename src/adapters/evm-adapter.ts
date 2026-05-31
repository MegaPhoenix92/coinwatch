import type {
  ChainAdapter,
  EvmDataProvider,
  ReceiveAddress,
} from './chain-adapter.js';
import type { AccountDescriptor, DerivedAddress } from '../domain/account.js';
import { EVM_CHAINS, type EvmChain } from '../domain/chains.js';
import { nativeAsset, tokensForChain } from '../domain/assets.js';
import type { Balance, HistoryOptions, Tx } from '../domain/types.js';

const RECEIVE_NOTE =
  'EVM addresses are reusable - verify on your signing device before use.';

function isEvmChain(chain: string): chain is EvmChain {
  return (EVM_CHAINS as readonly string[]).includes(chain);
}

export class EvmAdapter implements ChainAdapter {
  readonly family = 'evm' as const;
  readonly capabilities = { derivesAddresses: false } as const;

  constructor(private readonly provider: EvmDataProvider) {}

  async resolveAddresses(account: AccountDescriptor): Promise<DerivedAddress[]> {
    if (account.source.kind !== 'addresses') {
      throw new Error('EvmAdapter requires an "addresses" account source');
    }

    const chains = account.chains.filter(isEvmChain);
    const out: DerivedAddress[] = [];
    for (const rawAddress of account.source.addresses) {
      const address = rawAddress.toLowerCase();
      for (const chain of chains) {
        out.push({ address, chain, derived: false });
      }
    }

    return out;
  }

  async getReceiveAddress(account: AccountDescriptor): Promise<ReceiveAddress> {
    if (account.source.kind !== 'addresses') {
      throw new Error('EvmAdapter requires an "addresses" account source');
    }

    const address = account.source.addresses[0];
    if (address === undefined) {
      throw new Error('EvmAdapter account has no addresses');
    }

    return {
      address: address.toLowerCase(),
      derived: false,
      note: RECEIVE_NOTE,
    };
  }

  async getBalances(addresses: DerivedAddress[]): Promise<Balance[]> {
    const balances: Balance[] = [];

    for (const { address, chain } of addresses) {
      if (!isEvmChain(chain)) {
        continue;
      }

      const native = nativeAsset(chain);
      const nativeRaw = await this.provider.getNativeBalance(chain, address);
      balances.push({
        chain,
        address,
        symbol: native.symbol,
        raw: nativeRaw,
        decimals: native.decimals,
      });

      const tokens = tokensForChain(chain);
      const tokenAddresses = tokens.flatMap((token) => (token.address === undefined ? [] : [token.address]));
      const tokenBalances = await this.provider.getTokenBalances(chain, address, tokenAddresses);

      for (const tokenBalance of tokenBalances) {
        if (tokenBalance.raw === 0n) {
          continue;
        }

        const token = tokens.find(
          (candidate) =>
            candidate.address?.toLowerCase() === tokenBalance.address.toLowerCase(),
        );
        if (token === undefined) {
          continue;
        }

        balances.push({
          chain,
          address,
          symbol: token.symbol,
          raw: tokenBalance.raw,
          decimals: token.decimals,
        });
      }
    }

    return balances;
  }

  async getHistory(_addresses: DerivedAddress[], _opts?: HistoryOptions): Promise<Tx[]> {
    return [];
  }
}

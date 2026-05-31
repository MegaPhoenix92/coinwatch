import type {
  ChainAdapter,
  EvmDataProvider,
  EvmRawTransfer,
  ReceiveAddress,
} from './chain-adapter.js';
import type { AccountDescriptor, DerivedAddress } from '../domain/account.js';
import { EVM_CHAINS, type Chain, type EvmChain } from '../domain/chains.js';
import { assetBySymbol, nativeAsset, tokensForChain, type AssetSymbol } from '../domain/assets.js';
import type { Balance, HistoryOptions, Tx } from '../domain/types.js';

const RECEIVE_NOTE =
  'EVM addresses are reusable - verify on your signing device before use.';

function isEvmChain(chain: string): chain is EvmChain {
  return (EVM_CHAINS as readonly string[]).includes(chain);
}

interface TransferGroup {
  chain: EvmChain;
  txid: string;
  timestamp?: number;
  symbol: AssetSymbol;
  decimals: number;
  incoming: bigint;
  outgoing: bigint;
  externalFrom?: string;
  externalTo?: string;
}

function symbolForTransfer(chain: Chain, transfer: EvmRawTransfer): AssetSymbol | undefined {
  const native = nativeAsset(chain);
  if (transfer.asset.toLowerCase() === native.symbol.toLowerCase()) {
    return native.symbol;
  }

  const token = tokensForChain(chain).find((candidate) => {
    return (
      candidate.symbol.toLowerCase() === transfer.asset.toLowerCase() ||
      candidate.address?.toLowerCase() === transfer.asset.toLowerCase()
    );
  });
  return token?.symbol;
}

function decimalsForTransfer(chain: Chain, symbol: AssetSymbol): number {
  const asset = assetBySymbol(chain, symbol);
  if (asset === undefined) {
    throw new Error(`No asset registered for ${symbol} on ${chain}`);
  }
  return asset.decimals;
}

function mergeTransfer(group: TransferGroup, transfer: EvmRawTransfer, watched: Set<string>): void {
  const from = transfer.from.toLowerCase();
  const to = transfer.to.toLowerCase();
  const fromWatched = watched.has(from);
  const toWatched = watched.has(to);

  if (toWatched) {
    group.incoming += transfer.rawValue;
  }
  if (fromWatched) {
    group.outgoing += transfer.rawValue;
  }
  if (!fromWatched) {
    group.externalFrom ??= from;
  }
  if (!toWatched) {
    group.externalTo ??= to;
  }
  if (transfer.timestamp !== undefined) {
    group.timestamp = Math.max(group.timestamp ?? 0, transfer.timestamp);
  }
}

function groupToTx(group: TransferGroup): Tx {
  const net = group.incoming - group.outgoing;
  let direction: Tx['direction'];
  let counterparty: string | undefined;

  if (net > 0n) {
    direction = 'in';
    counterparty = group.externalFrom;
  } else if (net < 0n) {
    direction = group.externalTo === undefined ? 'self' : 'out';
    counterparty = group.externalTo;
  } else {
    direction = 'self';
  }

  const tx: Tx = {
    chain: group.chain,
    txid: group.txid,
    timestamp: group.timestamp,
    direction,
    symbol: group.symbol,
    raw: net < 0n ? -net : net,
    decimals: group.decimals,
    confirmed: true,
  };
  if (counterparty !== undefined) {
    tx.counterparty = counterparty;
  }
  return tx;
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

  async getHistory(addresses: DerivedAddress[], opts?: HistoryOptions): Promise<Tx[]> {
    const limit = opts?.limit ?? 25;
    const watched = new Set(addresses.map(({ address }) => address.toLowerCase()));
    const groups = new Map<string, TransferGroup>();
    const seenTransfers = new Set<string>();

    for (const { address, chain } of addresses) {
      if (!isEvmChain(chain)) {
        continue;
      }

      const transfers = await this.provider.getTransfers(chain, address, limit);
      for (const transfer of transfers) {
        const symbol = symbolForTransfer(chain, transfer);
        if (symbol === undefined) {
          continue;
        }

        const transferKey = [
          chain,
          transfer.txid.toLowerCase(),
          symbol,
          transfer.from.toLowerCase(),
          transfer.to.toLowerCase(),
          transfer.rawValue.toString(),
        ].join(':');
        if (seenTransfers.has(transferKey)) {
          continue;
        }
        seenTransfers.add(transferKey);

        const key = `${chain}:${transfer.txid.toLowerCase()}:${symbol}`;
        let group = groups.get(key);
        if (group === undefined) {
          group = {
            chain,
            txid: transfer.txid,
            timestamp: transfer.timestamp,
            symbol,
            decimals: decimalsForTransfer(chain, symbol),
            incoming: 0n,
            outgoing: 0n,
          };
          groups.set(key, group);
        }
        mergeTransfer(group, transfer, watched);
      }
    }

    return [...groups.values()]
      .map(groupToTx)
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, limit);
  }
}

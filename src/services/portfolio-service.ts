import type { ChainAdapter, PriceProvider, ReceiveAddress } from '../adapters/chain-adapter.js';
import { value } from '../core/valuation.js';
import { assetBySymbol } from '../domain/assets.js';
import type { AccountDescriptor, DerivedAddress } from '../domain/account.js';
import type { ChainFamily } from '../domain/chains.js';
import type { Balance, HistoryOptions, PortfolioView, Tx } from '../domain/types.js';
import type { Store } from '../db/store.js';

interface BalanceWithPending extends Balance {
  pendingRaw?: bigint;
}

export class PortfolioService {
  constructor(
    private readonly adapters: Map<ChainFamily, ChainAdapter>,
    private readonly prices: PriceProvider,
    private readonly store?: Store,
  ) {}

  async getPortfolio(accounts: AccountDescriptor[]): Promise<PortfolioView> {
    const allBalances: Balance[] = [];
    const warnings: string[] = [];

    for (const account of accounts) {
      const adapter = this.adapters.get(account.family);
      if (adapter === undefined) {
        warnings.push(`No adapter for account ${account.id} (family ${account.family}); skipped`);
        continue;
      }

      try {
        const addresses = await adapter.resolveAddresses(account);
        const balances = await adapter.getBalances(addresses);
        for (const balance of balances as BalanceWithPending[]) {
          if (balance.pendingRaw !== undefined && balance.pendingRaw !== 0n) {
            warnings.push(
              `Pending ${balance.symbol} balance for ${balance.address} on ${balance.chain}: ${balance.pendingRaw.toString()} raw units`,
            );
          }
        }
        allBalances.push(...balances);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to load account ${account.id} (${account.family}): ${message}`);
      }
    }

    const ids = new Set<string>();
    for (const balance of allBalances) {
      const asset = assetBySymbol(balance.chain, balance.symbol);
      if (asset !== undefined) {
        ids.add(asset.coingeckoId);
      }
    }

    let priceMap: Map<string, number>;
    try {
      priceMap = await this.prices.getUsdPrices([...ids]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to load prices: ${message}`);
      priceMap = new Map<string, number>();
    }

    const view = value(allBalances, priceMap, assetBySymbol);
    view.warnings.push(...warnings);
    return view;
  }

  async listAddresses(accounts: AccountDescriptor[]): Promise<DerivedAddress[]> {
    const out: DerivedAddress[] = [];
    for (const account of accounts) {
      const adapter = this.adapters.get(account.family);
      if (adapter === undefined) {
        continue;
      }
      out.push(...(await adapter.resolveAddresses(account)));
    }
    return out;
  }

  async getReceiveAddress(
    accounts: AccountDescriptor[],
    accountId: string,
    index?: number,
  ): Promise<ReceiveAddress> {
    const account = accounts.find((candidate) => candidate.id === accountId);
    if (account === undefined) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const adapter = this.adapters.get(account.family);
    if (adapter === undefined) {
      throw new Error(`No adapter for family ${account.family}`);
    }

    return adapter.getReceiveAddress(account, index);
  }

  async getHistory(accounts: AccountDescriptor[], opts?: HistoryOptions): Promise<Tx[]> {
    const out: Tx[] = [];
    for (const account of accounts) {
      const adapter = this.adapters.get(account.family);
      if (adapter === undefined) {
        continue;
      }

      const addresses = await adapter.resolveAddresses(account);
      const txs = await adapter.getHistory(addresses, opts);
      if (this.store !== undefined) {
        this.store.cacheTxs(txs);
      }
      out.push(...txs);
    }

    const limit = opts?.limit;
    return typeof limit === 'number' ? out.slice(0, limit) : out;
  }
}

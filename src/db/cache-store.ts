import type { AssetSymbol } from '../domain/assets.js';
import type { Chain } from '../domain/chains.js';
import type { HistoricalUsdPrice, UtcDateString } from '../domain/historical-price.js';
import type { Tx } from '../domain/types.js';
import type { TxCategoryOverrideRow } from '../core/tx-category.js';
import type { HistoricalPriceSource } from '../domain/historical-price.js';

export interface HistoricalPriceCacheRow extends HistoricalUsdPrice {
  coingeckoId: string;
  fetchedAt?: number;
}

/** Async cache contract shared by SQLite (dev/tests) and PostgreSQL (Cloud SQL). */
export interface CacheStore {
  setLabel(chain: Chain, address: string, label: string): Promise<void>;
  getLabel(chain: Chain, address: string): Promise<string | undefined>;
  cacheTxs(txs: Tx[]): Promise<void>;
  getCachedTxs(chain: Chain): Promise<Tx[]>;
  getHistoricalPrice(coingeckoId: string, date: UtcDateString): Promise<HistoricalUsdPrice | undefined>;
  setTxCategoryOverride(row: TxCategoryOverrideRow): Promise<void>;
  clearTxCategoryOverride(chain: Chain, txid: string, symbol: AssetSymbol): Promise<void>;
  getTxCategoryOverrides(): Promise<Map<string, TxCategoryOverrideRow>>;
  cacheHistoricalPrice(row: HistoricalPriceCacheRow): Promise<void>;
  close(): Promise<void>;
}
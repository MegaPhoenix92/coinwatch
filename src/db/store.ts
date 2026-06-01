import Database from 'better-sqlite3';
import type { AssetSymbol } from '../domain/assets.js';
import type { Chain } from '../domain/chains.js';
import {
  assertUtcDateString,
  type HistoricalPriceSource,
  type HistoricalUsdPrice,
  type UtcDateString,
} from '../domain/historical-price.js';
import { assertTxCategory } from '../domain/categories.js';
import type { Tx } from '../domain/types.js';
import { txCategoryRowKey, type TxCategoryOverrideRow } from '../core/tx-category.js';

interface TxRow {
  json: string;
}

interface PriceHistoryRow {
  usd: number;
  source: HistoricalPriceSource;
  date: string;
}

export interface HistoricalPriceCacheRow extends HistoricalUsdPrice {
  coingeckoId: string;
  fetchedAt?: number;
}

interface SerializedTx {
  chain: Chain;
  txid: string;
  timestamp?: number;
  direction: Tx['direction'];
  selfTransferLeg?: Tx['selfTransferLeg'];
  symbol: AssetSymbol;
  raw: string;
  decimals: number;
  counterparty?: string;
  confirmed: boolean;
}

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS address_labels (
  chain TEXT,
  address TEXT,
  label TEXT,
  PRIMARY KEY (chain, address)
) STRICT;
CREATE TABLE IF NOT EXISTS tx_cache (
  chain TEXT,
  txid TEXT,
  json TEXT,
  fetched_at INTEGER,
  PRIMARY KEY (chain, txid)
) STRICT;
CREATE TABLE IF NOT EXISTS price_history (
  coingecko_id TEXT,
  date TEXT,
  usd REAL,
  source TEXT,
  fetched_at INTEGER,
  PRIMARY KEY (coingecko_id, date)
) STRICT;
CREATE TABLE IF NOT EXISTS tx_category_overrides (
  chain TEXT,
  txid TEXT,
  symbol TEXT,
  category TEXT,
  note TEXT,
  updated_at INTEGER,
  PRIMARY KEY (chain, txid, symbol)
) STRICT;
`;

export class Store {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(MIGRATIONS);
  }

  static open(path: string): Store {
    return new Store(new Database(path));
  }

  setLabel(chain: Chain, address: string, label: string): void {
    this.db
      .prepare(
        'INSERT INTO address_labels (chain, address, label) VALUES (?, ?, ?) ' +
          'ON CONFLICT(chain, address) DO UPDATE SET label = excluded.label',
      )
      .run(chain, address, label);
  }

  getLabel(chain: Chain, address: string): string | undefined {
    const row = this.db
      .prepare('SELECT label FROM address_labels WHERE chain = ? AND address = ?')
      .get(chain, address) as { label: string } | undefined;
    return row?.label;
  }

  cacheTxs(txs: Tx[]): void {
    const stmt = this.db.prepare(
      'INSERT INTO tx_cache (chain, txid, json, fetched_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(chain, txid) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at',
    );
    const now = Date.now();
    const insertMany = this.db.transaction((rows: Tx[]) => {
      for (const tx of rows) {
        const serialized: SerializedTx = {
          chain: tx.chain,
          txid: tx.txid,
          timestamp: tx.timestamp,
          direction: tx.direction,
          selfTransferLeg: tx.selfTransferLeg,
          symbol: tx.symbol,
          raw: tx.raw.toString(),
          decimals: tx.decimals,
          counterparty: tx.counterparty,
          confirmed: tx.confirmed,
        };
        stmt.run(tx.chain, tx.txid, JSON.stringify(serialized), now);
      }
    });

    insertMany(txs);
  }

  getCachedTxs(chain: Chain): Tx[] {
    const rows = this.db
      .prepare('SELECT json FROM tx_cache WHERE chain = ? ORDER BY fetched_at')
      .all(chain) as TxRow[];

    return rows.map((row) => {
      const serialized = JSON.parse(row.json) as SerializedTx;
      return {
        chain: serialized.chain,
        txid: serialized.txid,
        timestamp: serialized.timestamp,
        direction: serialized.direction,
        selfTransferLeg: serialized.selfTransferLeg,
        symbol: serialized.symbol,
        raw: BigInt(serialized.raw),
        decimals: serialized.decimals,
        counterparty: serialized.counterparty,
        confirmed: serialized.confirmed,
      };
    });
  }

  getHistoricalPrice(coingeckoId: string, date: UtcDateString): HistoricalUsdPrice | undefined {
    const row = this.db
      .prepare('SELECT usd, source, date FROM price_history WHERE coingecko_id = ? AND date = ?')
      .get(coingeckoId, date) as PriceHistoryRow | undefined;
    if (row === undefined) {
      return undefined;
    }

    return {
      usd: row.usd,
      source: row.source,
      date: assertUtcDateString(row.date),
    };
  }

  setTxCategoryOverride(row: TxCategoryOverrideRow): void {
    const category = assertTxCategory(row.category);
    this.db
      .prepare(
        'INSERT INTO tx_category_overrides (chain, txid, symbol, category, note, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(chain, txid, symbol) DO UPDATE SET category = excluded.category, note = excluded.note, updated_at = excluded.updated_at',
      )
      .run(row.chain, row.txid, row.symbol, category, row.note ?? null, Date.now());
  }

  clearTxCategoryOverride(chain: Chain, txid: string, symbol: AssetSymbol): void {
    this.db
      .prepare('DELETE FROM tx_category_overrides WHERE chain = ? AND txid = ? AND symbol = ?')
      .run(chain, txid, symbol);
  }

  getTxCategoryOverrides(): Map<string, TxCategoryOverrideRow> {
    const rows = this.db
      .prepare('SELECT chain, txid, symbol, category, note FROM tx_category_overrides')
      .all() as Array<{
      chain: Chain;
      txid: string;
      symbol: AssetSymbol;
      category: string;
      note: string | null;
    }>;

    const out = new Map<string, TxCategoryOverrideRow>();
    for (const row of rows) {
      const parsed: TxCategoryOverrideRow = {
        chain: row.chain,
        txid: row.txid,
        symbol: row.symbol,
        category: assertTxCategory(row.category),
        note: row.note ?? undefined,
      };
      out.set(txCategoryRowKey(parsed), parsed);
    }
    return out;
  }

  cacheHistoricalPrice(row: HistoricalPriceCacheRow): void {
    this.db
      .prepare(
        'INSERT INTO price_history (coingecko_id, date, usd, source, fetched_at) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(coingecko_id, date) DO UPDATE SET usd = excluded.usd, source = excluded.source, fetched_at = excluded.fetched_at',
      )
      .run(row.coingeckoId, row.date, row.usd, row.source, row.fetchedAt ?? Date.now());
  }

  close(): void {
    this.db.close();
  }
}

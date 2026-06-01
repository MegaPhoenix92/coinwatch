import pg from 'pg';
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
import type { CacheStore, HistoricalPriceCacheRow } from './cache-store.js';
import { POSTGRES_MIGRATIONS } from './schema.js';

const { Pool } = pg;

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

function deserializeTx(serialized: SerializedTx): Tx {
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
}

export class PostgresStore implements CacheStore {
  private constructor(private readonly pool: pg.Pool) {}

  static async connect(connectionString: string): Promise<PostgresStore> {
    const pool = new Pool({ connectionString });
    const store = new PostgresStore(pool);
    await store.migrate();
    return store;
  }

  private async migrate(): Promise<void> {
    await this.pool.query(POSTGRES_MIGRATIONS);
  }

  async setLabel(chain: Chain, address: string, label: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO address_labels (chain, address, label) VALUES ($1, $2, $3)
       ON CONFLICT (chain, address) DO UPDATE SET label = EXCLUDED.label`,
      [chain, address, label],
    );
  }

  async getLabel(chain: Chain, address: string): Promise<string | undefined> {
    const result = await this.pool.query<{ label: string }>(
      'SELECT label FROM address_labels WHERE chain = $1 AND address = $2',
      [chain, address],
    );
    return result.rows[0]?.label;
  }

  async cacheTxs(txs: Tx[]): Promise<void> {
    const now = Date.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const tx of txs) {
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
        await client.query(
          `INSERT INTO tx_cache (chain, txid, json, fetched_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (chain, txid) DO UPDATE SET json = EXCLUDED.json, fetched_at = EXCLUDED.fetched_at`,
          [tx.chain, tx.txid, JSON.stringify(serialized), now],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getCachedTxs(chain: Chain): Promise<Tx[]> {
    const result = await this.pool.query<{ json: string }>(
      'SELECT json FROM tx_cache WHERE chain = $1 ORDER BY fetched_at',
      [chain],
    );
    return result.rows.map((row) => deserializeTx(JSON.parse(row.json) as SerializedTx));
  }

  async getHistoricalPrice(
    coingeckoId: string,
    date: UtcDateString,
  ): Promise<HistoricalUsdPrice | undefined> {
    const result = await this.pool.query<{
      usd: number;
      source: HistoricalPriceSource;
      date: string;
    }>(
      'SELECT usd, source, date FROM price_history WHERE coingecko_id = $1 AND date = $2',
      [coingeckoId, date],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      usd: row.usd,
      source: row.source,
      date: assertUtcDateString(row.date),
    };
  }

  async setTxCategoryOverride(row: TxCategoryOverrideRow): Promise<void> {
    const category = assertTxCategory(row.category);
    await this.pool.query(
      `INSERT INTO tx_category_overrides (chain, txid, symbol, category, note, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (chain, txid, symbol) DO UPDATE SET
         category = EXCLUDED.category,
         note = EXCLUDED.note,
         updated_at = EXCLUDED.updated_at`,
      [row.chain, row.txid, row.symbol, category, row.note ?? null, Date.now()],
    );
  }

  async clearTxCategoryOverride(chain: Chain, txid: string, symbol: AssetSymbol): Promise<void> {
    await this.pool.query(
      'DELETE FROM tx_category_overrides WHERE chain = $1 AND txid = $2 AND symbol = $3',
      [chain, txid, symbol],
    );
  }

  async getTxCategoryOverrides(): Promise<Map<string, TxCategoryOverrideRow>> {
    const result = await this.pool.query<{
      chain: Chain;
      txid: string;
      symbol: AssetSymbol;
      category: string;
      note: string | null;
    }>('SELECT chain, txid, symbol, category, note FROM tx_category_overrides');

    const out = new Map<string, TxCategoryOverrideRow>();
    for (const row of result.rows) {
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

  async cacheHistoricalPrice(row: HistoricalPriceCacheRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO price_history (coingecko_id, date, usd, source, fetched_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (coingecko_id, date) DO UPDATE SET
         usd = EXCLUDED.usd,
         source = EXCLUDED.source,
         fetched_at = EXCLUDED.fetched_at`,
      [row.coingeckoId, row.date, row.usd, row.source, row.fetchedAt ?? Date.now()],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
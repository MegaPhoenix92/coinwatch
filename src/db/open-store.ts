import { loadDatabaseConfig } from '../config/database.js';
import type { CacheStore } from './cache-store.js';
import { PostgresStore } from './postgres-store.js';
import { Store } from './store.js';

/**
 * Opens the cache store. Cloud SQL / PostgreSQL when `DATABASE_URL` is set;
 * otherwise SQLite at `COINWATCH_DB_PATH` (default `coinwatch.db`) for local dev and tests.
 */
export async function openStore(): Promise<CacheStore> {
  const config = loadDatabaseConfig();

  if (config.databaseUrl !== undefined) {
    return PostgresStore.connect(config.databaseUrl);
  }

  if (config.requireDatabaseUrl) {
    throw new Error(
      'DATABASE_URL is required in this environment (use Cloud SQL PostgreSQL). For local SQLite dev, unset COINWATCH_ENV=production.',
    );
  }

  return Store.open(config.sqlitePath);
}
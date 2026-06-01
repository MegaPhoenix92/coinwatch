/** Shared cache schema for SQLite (dev/tests) and PostgreSQL (Cloud SQL). */

export const SQLITE_MIGRATIONS = `
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

export const POSTGRES_MIGRATIONS = `
CREATE TABLE IF NOT EXISTS address_labels (
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (chain, address)
);
CREATE TABLE IF NOT EXISTS tx_cache (
  chain TEXT NOT NULL,
  txid TEXT NOT NULL,
  json TEXT NOT NULL,
  fetched_at BIGINT NOT NULL,
  PRIMARY KEY (chain, txid)
);
CREATE TABLE IF NOT EXISTS price_history (
  coingecko_id TEXT NOT NULL,
  date TEXT NOT NULL,
  usd DOUBLE PRECISION NOT NULL,
  source TEXT NOT NULL,
  fetched_at BIGINT NOT NULL,
  PRIMARY KEY (coingecko_id, date)
);
CREATE TABLE IF NOT EXISTS tx_category_overrides (
  chain TEXT NOT NULL,
  txid TEXT NOT NULL,
  symbol TEXT NOT NULL,
  category TEXT NOT NULL,
  note TEXT,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (chain, txid, symbol)
);
`;
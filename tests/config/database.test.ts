import { afterEach, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from '../../src/config/database.js';

describe('loadDatabaseConfig', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('prefers DATABASE_URL for Cloud SQL when set', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/coinwatch';
    delete process.env.COINWATCH_DB_PATH;
    delete process.env.COINWATCH_ENV;

    expect(loadDatabaseConfig()).toEqual({
      databaseUrl: 'postgresql://user:pass@127.0.0.1:5432/coinwatch',
      sqlitePath: 'coinwatch.db',
      requireDatabaseUrl: false,
    });
  });

  it('requires DATABASE_URL when COINWATCH_ENV=production', () => {
    delete process.env.DATABASE_URL;
    process.env.COINWATCH_ENV = 'production';

    expect(loadDatabaseConfig().requireDatabaseUrl).toBe(true);
  });

  it('defaults sqlite path when DATABASE_URL is unset', () => {
    delete process.env.DATABASE_URL;
    process.env.COINWATCH_DB_PATH = '/tmp/coinwatch-test.db';

    expect(loadDatabaseConfig().sqlitePath).toBe('/tmp/coinwatch-test.db');
  });
});
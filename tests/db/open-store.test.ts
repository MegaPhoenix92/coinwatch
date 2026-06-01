import { afterEach, describe, expect, it } from 'vitest';
import { openStore } from '../../src/db/open-store.js';

describe('openStore', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('opens SQLite when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.COINWATCH_ENV;
    const store = await openStore();
    await store.setLabel('bitcoin', 'bc1qtest', 'dev');
    expect(await store.getLabel('bitcoin', 'bc1qtest')).toBe('dev');
    await store.close();
  });

  it('requires DATABASE_URL when COINWATCH_ENV=production', async () => {
    delete process.env.DATABASE_URL;
    process.env.COINWATCH_ENV = 'production';
    await expect(openStore()).rejects.toThrow(/DATABASE_URL is required/);
  });
});
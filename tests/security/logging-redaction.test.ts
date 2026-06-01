import { afterEach, describe, expect, it } from 'vitest';
import { configureLogForTests } from '../../src/core/logger.js';
import { HttpStatusError, withRetry } from '../../src/providers/resilience.js';

describe('provider diagnostics logging', () => {
  afterEach(() => {
    configureLogForTests();
  });

  it('never emits raw addresses from withRetry failure logs', async () => {
    const lines: string[] = [];
    configureLogForTests({
      level: 'debug',
      sink: (line) => lines.push(line),
    });

    const secretAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';
    await expect(
      withRetry(
        async () => {
          throw new HttpStatusError('Viem', 503, `upstream failed for ${secretAddress}`);
        },
        { retries: 0, diagnosticsScope: 'viem' },
      ),
    ).rejects.toThrow(HttpStatusError);

    const joined = lines.join('\n');
    expect(joined).not.toContain(secretAddress);
    expect(joined).toContain('"scope":"viem"');
    expect(joined).toContain('[redacted-address]');
  });
});
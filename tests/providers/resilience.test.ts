import { describe, expect, it, vi } from 'vitest';
import {
  HttpStatusError,
  withRetry,
  withTimeout,
} from '../../src/providers/resilience.js';

describe('provider resilience helpers', () => {
  it('retries retryable errors and eventually succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new HttpStatusError('fixture', 429, 'Too Many Requests');
        }
        return 'ok';
      },
      { sleep: async () => undefined },
    );

    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('bounds retries and rethrows the last retryable error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new HttpStatusError('fixture', 500, 'Server Error');
        },
        { sleep: async () => undefined },
      ),
    ).rejects.toThrow('fixture 500: Server Error');

    expect(calls).toBe(4);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new HttpStatusError('fixture', 400, 'Bad Request');
        },
        { sleep: async () => undefined },
      ),
    ).rejects.toThrow('fixture 400: Bad Request');

    expect(calls).toBe(1);
  });

  it('rejects with a clear timeout error', async () => {
    vi.useFakeTimers();
    try {
      const timedOut = withTimeout(() => new Promise<string>(() => undefined), 1_000);
      const expectation = expect(timedOut).rejects.toThrow(
        'provider request timed out after 1000ms',
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});

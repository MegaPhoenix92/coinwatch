export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`provider request timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export class HttpStatusError extends Error {
  readonly status: number;

  constructor(provider: string, status: number, statusText: string) {
    super(`${provider} ${status}: ${statusText}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

export type SleepFn = (ms: number) => Promise<void>;

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
  sleep?: SleepFn;
}

export interface ProviderResilienceConfig extends RetryOptions {
  timeoutMs?: number;
}

export const DEFAULT_PROVIDER_RESILIENCE = {
  timeoutMs: 10_000,
  retries: 3,
  baseDelayMs: 200,
} as const;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError(ms));
      }, ms);

      Promise.resolve()
        .then(() => fn(controller.signal))
        .then(resolve, reject);
    });
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof TimeoutError) {
    return true;
  }

  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    name?: unknown;
    status?: unknown;
  };
  if (typeof candidate.status === 'number') {
    return candidate.status === 429 || (candidate.status >= 500 && candidate.status <= 599);
  }

  if (candidate.name === 'TypeError') {
    return true;
  }

  return (
    candidate.code === 'ETIMEDOUT' ||
    candidate.code === 'ECONNRESET' ||
    candidate.code === 'ECONNREFUSED' ||
    candidate.code === 'ENOTFOUND'
  );
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? DEFAULT_PROVIDER_RESILIENCE.retries;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_PROVIDER_RESILIENCE.baseDelayMs;
  const isRetryable = opts.isRetryable ?? isRetryableProviderError;
  const wait = opts.sleep ?? sleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryable(error)) {
        throw error;
      }

      await wait(baseDelayMs * 2 ** attempt);
    }
  }

  throw lastError;
}

export function withProviderResilience<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: ProviderResilienceConfig = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROVIDER_RESILIENCE.timeoutMs;
  return withRetry(() => withTimeout(fn, timeoutMs), opts);
}

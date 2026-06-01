export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const SENSITIVE_FIELD = new Set([
  'xpub',
  'ypub',
  'zpub',
  'address',
  'addresses',
  'fromaddress',
  'toaddress',
  'apikey',
  'api_key',
  'alchemyapikey',
  'coingeckoapikey',
  'heliusapikey',
  'privatekey',
  'private_key',
  'secret',
  'rpcurl',
  'authorization',
]);

const STRING_REDACTIONS: readonly { pattern: RegExp; replacement: string }[] = [
  { pattern: /\b[xyz]pub[1-9A-HJ-NP-Za-km-z]{20,}\b/g, replacement: '[redacted-xpub]' },
  { pattern: /\b(?:0x)?[a-fA-F0-9]{64}\b/g, replacement: '[redacted-key]' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '[redacted-key-block]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[redacted-aws-key]' },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replacement: '[redacted-api-key]' },
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b/g, replacement: '[redacted-token]' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, replacement: '[redacted-token]' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, replacement: '[redacted-token]' },
  { pattern: /\bsk-(?:live|test|proj)-[A-Za-z0-9_-]{20,}\b/g, replacement: '[redacted-api-key]' },
  { pattern: /\b0x[a-fA-F0-9]{40}\b/g, replacement: '[redacted-address]' },
  { pattern: /\bbc1[ac-hj-np-z02-9]{11,71}\b/gi, replacement: '[redacted-address]' },
  { pattern: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g, replacement: '[redacted-address]' },
  { pattern: /(?:api[_-]?key|apikey|token)=([^&\s]+)/gi, replacement: 'api_key=[redacted]' },
  { pattern: /\/v2\/[A-Za-z0-9_-]{16,}\b/g, replacement: '/v2/[redacted-api-key]' },
];

function normalizeFieldName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSensitiveField(name: string | undefined): boolean {
  if (name === undefined) {
    return false;
  }
  return SENSITIVE_FIELD.has(normalizeFieldName(name));
}

function looksLikeAddress(value: string): boolean {
  return (
    /^0x[a-fA-F0-9]{40}$/.test(value) ||
    /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,90}$/i.test(value) ||
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
  );
}

export function resolveLogLevel(raw: string | undefined = process.env.COINWATCH_LOG): LogLevel {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'error' || normalized === 'warn' || normalized === 'info' || normalized === 'debug') {
    return normalized;
  }
  return 'warn';
}

export function redactString(text: string): string {
  let out = text;
  for (const { pattern, replacement } of STRING_REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function redactValue(value: unknown, fieldName?: string): unknown {
  if (isSensitiveField(fieldName)) {
    if (Array.isArray(value)) {
      return { count: value.length };
    }
    return '[redacted]';
  }

  if (typeof value === 'string') {
    if (fieldName === 'addresses' || looksLikeAddress(value)) {
      return '[redacted-address]';
    }
    return redactString(value);
  }

  if (Array.isArray(value)) {
    if (fieldName === 'addresses') {
      return { count: value.length };
    }
    return value.map((entry) => redactValue(entry));
  }

  if (typeof value === 'object' && value !== null) {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactString(value.message),
        ...(errorWithStatus(value) ? { status: value.status } : {}),
      };
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactValue(entry, key);
    }
    return out;
  }

  return value;
}

function errorWithStatus(value: Error): value is Error & { status: number } {
  return typeof (value as { status?: unknown }).status === 'number';
}

export interface LogRecord {
  level: LogLevel;
  scope: string;
  msg: string;
  [key: string]: unknown;
}

export function formatLogRecord(record: LogRecord): string {
  const payload = redactValue(record) as LogRecord;
  return JSON.stringify(payload);
}

export interface LoggerOptions {
  level?: LogLevel;
  sink?: (line: string) => void;
}

export interface Logger {
  error(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(scope: string, opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? resolveLogLevel();
  const sink = opts.sink ?? ((line) => console.error(line));

  const emit = (entryLevel: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_RANK[entryLevel] > LEVEL_RANK[level]) {
      return;
    }
    const record: LogRecord = { level: entryLevel, scope, msg: redactString(msg), ...fields };
    sink(formatLogRecord(record));
  };

  return {
    error: (msg, fields) => emit('error', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    debug: (msg, fields) => emit('debug', msg, fields),
  };
}

/** Process-wide default logger for provider and CLI diagnostics. */
export let log = createLogger('coinwatch');

/** Test hook: replace the process-wide logger (pass `{}` to restore defaults). */
export function configureLogForTests(opts: LoggerOptions = {}): void {
  log = createLogger('coinwatch', opts);
}
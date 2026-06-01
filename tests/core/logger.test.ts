import { describe, expect, it } from 'vitest';
import {
  createLogger,
  formatLogRecord,
  redactString,
  redactValue,
  resolveLogLevel,
} from '../../src/core/logger.js';

const SAMPLE_XPUB =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const SAMPLE_EVM = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';
const SAMPLE_BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

describe('resolveLogLevel', () => {
  it('defaults to warn when unset or invalid', () => {
    expect(resolveLogLevel(undefined)).toBe('warn');
    expect(resolveLogLevel('verbose')).toBe('warn');
  });

  it('accepts explicit levels', () => {
    expect(resolveLogLevel('debug')).toBe('debug');
    expect(resolveLogLevel('ERROR')).toBe('error');
  });
});

describe('redactString', () => {
  it('redacts xpubs, addresses, api keys, and URL credentials', () => {
    const text = [
      `xpub=${SAMPLE_XPUB}`,
      `addr=${SAMPLE_EVM}`,
      `btc=${SAMPLE_BTC}`,
      'https://mainnet.helius-rpc.com/?api-key=super-secret-helius-key',
      'https://eth-mainnet.g.alchemy.com/v2/AlchemyApiKeyExample123',
    ].join(' ');
    const redacted = redactString(text);
    expect(redacted).not.toContain(SAMPLE_XPUB);
    expect(redacted).not.toContain(SAMPLE_EVM);
    expect(redacted).not.toContain(SAMPLE_BTC);
    expect(redacted).not.toContain('super-secret-helius-key');
    expect(redacted).not.toContain('AlchemyApiKeyExample123');
    expect(redacted).toContain('[redacted-xpub]');
    expect(redacted).toContain('[redacted-address]');
    expect(redacted).toContain('api_key=[redacted]');
  });
});

describe('redactValue', () => {
  it('collapses address inventories and sensitive fields', () => {
    expect(redactValue(['a', 'b'], 'addresses')).toEqual({ count: 2 });
    expect(redactValue(SAMPLE_XPUB, 'xpub')).toBe('[redacted]');
    expect(redactValue({ apiKey: 'cg-demo-key-12345', chain: 'ethereum' })).toEqual({
      apiKey: '[redacted]',
      chain: 'ethereum',
    });
  });

  it('redacts error messages without dropping status metadata', () => {
    const err = Object.assign(new Error(`failed for ${SAMPLE_EVM}`), { status: 503 });
    expect(redactValue(err)).toEqual({
      name: 'Error',
      message: 'failed for [redacted-address]',
      status: 503,
    });
  });
});

describe('createLogger', () => {
  it('respects log level thresholds', () => {
    const lines: string[] = [];
    const logger = createLogger('test', {
      level: 'warn',
      sink: (line) => lines.push(line),
    });

    logger.debug('hidden');
    logger.info('hidden');
    logger.warn('visible', { chain: 'bitcoin' });
    logger.error('visible');

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.includes('"scope":"test"'))).toBe(true);
  });

  it('never emits raw secrets at debug verbosity', () => {
    const lines: string[] = [];
    const logger = createLogger('portfolio', {
      level: 'debug',
      sink: (line) => lines.push(line),
    });

    logger.debug('loaded accounts', {
      xpub: SAMPLE_XPUB,
      addresses: [SAMPLE_EVM, SAMPLE_BTC],
      url: `https://rpc.example/v2/${'abcdefghijklmnopqrstuvwxyz123456'}`,
    });

    const joined = lines.join('\n');
    expect(joined).not.toContain(SAMPLE_XPUB);
    expect(joined).not.toContain(SAMPLE_EVM);
    expect(joined).not.toContain(SAMPLE_BTC);
    expect(joined).toContain('"addresses":{"count":2}');
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      level: 'debug',
      scope: 'portfolio',
      xpub: '[redacted]',
    });
  });
});

describe('formatLogRecord', () => {
  it('produces stable JSON with redacted fields', () => {
    const line = formatLogRecord({
      level: 'warn',
      scope: 'coingecko',
      msg: `price lookup failed for ${SAMPLE_EVM}`,
      status: 429,
    });
    const parsed = JSON.parse(line) as { msg: string };
    expect(parsed.msg).not.toContain(SAMPLE_EVM);
    expect(parsed.msg).toContain('[redacted-address]');
  });
});
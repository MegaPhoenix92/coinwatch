import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAccounts, loadEnv } from '../../src/config/load.js';
import type { AccountDescriptor } from '../../src/domain/account.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coinwatch-cfg-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeAccounts(name: string, value: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(value), 'utf8');
  return file;
}

function writeRaw(name: string, value: string): string {
  const file = join(dir, name);
  writeFileSync(file, value, 'utf8');
  return file;
}

describe('loadAccounts', () => {
  it('parses a valid accounts file into a typed array', () => {
    const valid: AccountDescriptor[] = [
      {
        id: 'btc-main',
        label: 'BTC Main',
        family: 'bitcoin',
        chains: ['bitcoin'],
        source: {
          kind: 'xpub',
          xpub: 'zpub6FakePubKeyABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789',
          scriptType: 'p2wpkh',
          gapLimit: 20,
        },
      },
      {
        id: 'eth-watch',
        label: 'ETH Watch',
        family: 'evm',
        chains: ['ethereum', 'base'],
        source: { kind: 'addresses', addresses: ['0x1111111111111111111111111111111111111111'] },
      },
      {
        id: 'sol-watch',
        label: 'SOL Watch',
        family: 'solana',
        chains: ['solana'],
        source: { kind: 'addresses', addresses: ['So11111111111111111111111111111111111111112'] },
      },
    ];

    const result = loadAccounts(writeAccounts('accounts.json', valid));

    expect(result).toHaveLength(3);
    expect(result[0]?.id).toBe('btc-main');
    expect(result[0]?.family).toBe('bitcoin');
    if (result[0]?.source.kind === 'xpub') {
      expect(result[0].source.scriptType).toBe('p2wpkh');
      expect(result[0].source.gapLimit).toBe(20);
    } else {
      throw new Error('expected xpub source');
    }
    expect(result[1]?.chains).toEqual(['ethereum', 'base']);
    if (result[1]?.source.kind === 'addresses') {
      expect(result[1].source.addresses).toHaveLength(1);
    } else {
      throw new Error('expected addresses source');
    }
  });

  it('throws a clear error when an account is missing its source', () => {
    const invalid = [
      { id: 'broken', label: 'Broken', family: 'evm', chains: ['ethereum'] },
    ];

    expect(() => loadAccounts(writeAccounts('invalid.json', invalid))).toThrow(
      /Invalid accounts config/,
    );
  });

  it('throws when chains is empty', () => {
    const invalid = [
      {
        id: 'no-chains',
        label: 'No Chains',
        family: 'evm',
        chains: [],
        source: { kind: 'addresses', addresses: ['0x1111111111111111111111111111111111111111'] },
      },
    ];

    expect(() => loadAccounts(writeAccounts('empty-chains.json', invalid))).toThrow(
      /Invalid accounts config/,
    );
  });

  it('throws when the file does not contain a JSON array', () => {
    const file = writeAccounts('not-array.json', { id: 'x' });

    expect(() => loadAccounts(file)).toThrow(/Invalid accounts config/);
  });

  it('does not include malformed JSON input snippets in parse errors', () => {
    const secretLikeXpub = `zpub${'6DoNotLeakMalformedJsonFixture111111111111111111111111'}`;
    const file = writeRaw('malformed.json', `[{ "xpub": "${secretLikeXpub}", ]`);

    expect(() => loadAccounts(file)).toThrow(/file is not valid JSON/);

    try {
      loadAccounts(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain(file);
      expect(message).not.toContain(secretLikeXpub);
      expect(message).not.toContain('xpub');
      return;
    }
    throw new Error('expected loadAccounts to throw');
  });

  it('rejects duplicate account ids without echoing account values', () => {
    const invalid: AccountDescriptor[] = [
      {
        id: 'dup',
        label: 'First',
        family: 'evm',
        chains: ['ethereum'],
        source: { kind: 'addresses', addresses: ['0x1111111111111111111111111111111111111111'] },
      },
      {
        id: 'dup',
        label: 'Second',
        family: 'evm',
        chains: ['base'],
        source: { kind: 'addresses', addresses: ['0x2222222222222222222222222222222222222222'] },
      },
    ];

    expect(() => loadAccounts(writeAccounts('duplicate.json', invalid))).toThrow(/duplicate/);
  });

  it('rejects chain/family mismatches', () => {
    const invalid: AccountDescriptor[] = [
      {
        id: 'wrong-family',
        label: 'Wrong Family',
        family: 'evm',
        chains: ['bitcoin'],
        source: { kind: 'addresses', addresses: ['0x1111111111111111111111111111111111111111'] },
      },
    ];

    expect(() => loadAccounts(writeAccounts('family.json', invalid))).toThrow(
      /evm accounts may include only EVM chains/,
    );
  });

  it('rejects malformed addresses for the declared account family', () => {
    const invalid: AccountDescriptor[] = [
      {
        id: 'bad-address',
        label: 'Bad Address',
        family: 'evm',
        chains: ['ethereum'],
        source: { kind: 'addresses', addresses: ['not-an-evm-address'] },
      },
    ];

    expect(() => loadAccounts(writeAccounts('address.json', invalid))).toThrow(
      /invalid EVM address/,
    );
  });

  it('rejects xpub sources outside bitcoin accounts', () => {
    const invalid: AccountDescriptor[] = [
      {
        id: 'evm-xpub',
        label: 'EVM Xpub',
        family: 'evm',
        chains: ['ethereum'],
        source: {
          kind: 'xpub',
          xpub: 'xpub6FakePublicOnly111111111111111111111111111111111111',
          scriptType: 'p2wpkh',
        },
      },
    ];

    expect(() => loadAccounts(writeAccounts('xpub-family.json', invalid))).toThrow(
      /xpub sources are valid only for bitcoin accounts/,
    );
  });

  it('does not include xpub or address values in validation errors', () => {
    const secretLikeXpub = 'zpub6DoNotLeakThisFixtureValue111111111111111111111111';
    const secretLikeAddress = 'not-an-evm-address';
    const invalid: AccountDescriptor[] = [
      {
        id: 'btc-bad-xpub',
        label: 'Bad BTC',
        family: 'bitcoin',
        chains: ['bitcoin'],
        source: { kind: 'xpub', xpub: secretLikeXpub, scriptType: 'p2wpkh' },
      },
      {
        id: 'evm-bad-address',
        label: 'Bad EVM',
        family: 'evm',
        chains: ['ethereum'],
        source: { kind: 'addresses', addresses: [secretLikeAddress] },
      },
    ];

    expect(() => loadAccounts(writeAccounts('sanitized.json', invalid))).toThrow(
      /Invalid accounts config/,
    );

    try {
      loadAccounts(writeAccounts('sanitized-again.json', invalid));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secretLikeXpub);
      expect(message).not.toContain(secretLikeAddress);
      expect(message).toContain('source.xpub');
      expect(message).toContain('source.addresses.0');
      return;
    }
    throw new Error('expected loadAccounts to throw');
  });
});

describe('loadEnv', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads known API keys from process.env', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.ALCHEMY_API_KEY = 'alch-test';
    process.env.HELIUS_API_KEY = 'helius-test';
    process.env.COINGECKO_API_KEY = 'cg-test';

    const env = loadEnv();

    expect(env.anthropicApiKey).toBe('sk-ant-test');
    expect(env.alchemyApiKey).toBe('alch-test');
    expect(env.heliusApiKey).toBe('helius-test');
    expect(env.coingeckoApiKey).toBe('cg-test');
  });

  it('leaves keys undefined when env vars are absent', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ALCHEMY_API_KEY;
    delete process.env.HELIUS_API_KEY;
    delete process.env.COINGECKO_API_KEY;

    const env = loadEnv();

    expect(env.anthropicApiKey).toBeUndefined();
    expect(env.alchemyApiKey).toBeUndefined();
    expect(env.heliusApiKey).toBeUndefined();
    expect(env.coingeckoApiKey).toBeUndefined();
  });

  it('treats empty env values as unset', () => {
    process.env.ANTHROPIC_API_KEY = '';
    process.env.ALCHEMY_API_KEY = '';

    const env = loadEnv();

    expect(env.anthropicApiKey).toBeUndefined();
    expect(env.alchemyApiKey).toBeUndefined();
  });
});

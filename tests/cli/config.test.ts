import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseConfigCommand,
  runConfigTemplate,
  runConfigValidate,
} from '../../src/cli/config-commands.js';
import { parseAccountsFile } from '../../src/config/load.js';
import { ACCOUNTS_EXAMPLE_PATH } from '../../src/config/paths.js';
import { accountsTemplateJson } from '../../src/config/template.js';

let dir: string;
let stdout = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coinwatch-cli-config-'));
  stdout = '';
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function accountsFile(name: string, value: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(value), 'utf8');
  return file;
}

describe('parseConfigCommand', () => {
  it('parses config validate with optional paths', () => {
    expect(
      parseConfigCommand([
        'config',
        'validate',
        '--accounts',
        '/tmp/accounts.json',
        '--opening-balances',
        '/tmp/opening.json',
      ]),
    ).toEqual({
      kind: 'validate',
      accountsPath: '/tmp/accounts.json',
      openingBalancesPath: '/tmp/opening.json',
      requireOpeningBalances: true,
    });
  });

  it('parses config template with output path', () => {
    expect(parseConfigCommand(['config', 'template', '--out', '/tmp/accounts.local.json'])).toEqual({
      kind: 'template',
      examplePath: ACCOUNTS_EXAMPLE_PATH,
      outPath: '/tmp/accounts.local.json',
    });
  });

  it('returns undefined for unrelated argv', () => {
    expect(parseConfigCommand(['export-pnl'])).toBeUndefined();
  });
});

describe('runConfigValidate', () => {
  it('reports invalid accounts before runtime', () => {
    const accountsPath = accountsFile('bad.json', [
      { id: 'broken', label: 'Broken', family: 'evm', chains: ['ethereum'] },
    ]);
    const lines: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const ok = runConfigValidate({
        kind: 'validate',
        accountsPath,
        openingBalancesPath: join(dir, 'missing-opening.json'),
        requireOpeningBalances: false,
      });
      expect(ok).toBe(false);
      expect(lines.join('')).toMatch(/accounts .* invalid/);
      expect(lines.join('')).toMatch(/source/);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('passes for a valid accounts file', () => {
    const accountsPath = accountsFile('good.json', [
      {
        id: 'btc-1',
        label: 'BTC',
        family: 'bitcoin',
        chains: ['bitcoin'],
        source: {
          kind: 'addresses',
          addresses: ['bc1qexample0000000000000000000000000000000'],
        },
      },
    ]);
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      expect(
        runConfigValidate({
          kind: 'validate',
          accountsPath,
          openingBalancesPath: join(dir, 'missing-opening.json'),
          requireOpeningBalances: false,
        }),
      ).toBe(true);
      expect(parseAccountsFile(accountsPath).ok).toBe(true);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});

describe('accountsTemplateJson', () => {
  it('loads the tracked example file as pretty JSON', () => {
    expect(existsSync(ACCOUNTS_EXAMPLE_PATH)).toBe(true);
    const json = accountsTemplateJson();
    expect(json).toContain('"btc-cold-1"');
    expect(JSON.parse(json)).toEqual(JSON.parse(readFileSync(ACCOUNTS_EXAMPLE_PATH, 'utf8')));
  });

  it('writes template output when --out is provided', () => {
    const outPath = join(dir, 'accounts.local.json');
    const originalWrite = process.stdout.write.bind(process.stdout);
    const lines: string[] = [];
    process.stdout.write = ((chunk) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      runConfigTemplate({ kind: 'template', examplePath: ACCOUNTS_EXAMPLE_PATH, outPath });
      expect(readFileSync(outPath, 'utf8')).toBe(accountsTemplateJson());
      expect(lines.join('')).toContain(outPath);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
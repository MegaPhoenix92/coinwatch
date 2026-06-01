import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const cliPath = join(root, 'dist/cli.js');

describe('release build artifact', () => {
  it('declares pack contents and a bin target for dist/cli.js', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
      files: string[];
    };
    expect(pkg.bin.coinwatch).toBe('./dist/cli.js');
    expect(pkg.files).toEqual(
      expect.arrayContaining([
        'dist',
        'config/accounts.example.json',
        'README.md',
        'CHANGELOG.md',
        'LICENSE',
      ]),
    );
    expect(pkg.files.some((entry) => entry.startsWith('tests'))).toBe(false);
  });

  it('emits dist/cli.js with a node shebang when built (CI runs npm run build first)', () => {
    const source = readFileSync(cliPath, 'utf8');
    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(source.includes('export async function main')).toBe(true);
  });
});
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = process.cwd();
const cliPath = join(root, 'dist/cli.js');

describe('release build artifact', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], {
      cwd: root,
      stdio: 'pipe',
      timeout: 120_000,
    });
  }, 120_000);

  it('emits dist/cli.js with a node shebang for the bin target', () => {
    expect(existsSync(cliPath)).toBe(true);
    expect(readFileSync(cliPath, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
  });

  it('npm pack dry-run includes only declared runtime files', () => {
    const tarball = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    const parsed = JSON.parse(tarball) as [{ files: { path: string }[] }];
    const paths = parsed[0]?.files.map((entry) => entry.path) ?? [];
    expect(paths).toContain('dist/cli.js');
    expect(paths).toContain('config/accounts.example.json');
    expect(paths.some((path) => path.startsWith('tests/'))).toBe(false);
  });
});
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MANIFEST_PATH,
  parseRegistryCommand,
  runRegistryVerify,
} from '../../src/cli/registry-commands.js';

describe('parseRegistryCommand', () => {
  it('parses registry verify with optional manifest path', () => {
    expect(parseRegistryCommand(['registry', 'verify', '--manifest', '/tmp/manifest.json'])).toEqual({
      kind: 'verify',
      manifestPath: '/tmp/manifest.json',
    });
  });

  it('defaults manifest path', () => {
    expect(parseRegistryCommand(['registry', 'verify'])).toEqual({
      kind: 'verify',
      manifestPath: DEFAULT_MANIFEST_PATH,
    });
  });

  it('returns undefined for unrelated argv', () => {
    expect(parseRegistryCommand(['config', 'validate'])).toBeUndefined();
  });
});

describe('runRegistryVerify', () => {
  it('passes against the repo fixture', () => {
    const lines: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      expect(
        runRegistryVerify({
          kind: 'verify',
          manifestPath: DEFAULT_MANIFEST_PATH,
        }),
      ).toBe(true);
      expect(lines.join('')).toContain('registry (fixtures/expected-assets.json): ok');
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
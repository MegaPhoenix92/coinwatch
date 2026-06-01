import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSETS } from '../../src/domain/assets.js';
import {
  assetManifestEntry,
  assetsToManifest,
  compareManifests,
  parseManifestJson,
  stableManifestJson,
} from '../../src/domain/registry-verify.js';

const MANIFEST_PATH = join(process.cwd(), 'fixtures/expected-assets.json');

describe('registry-verify', () => {
  it('matches the pinned expected-assets manifest', () => {
    const expected = parseManifestJson(readFileSync(MANIFEST_PATH, 'utf8'));
    const actual = assetsToManifest(ASSETS);
    expect(compareManifests(actual, expected)).toEqual([]);
  });

  it('detects changed fields for the same manifest key', () => {
    const [first] = assetsToManifest(ASSETS);
    const actual = [{ ...first, decimals: first.decimals + 1 }];
    const drifts = compareManifests(actual, [first]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]?.kind).toBe('changed');
    expect(drifts[0]?.fields).toContain('decimals');
  });

  it('detects duplicate manifest keys', () => {
    const [first] = assetsToManifest(ASSETS);
    const drifts = compareManifests([first, first], [first]);
    expect(drifts.some((d) => d.kind === 'duplicate' && d.source === 'ASSETS')).toBe(true);
  });

  it('detects missing and extra rows', () => {
    const base = assetsToManifest(ASSETS);
    const [first, second] = base;
    const extra: (typeof base)[number] = {
      chain: 'ethereum',
      symbol: 'ETH',
      kind: 'token',
      address: '0x0000000000000000000000000000000000000001',
      decimals: 18,
      coingeckoId: 'ethereum',
    };
    expect(compareManifests([first, extra], [first, second]).map((d) => d.kind).sort()).toEqual([
      'extra',
      'missing',
    ]);
  });

  it('serializes Solana tokenProgram only when set', () => {
    const usdc = ASSETS.find((a) => a.chain === 'solana' && a.symbol === 'USDC');
    expect(usdc).toBeDefined();
    const entry = assetManifestEntry(usdc!);
    expect(entry.tokenProgram).toBe('spl-token');
    const eth = ASSETS.find((a) => a.chain === 'ethereum' && a.symbol === 'ETH');
    expect(assetManifestEntry(eth!)).not.toHaveProperty('tokenProgram');
  });

  it('produces stable JSON for fixture regeneration', () => {
    const once = stableManifestJson(assetsToManifest(ASSETS));
    const twice = stableManifestJson(assetsToManifest(ASSETS));
    expect(once).toBe(twice);
    expect(once).toBe(readFileSync(MANIFEST_PATH, 'utf8'));
  });
});
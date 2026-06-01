import type { AssetDef } from './assets.js';

/** Canonical, JSON-serializable snapshot of one registry row for drift detection. */
export interface AssetManifestEntry {
  chain: AssetDef['chain'];
  symbol: AssetDef['symbol'];
  kind: AssetDef['kind'];
  address: string | null;
  decimals: number;
  coingeckoId: string;
  tokenProgram?: AssetDef['tokenProgram'];
}

export interface RegistryDrift {
  kind: 'missing' | 'extra' | 'changed' | 'duplicate';
  key: string;
  expected?: AssetManifestEntry;
  actual?: AssetManifestEntry;
  fields?: string[];
  source?: 'ASSETS' | 'fixture';
}

const MANIFEST_KEY_SEP = '\0';

export function assetManifestEntry(asset: AssetDef): AssetManifestEntry {
  const entry: AssetManifestEntry = {
    chain: asset.chain,
    symbol: asset.symbol,
    kind: asset.kind,
    address: asset.address ?? null,
    decimals: asset.decimals,
    coingeckoId: asset.coingeckoId,
  };
  if (asset.tokenProgram !== undefined) {
    entry.tokenProgram = asset.tokenProgram;
  }
  return entry;
}

export function manifestEntryKey(entry: AssetManifestEntry): string {
  return [entry.chain, entry.symbol, entry.kind, entry.address ?? ''].join(MANIFEST_KEY_SEP);
}

function sortEntries(entries: readonly AssetManifestEntry[]): AssetManifestEntry[] {
  return [...entries].sort((a, b) => manifestEntryKey(a).localeCompare(manifestEntryKey(b)));
}

export function assetsToManifest(assets: readonly AssetDef[]): AssetManifestEntry[] {
  return sortEntries(assets.map(assetManifestEntry));
}

export function stableManifestJson(entries: readonly AssetManifestEntry[]): string {
  return `${JSON.stringify(sortEntries(entries), null, 2)}\n`;
}

function fieldDiffs(expected: AssetManifestEntry, actual: AssetManifestEntry): string[] {
  const fields: string[] = [];
  const keys = new Set([
    ...Object.keys(expected),
    ...Object.keys(actual),
  ] as (keyof AssetManifestEntry)[]);
  for (const key of keys) {
    const e = expected[key];
    const a = actual[key];
    if (e !== a) {
      fields.push(key);
    }
  }
  return fields;
}

function duplicateKeyDrifts(
  entries: readonly AssetManifestEntry[],
  source: RegistryDrift['source'],
): RegistryDrift[] {
  const seen = new Set<string>();
  const drifts: RegistryDrift[] = [];
  for (const entry of entries) {
    const key = manifestEntryKey(entry);
    if (seen.has(key)) {
      drifts.push({ kind: 'duplicate', key, source });
      continue;
    }
    seen.add(key);
  }
  return drifts;
}

export function compareManifests(
  actual: readonly AssetManifestEntry[],
  expected: readonly AssetManifestEntry[],
): RegistryDrift[] {
  const drifts: RegistryDrift[] = [
    ...duplicateKeyDrifts(actual, 'ASSETS'),
    ...duplicateKeyDrifts(expected, 'fixture'),
  ];
  const actualByKey = new Map(actual.map((entry) => [manifestEntryKey(entry), entry]));
  const expectedByKey = new Map(expected.map((entry) => [manifestEntryKey(entry), entry]));

  for (const [key, expectedEntry] of expectedByKey) {
    const actualEntry = actualByKey.get(key);
    if (actualEntry === undefined) {
      drifts.push({ kind: 'missing', key, expected: expectedEntry });
      continue;
    }
    const fields = fieldDiffs(expectedEntry, actualEntry);
    if (fields.length > 0) {
      drifts.push({ kind: 'changed', key, expected: expectedEntry, actual: actualEntry, fields });
    }
  }

  for (const [key, actualEntry] of actualByKey) {
    if (!expectedByKey.has(key)) {
      drifts.push({ kind: 'extra', key, actual: actualEntry });
    }
  }

  return drifts.sort((a, b) => a.key.localeCompare(b.key));
}

export function formatRegistryDrift(drift: RegistryDrift): string {
  const label = drift.key.split(MANIFEST_KEY_SEP).join('/');
  if (drift.kind === 'duplicate') {
    return `duplicate ${label}: repeated ${drift.source ?? 'manifest'} key`;
  }
  if (drift.kind === 'missing') {
    return `missing ${label}: expected in manifest but absent from ASSETS`;
  }
  if (drift.kind === 'extra') {
    return `extra ${label}: present in ASSETS but not in manifest`;
  }
  return `changed ${label}: fields ${drift.fields?.join(', ')} (expected ${JSON.stringify(drift.expected)} vs actual ${JSON.stringify(drift.actual)})`;
}

export function parseManifestJson(text: string): AssetManifestEntry[] {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Asset manifest must be a JSON array.');
  }
  return sortEntries(parsed as AssetManifestEntry[]);
}
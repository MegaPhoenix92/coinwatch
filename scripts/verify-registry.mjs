#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'fixtures/expected-assets.json');
const ASSETS_JS = join(ROOT, 'dist/domain/assets.js');
const VERIFY_JS = join(ROOT, 'dist/domain/registry-verify.js');

function usage() {
  console.error('usage: node scripts/verify-registry.mjs [--manifest path]');
  console.error('  Requires npm run build first (imports dist/domain/*.js).');
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}

let manifestPath = MANIFEST;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--manifest' && args[i + 1] !== undefined) {
    manifestPath = args[i + 1];
    i += 1;
  } else {
    console.error(`coinwatch registry verify failed: unknown argument ${args[i]}`);
    usage();
    process.exit(1);
  }
}

if (!existsSync(ASSETS_JS) || !existsSync(VERIFY_JS)) {
  console.error('coinwatch registry verify failed: missing dist build (run npm run build)');
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  console.error(`coinwatch registry verify failed: missing manifest ${manifestPath}`);
  process.exit(1);
}

const { ASSETS } = await import(ASSETS_JS);
const {
  assetsToManifest,
  compareManifests,
  formatRegistryDrift,
  parseManifestJson,
} = await import(VERIFY_JS);

const expected = parseManifestJson(readFileSync(manifestPath, 'utf8'));
const actual = assetsToManifest(ASSETS);
const drifts = compareManifests(actual, expected);

if (drifts.length > 0) {
  console.error(`coinwatch registry verify failed: ${drifts.length} drift(s) vs ${manifestPath}`);
  for (const drift of drifts) {
    console.error(`  - ${formatRegistryDrift(drift)}`);
  }
  process.exit(1);
}

console.log(`coinwatch registry verify passed: ${actual.length} assets match ${manifestPath}`);
import { readFileSync } from 'node:fs';
import { stderr, stdout } from 'node:process';
import { ASSETS } from '../domain/assets.js';
import {
  assetsToManifest,
  compareManifests,
  formatRegistryDrift,
  parseManifestJson,
} from '../domain/registry-verify.js';

export const DEFAULT_MANIFEST_PATH = 'fixtures/expected-assets.json';

export interface RegistryVerifyCommand {
  kind: 'verify';
  manifestPath: string;
}

export function parseRegistryCommand(argv: readonly string[]): RegistryVerifyCommand | undefined {
  if (argv[0] !== 'registry') {
    return undefined;
  }

  const subcommand = argv[1];
  if (subcommand !== 'verify') {
    throw new Error(`Unknown registry subcommand "${subcommand ?? ''}". Use "verify".`);
  }

  const command: RegistryVerifyCommand = {
    kind: 'verify',
    manifestPath: DEFAULT_MANIFEST_PATH,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--manifest' && next !== undefined) {
      command.manifestPath = next;
      i += 1;
    } else {
      throw new Error(`Unknown registry verify argument: ${arg}`);
    }
  }
  return command;
}

export function runRegistryVerify(command: RegistryVerifyCommand): boolean {
  const expected = parseManifestJson(readFileSync(command.manifestPath, 'utf8'));
  const actual = assetsToManifest(ASSETS);
  const drifts = compareManifests(actual, expected);

  if (drifts.length === 0) {
    stdout.write(`registry (${command.manifestPath}): ok (${actual.length} assets)\n`);
    return true;
  }

  stderr.write(`registry (${command.manifestPath}): drift detected\n`);
  for (const drift of drifts) {
    stderr.write(`  - ${formatRegistryDrift(drift)}\n`);
  }
  return false;
}
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const EXCLUDED_TRACKED_FILES = new Set([
  '.env.example',
  'config/accounts.example.json',
]);

const SECRET_PATTERNS = [
  { name: 'xpub/ypub/zpub', pattern: /\b[xyz]pub[1-9A-HJ-NP-Za-km-z]{20,}\b/ },
  { name: '64-hex private key', pattern: /\b(?:0x)?[a-fA-F0-9]{64}\b/ },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'OpenAI/Stripe-style API key', pattern: /\bsk-(?:live|test|proj)-[A-Za-z0-9_-]{20,}\b/ },
];

const PUBLIC_DERIVATION_ZPUB =
  'zpub' +
  '6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1' +
  'ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const PLACEHOLDER_ZPUB =
  'zpub' +
  '6FakePubKeyABCDEFGHJKLMNPQRSTUVWXYZ' +
  'abcdefghijkmnopqrstuvwxyz123456789';

const ALLOWED_PUBLIC_FIXTURES = [
  {
    file: 'tests/adapters/bitcoin-adapter.test.ts',
    kind: 'xpub/ypub/zpub',
    text: PUBLIC_DERIVATION_ZPUB,
    reason: 'public zpub fixture used for deterministic watch-only address derivation tests',
  },
  {
    file: 'tests/core/btc-derive.test.ts',
    kind: 'xpub/ypub/zpub',
    text: PUBLIC_DERIVATION_ZPUB,
    reason: 'public zpub fixture used for deterministic watch-only address derivation tests',
  },
  {
    file: 'tests/core/btc-gap-scan.test.ts',
    kind: 'xpub/ypub/zpub',
    text: PUBLIC_DERIVATION_ZPUB,
    reason: 'public zpub fixture used for BIP44 gap-scan tests',
  },
  {
    file: 'tests/config/load.test.ts',
    kind: 'xpub/ypub/zpub',
    text: PLACEHOLDER_ZPUB,
    reason: 'synthetic placeholder zpub used to test config parsing',
  },
];

function usage() {
  console.error('usage: node scripts/check-secrets.mjs [path ...]');
}

function isProbablyText(path) {
  return !/\.(?:png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|tgz|db|sqlite)$/i.test(path);
}

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((file) => !EXCLUDED_TRACKED_FILES.has(file));
}

function collectFiles(target) {
  const stat = lstatSync(target);
  if (stat.isDirectory()) {
    return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
      const full = join(target, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(full);
      }
      return entry.isFile() && isProbablyText(full) ? [full] : [];
    });
  }
  return stat.isFile() && isProbablyText(target) ? [target] : [];
}

function filesToScan(targets) {
  if (targets.length > 0) {
    return targets.flatMap(collectFiles);
  }
  return trackedFiles().filter((file) => existsSync(file) && isProbablyText(file));
}

function scanLine(file, line, lineNumber) {
  return SECRET_PATTERNS.flatMap((secret) =>
    secret.pattern.test(line)
      ? [{ file, lineNumber, kind: secret.name, text: line.trim() }]
      : [],
  );
}

function isAllowedFinding(finding) {
  const normalized = relative(process.cwd(), finding.file);
  if (finding.kind === '64-hex private key' && /\btxid\b/i.test(finding.text)) {
    return true;
  }
  return ALLOWED_PUBLIC_FIXTURES.some((allowed) =>
    allowed.file === normalized &&
    allowed.kind === finding.kind &&
    finding.text.includes(allowed.text) &&
    allowed.reason.length > 0,
  );
}

function scanFile(file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .flatMap((line, index) => scanLine(file, line, index + 1));
}

const targets = process.argv.slice(2);
if (targets.includes('--help') || targets.includes('-h')) {
  usage();
  process.exit(0);
}

const files = filesToScan(targets);
const findings = files.flatMap(scanFile).filter((finding) => !isAllowedFinding(finding));

if (findings.length > 0) {
  console.error('coinwatch secret scan failed: possible tracked secret material found');
  for (const finding of findings) {
    const path = relative(process.cwd(), finding.file);
    console.error(`${path}:${finding.lineNumber} ${finding.kind}: ${finding.text}`);
  }
  process.exit(1);
}

console.log(`coinwatch secret scan passed: scanned ${files.length} file(s)`);

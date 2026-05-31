#!/usr/bin/env node
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const DEFAULT_TARGETS = ['src'];
const ALLOW_MARKER = 'coinwatch-allow-no-signing:';

const FORBIDDEN = [
  { name: '.sign(', pattern: /\.sign\s*\(/ },
  { name: '.signIdx(', pattern: /\.signIdx\s*\(/ },
  { name: 'Transaction.*sign', pattern: /\bTransaction\b.*\bsign\b/ },
  { name: 'secp256k1.sign', pattern: /\bsecp256k1\s*\.\s*sign\b/ },
  { name: 'signTransaction', pattern: /\bsignTransaction\s*\(/ },
  { name: 'signMessage', pattern: /\bsignMessage\s*\(/ },
  { name: 'signTypedData', pattern: /\bsignTypedData\s*\(/ },
  { name: 'signAllTransactions', pattern: /\bsignAllTransactions\s*\(/ },
  { name: 'sendRawTransaction', pattern: /\bsendRawTransaction\s*\(/ },
  { name: 'sendTransaction', pattern: /\bsendTransaction\s*\(/ },
  { name: 'writeContract', pattern: /\bwriteContract\b/ },
  { name: 'WalletClient', pattern: /\bWalletClient\b/ },
  { name: 'createWalletClient', pattern: /\bcreateWalletClient\b/ },
  { name: 'privateKeyToAccount', pattern: /\bprivateKeyToAccount\b/ },
  { name: 'Keypair', pattern: /\bKeypair\b/ },
  { name: 'secretKey', pattern: /\bsecretKey\b/ },
  { name: 'fromSecretKey', pattern: /\bfromSecretKey\b/ },
  { name: 'mnemonic', pattern: /\bmnemonic\b/i },
  { name: 'fromSeed', pattern: /\bfromSeed\b/ },
];

function usage() {
  console.error('usage: node scripts/check-no-signing.mjs [path ...]');
}

function isScannableFile(path) {
  return /\.(?:[cm]?[jt]s|tsx)$/.test(path);
}

function collectFiles(target) {
  const stat = lstatSync(target);
  if (stat.isDirectory()) {
    return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
      const full = join(target, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(full);
      }
      return entry.isFile() && isScannableFile(full) ? [full] : [];
    });
  }
  return stat.isFile() && isScannableFile(target) ? [target] : [];
}

function scanLine(file, line, lineNumber) {
  if (line.includes(ALLOW_MARKER)) {
    const reason = line.split(ALLOW_MARKER)[1]?.trim();
    if (reason === undefined || reason.length === 0) {
      return [{ file, lineNumber, symbol: 'allowlist', text: 'allowlist entry lacks a justification' }];
    }
    return [];
  }

  return FORBIDDEN.flatMap((forbidden) =>
    forbidden.pattern.test(line)
      ? [{ file, lineNumber, symbol: forbidden.name, text: line.trim() }]
      : [],
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

const scanTargets = targets.length === 0 ? DEFAULT_TARGETS : targets;
const findings = scanTargets.flatMap(collectFiles).flatMap(scanFile);

if (findings.length > 0) {
  console.error('coinwatch no-signing gate failed: forbidden signing/broadcast/private-key symbols found');
  for (const finding of findings) {
    const path = relative(process.cwd(), finding.file);
    console.error(`${path}:${finding.lineNumber} ${finding.symbol}: ${finding.text}`);
  }
  process.exit(1);
}

console.log(`coinwatch no-signing gate passed: scanned ${scanTargets.join(', ')}`);

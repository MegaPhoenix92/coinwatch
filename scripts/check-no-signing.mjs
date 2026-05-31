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
  // viem/accounts standalone signing + key/HD-seed creation. viem is already a
  // src/ dependency and `viem/accounts` is one import away, so these are reachable
  // bypasses that the names above (privateKeyToAccount/signTransaction/…) miss.
  // Targeted to stay clear of the legit watch-only HDKey.fromExtendedKey(xpub).
  { name: 'generatePrivateKey', pattern: /\bgeneratePrivateKey\s*\(/ },
  { name: 'sign(', pattern: /\bsign\s*\(/ },
  { name: 'signAuthorization', pattern: /\bsignAuthorization\s*\(/ },
  { name: 'mnemonicToAccount', pattern: /\bmnemonicToAccount\s*\(/ },
  { name: 'hdKeyToAccount', pattern: /\bhdKeyToAccount\s*\(/ },
  { name: 'generateMnemonic', pattern: /\bgenerateMnemonic\s*\(/ },
  { name: 'fromMasterSeed', pattern: /\bfromMasterSeed\s*\(/ },
  { name: 'HDKey.fromJSON', pattern: /\bHDKey\s*\.\s*fromJSON\s*\(/ },
  { name: 'signTransactionMessageWithSigners', pattern: /\bsignTransactionMessageWithSigners\s*\(/ },
  { name: 'signTransactionWithSigners', pattern: /\bsignTransactionWithSigners\s*\(/ },
  { name: 'partiallySignTransaction', pattern: /\bpartiallySignTransaction\s*\(/ },
  { name: 'partiallySignTransactionMessageWithSigners', pattern: /\bpartiallySignTransactionMessageWithSigners\s*\(/ },
  { name: 'partiallySignTransactionWithSigners', pattern: /\bpartiallySignTransactionWithSigners\s*\(/ },
  { name: 'signAndSendTransactionMessageWithSigners', pattern: /\bsignAndSendTransactionMessageWithSigners\s*\(/ },
  { name: 'signAndSendTransactionWithSigners', pattern: /\bsignAndSendTransactionWithSigners\s*\(/ },
  { name: 'sendAndConfirmDurableNonceTransactionFactory', pattern: /\bsendAndConfirmDurableNonceTransactionFactory\s*\(/ },
  { name: 'sendAndConfirmTransactionFactory', pattern: /\bsendAndConfirmTransactionFactory\s*\(/ },
  { name: 'sendTransactionWithoutConfirmingFactory', pattern: /\bsendTransactionWithoutConfirmingFactory\s*\(/ },
  { name: 'signOffchainMessageEnvelope', pattern: /\bsignOffchainMessageEnvelope\s*\(/ },
  { name: 'signOffchainMessageWithSigners', pattern: /\bsignOffchainMessageWithSigners\s*\(/ },
  { name: 'partiallySignOffchainMessageEnvelope', pattern: /\bpartiallySignOffchainMessageEnvelope\s*\(/ },
  { name: 'partiallySignOffchainMessageWithSigners', pattern: /\bpartiallySignOffchainMessageWithSigners\s*\(/ },
  { name: 'signBytes', pattern: /\bsignBytes\s*\(/ },
  { name: 'setTransactionMessageFeePayerSigner', pattern: /\bsetTransactionMessageFeePayerSigner\s*\(/ },
  { name: 'addSignersToInstruction', pattern: /\baddSignersToInstruction\s*\(/ },
  { name: 'addSignersToTransactionMessage', pattern: /\baddSignersToTransactionMessage\s*\(/ },
  { name: 'upgradeRoleToSigner', pattern: /\bupgradeRoleToSigner\s*\(/ },
  { name: 'generateKeyPair', pattern: /\bgenerateKeyPair\s*\(/ },
  { name: 'generateKeyPairSigner', pattern: /\bgenerateKeyPairSigner\s*\(/ },
  { name: 'grindKeyPair', pattern: /\bgrindKeyPair\s*\(/ },
  { name: 'grindKeyPairs', pattern: /\bgrindKeyPairs\s*\(/ },
  { name: 'grindKeyPairSigner', pattern: /\bgrindKeyPairSigner\s*\(/ },
  { name: 'grindKeyPairSigners', pattern: /\bgrindKeyPairSigners\s*\(/ },
  { name: 'createKeyPairFromBytes', pattern: /\bcreateKeyPairFromBytes\s*\(/ },
  { name: 'createKeyPairFromPrivateKeyBytes', pattern: /\bcreateKeyPairFromPrivateKeyBytes\s*\(/ },
  { name: 'createKeyPairSignerFromBytes', pattern: /\bcreateKeyPairSignerFromBytes\s*\(/ },
  { name: 'createKeyPairSignerFromPrivateKeyBytes', pattern: /\bcreateKeyPairSignerFromPrivateKeyBytes\s*\(/ },
  { name: 'createSignerFromKeyPair', pattern: /\bcreateSignerFromKeyPair\s*\(/ },
  { name: 'createPrivateKeyFromBytes', pattern: /\bcreatePrivateKeyFromBytes\s*\(/ },
  { name: 'getPublicKeyFromPrivateKey', pattern: /\bgetPublicKeyFromPrivateKey\s*\(/ },
  { name: 'writeKeyPair', pattern: /\bwriteKeyPair\s*\(/ },
  { name: 'writeKeyPairSigner', pattern: /\bwriteKeyPairSigner\s*\(/ },
  { name: 'Keypair', pattern: /\bKeypair\b/ },
  { name: 'secretKey', pattern: /\bsecretKey\b/ },
  { name: 'fromSecretKey', pattern: /\bfromSecretKey\b/ },
  // Broad on purpose: a watch-only wallet never touches a mnemonic in any form
  // (mnemonicToAccount/generateMnemonic/mnemonicToSeed*/mnemonicToEntropy). The
  // previous /\bmnemonic\b/i had a trailing-\b bug that matched only a bare token
  // and let every real call-site through. FP-free (src/ has zero mnemonic refs).
  { name: 'mnemonic', pattern: /mnemonic/i },
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

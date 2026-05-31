import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { buildTools } from '../../src/mcp/tools.js';
import type { AccountDescriptor } from '../../src/domain/account.js';
import type { PortfolioService } from '../../src/services/portfolio-service.js';

const execFileAsync = promisify(execFile);
const CHECK_SCRIPT = join(process.cwd(), 'scripts/check-no-signing.mjs');
const SOLANA_KIT_BANNED_SYMBOLS = [
  'signTransactionMessageWithSigners',
  'signTransactionWithSigners',
  'partiallySignTransaction',
  'partiallySignTransactionMessageWithSigners',
  'partiallySignTransactionWithSigners',
  'signAndSendTransactionMessageWithSigners',
  'signAndSendTransactionWithSigners',
  'sendAndConfirmDurableNonceTransactionFactory',
  'sendAndConfirmTransactionFactory',
  'sendTransactionWithoutConfirmingFactory',
  'signOffchainMessageEnvelope',
  'signOffchainMessageWithSigners',
  'partiallySignOffchainMessageEnvelope',
  'partiallySignOffchainMessageWithSigners',
  'signBytes',
  'setTransactionMessageFeePayerSigner',
  'addSignersToInstruction',
  'addSignersToTransactionMessage',
  'upgradeRoleToSigner',
  'generateKeyPair',
  'generateKeyPairSigner',
  'grindKeyPair',
  'grindKeyPairs',
  'grindKeyPairSigner',
  'grindKeyPairSigners',
  'createKeyPairFromBytes',
  'createKeyPairFromPrivateKeyBytes',
  'createKeyPairSignerFromBytes',
  'createKeyPairSignerFromPrivateKeyBytes',
  'createSignerFromKeyPair',
  'createPrivateKeyFromBytes',
  'getPublicKeyFromPrivateKey',
  'writeKeyPair',
  'writeKeyPairSigner',
] as const;

const accounts: AccountDescriptor[] = [
  {
    id: 'acct-1',
    label: 'Watch only',
    family: 'bitcoin',
    chains: ['bitcoin'],
    source: { kind: 'addresses', addresses: ['bc1qexample'] },
  },
];

const service = {
  getPortfolio: async () => ({
    totalUsd: 0,
    byAsset: [],
    byChain: [],
    balances: [],
    warnings: [],
  }),
  listAddresses: async () => [],
  getReceiveAddress: async () => ({
    address: 'bc1qexample',
    derived: false,
    note: 'verify on your signing device before use',
  }),
  getHistory: async () => [],
  prepareTransfer: async () => ({
    kind: 'btc-psbt',
    payload: 'cHNidP8BAHECAAAAAA==',
    summary: {
      chain: 'bitcoin',
      asset: 'BTC',
      from: 'bc1qexample',
      to: 'bc1qexample',
      amount: '0.0005',
      rawAmount: '50000',
      decimals: 8,
      fee: '0',
      rawFee: '0',
      feeAsset: 'BTC',
      artifactHash: '0'.repeat(64),
    },
    verifyNote: 'Verify the destination address + amount on your signing device before signing.',
  }),
} as unknown as PortfolioService;

describe('no-signing static gate', () => {
  it('passes on the clean src tree', async () => {
    const { stdout } = await execFileAsync(process.execPath, [CHECK_SCRIPT, 'src']);
    expect(stdout).toContain('coinwatch no-signing gate passed');
  });

  it('flags a planted signing violation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coinwatch-no-signing-'));
    const fixture = join(dir, 'bad.ts');
    await writeFile(
      fixture,
      'export async function bad(wallet: { signTransaction(tx: unknown): unknown }, tx: unknown) { return wallet.signTransaction(tx); }\n',
      'utf8',
    );

    await expect(execFileAsync(process.execPath, [CHECK_SCRIPT, fixture])).rejects.toMatchObject({
      stderr: expect.stringContaining('signTransaction'),
    });
  });

  it('exposes exactly the five watch-only MCP tools', () => {
    const names = buildTools(service, accounts).map((tool) => tool.name).sort();
    expect(names).toEqual([
      'derive_receive_address',
      'get_history',
      'get_portfolio',
      'list_addresses',
      'prepare_transfer',
    ]);
    expect(names.some((name) => /sign|broadcast/i.test(name))).toBe(false);
  });
});

describe('no-signing gate - Phase 2 construction is allowed, signing still banned', () => {
  it('allows buildUnsignedTransfer but flags tx.sign(', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cw-p2-'));
    const ok = join(dir, 'ok.ts');
    await writeFile(ok, 'export async function buildUnsignedTransfer() { return {}; }\n', 'utf8');
    const okRun = await execFileAsync(process.execPath, [CHECK_SCRIPT, ok]);
    expect(okRun.stdout).toContain('coinwatch no-signing gate passed');

    const bad = join(dir, 'bad.ts');
    await writeFile(
      bad,
      'export function f(tx: { sign(k: unknown): void }, k: unknown) { tx.sign(k); }\n',
      'utf8',
    );
    await expect(execFileAsync(process.execPath, [CHECK_SCRIPT, bad])).rejects.toMatchObject({
      stderr: expect.stringContaining('.sign('),
    });
  });

  it('flags @solana/kit signing, signer attachment, and keypair primitives', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cw-solana-gate-'));
    const fixture = join(dir, 'bad-solana-kit.ts');
    await writeFile(
      fixture,
      SOLANA_KIT_BANNED_SYMBOLS.map(
        (symbol) => `export function ${symbol}Probe() { return ${symbol}(); }`,
      ).join('\n'),
      'utf8',
    );

    await expect(execFileAsync(process.execPath, [CHECK_SCRIPT, fixture])).rejects.toMatchObject({
      stderr: expect.stringContaining('coinwatch no-signing gate failed'),
    });
    let stderr = '';
    try {
      await execFileAsync(process.execPath, [CHECK_SCRIPT, fixture]);
    } catch (error) {
      stderr = (error as { stderr?: string }).stderr ?? '';
    }
    for (const symbol of SOLANA_KIT_BANNED_SYMBOLS) {
      expect(stderr).toContain(symbol);
    }
  });

  it('flags viem/accounts signing + key/HD-seed/mnemonic creation primitives', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cw-viem-gate-'));
    const fixture = join(dir, 'bad-viem-seed.ts');
    // Each line is a real bypass primitive that previously passed the gate green:
    // standalone viem/accounts signers + key/mnemonic/HD-seed creation, plus the
    // @scure/bip32 HDKey static keygen methods. The gate is a text scanner, so the
    // fixture need not typecheck — only the call-site text must be flagged.
    const dangerousCallSites = [
      'const a = generatePrivateKey();',
      'const b = sign({ hash, privateKey });',
      'const c = signAuthorization({});',
      'const d = mnemonicToAccount(phrase);',
      'const e = hdKeyToAccount({});',
      'const f = generateMnemonic();',
      'const g = mnemonicToSeedSync(phrase);',
      'const h = HDKey.fromMasterSeed(seed);',
      'const i = HDKey.fromJSON(json);',
    ];
    await writeFile(fixture, dangerousCallSites.join('\n'), 'utf8');

    let stderr = '';
    try {
      await execFileAsync(process.execPath, [CHECK_SCRIPT, fixture]);
    } catch (error) {
      stderr = (error as { stderr?: string }).stderr ?? '';
    }
    for (const needle of [
      'generatePrivateKey(',
      'sign(',
      'signAuthorization(',
      'mnemonicToAccount(',
      'hdKeyToAccount(',
      'generateMnemonic(',
      'mnemonicToSeedSync(',
      'HDKey.fromMasterSeed(',
      'HDKey.fromJSON(',
    ]) {
      expect(stderr).toContain(needle);
    }
  });
});

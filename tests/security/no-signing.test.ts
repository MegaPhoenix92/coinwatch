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

  it('exposes exactly the four read-only MCP tools', () => {
    const names = buildTools(service, accounts).map((tool) => tool.name).sort();
    expect(names).toEqual([
      'derive_receive_address',
      'get_history',
      'get_portfolio',
      'list_addresses',
    ]);
    expect(names.some((name) => /sign|send|broadcast|transfer/i.test(name))).toBe(false);
  });
});

import { unlinkSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ReceiveAddress } from '../../src/adapters/chain-adapter.js';
import type { AccountDescriptor, DerivedAddress } from '../../src/domain/account.js';
import { VERIFY_NOTE, type UnsignedArtifact } from '../../src/domain/transfer.js';
import type { PortfolioView, Tx } from '../../src/domain/types.js';
import { buildHandlers, buildTools } from '../../src/mcp/tools.js';
import type { PortfolioService } from '../../src/services/portfolio-service.js';
import type { Store } from '../../src/db/store.js';

const accounts: AccountDescriptor[] = [
  {
    id: 'acct-1',
    label: 'Test BTC',
    family: 'bitcoin',
    chains: ['bitcoin'],
    source: { kind: 'xpub', xpub: 'zpub-test', scriptType: 'p2wpkh' },
  },
];

const fakePortfolio: PortfolioView = {
  totalUsd: 1234.56,
  byAsset: [{ symbol: 'BTC', amount: '0.5', usd: 1234.56 }],
  byChain: [{ chain: 'bitcoin', usd: 1234.56 }],
  balances: [{ chain: 'bitcoin', symbol: 'BTC', amount: '0.5', usd: 1234.56 }],
  warnings: [],
};

const fakeAddresses: DerivedAddress[] = [
  {
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    chain: 'bitcoin',
    path: "m/84'/0'/0'/0/0",
    derived: true,
  },
];

const fakeReceive: ReceiveAddress = {
  address: 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g',
  derived: true,
  path: "m/84'/0'/0'/0/1",
  note: 'Always verify on your signing device before use.',
};

const fakeHistory: Tx[] = [
  {
    chain: 'bitcoin',
    txid: 'abc123',
    timestamp: 1700000000,
    direction: 'in',
    symbol: 'BTC',
    raw: 50000000n,
    decimals: 8,
    confirmed: true,
  },
];

function makeFakeService(): PortfolioService {
  const artifact: UnsignedArtifact = {
    kind: 'btc-psbt',
    payload: 'cHNidP8BAHECAAAAAA==',
    summary: {
      chain: 'bitcoin',
      asset: 'BTC',
      from: fakeAddresses[0].address,
      to: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      amount: '0.0005',
      rawAmount: '50000',
      decimals: 8,
      fee: '0.000001',
      rawFee: '100',
      feeAsset: 'BTC',
      artifactHash: '0'.repeat(64),
    },
    verifyNote: VERIFY_NOTE,
  };
  return {
    getPortfolio: async () => fakePortfolio,
    listAddresses: async () => fakeAddresses,
    getReceiveAddress: async () => fakeReceive,
    getHistory: async () => fakeHistory,
    prepareTransfer: async () => artifact,
  } as unknown as PortfolioService;
}

describe('buildHandlers', () => {
  it('exposes exactly the 7 watch-only handlers by name', () => {
    const handlers = buildHandlers(makeFakeService(), accounts);
    expect(Object.keys(handlers).sort()).toEqual([
      'derive_receive_address',
      'export_pnl',
      'get_history',
      'get_portfolio',
      'list_addresses',
      'prepare_transfer',
      'reconcile',
    ]);
  });

  it('get_portfolio returns CallToolResult text with numeric totalUsd', async () => {
    const handlers = buildHandlers(makeFakeService(), accounts);
    const result = await handlers.get_portfolio();
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text) as PortfolioView;
    expect(typeof parsed.totalUsd).toBe('number');
    expect(parsed.totalUsd).toBe(1234.56);
  });

  it('list_addresses returns the derived addresses as JSON text', async () => {
    const handlers = buildHandlers(makeFakeService(), accounts);
    const parsed = JSON.parse((await handlers.list_addresses()).content[0].text) as DerivedAddress[];
    expect(parsed[0]?.address).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  });

  it('derive_receive_address includes the on-device verification note', async () => {
    const handlers = buildHandlers(makeFakeService(), accounts);
    const result = await handlers.derive_receive_address({ accountId: 'acct-1', index: 1 });
    expect(result.content[0].text).toContain('verify');
    expect(result.content[0].text).toContain('signing device before use');
  });

  it('get_history stringifies bigint raw values without throwing', async () => {
    const handlers = buildHandlers(makeFakeService(), accounts);
    const parsed = JSON.parse((await handlers.get_history({ limit: 10 })).content[0].text) as Array<
      Omit<Tx, 'raw'> & { raw: string }
    >;
    expect(parsed[0]?.raw).toBe('50000000');
    expect(typeof parsed[0]?.raw).toBe('string');
  });

  it('prepare_transfer returns an unsigned artifact summary as JSON text', async () => {
    const handlers = buildHandlers(makeFakeService(), accounts);
    const parsed = JSON.parse((await handlers.prepare_transfer({
      accountId: 'acct-1',
      to: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      asset: 'BTC',
      amount: '0.0005',
    })).content[0].text) as UnsignedArtifact & { file: string };
    expect(parsed.kind).toBe('btc-psbt');
    expect(parsed.summary.rawAmount).toBe('50000');
    expect(parsed.file).toMatch(/coinwatch-unsigned-btc-psbt-\d+\.psbt$/);
    unlinkSync(parsed.file);
  });
});

describe('buildTools', () => {
  it('wraps the 7 handlers into SDK tool definitions', () => {
    const tools = buildTools(makeFakeService(), accounts);
    expect(tools).toHaveLength(7);
  });
});

describe('buildHandlers — store-wired (labels)', () => {
  it('attaches store labels in list_addresses', async () => {
    const fakeStore = {
      getLabel: (_chain: string, address: string) =>
        address === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu' ? 'cold-storage' : undefined,
    } as unknown as Store;

    const handlers = buildHandlers(makeFakeService(), accounts, fakeStore);

    // still exactly the seven watch-only handlers
    expect(Object.keys(handlers).sort()).toEqual([
      'derive_receive_address',
      'export_pnl',
      'get_history',
      'get_portfolio',
      'list_addresses',
      'prepare_transfer',
      'reconcile',
    ]);

    const listed = JSON.parse((await handlers.list_addresses()).content[0].text) as Array<
      DerivedAddress & { label?: string }
    >;
    expect(listed[0]?.label).toBe('cold-storage');
  });

  it('omits labels and skips caching when no store is provided (backward-compatible)', async () => {
    const handlers = buildHandlers(makeFakeService(), accounts);
    const listed = JSON.parse((await handlers.list_addresses()).content[0].text) as Array<
      DerivedAddress & { label?: string }
    >;
    expect(listed[0]).not.toHaveProperty('label');
  });
});

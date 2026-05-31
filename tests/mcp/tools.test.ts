import { describe, expect, it } from 'vitest';
import type { ReceiveAddress } from '../../src/adapters/chain-adapter.js';
import type { AccountDescriptor, DerivedAddress } from '../../src/domain/account.js';
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
  return {
    getPortfolio: async () => fakePortfolio,
    listAddresses: async () => fakeAddresses,
    getReceiveAddress: async () => fakeReceive,
    getHistory: async () => fakeHistory,
  } as unknown as PortfolioService;
}

describe('buildHandlers', () => {
  it('exposes exactly the 4 read-only handlers by name', () => {
    const handlers = buildHandlers(makeFakeService(), accounts);
    expect(Object.keys(handlers).sort()).toEqual([
      'derive_receive_address',
      'get_history',
      'get_portfolio',
      'list_addresses',
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
});

describe('buildTools', () => {
  it('wraps the 4 handlers into SDK tool definitions', () => {
    const tools = buildTools(makeFakeService(), accounts);
    expect(tools).toHaveLength(4);
  });
});

describe('buildHandlers — store-wired (labels + tx cache)', () => {
  it('attaches labels in list_addresses and write-through caches in get_history', async () => {
    let cachedCount = -1;
    const fakeStore = {
      getLabel: (_chain: string, address: string) =>
        address === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu' ? 'cold-storage' : undefined,
      cacheTxs: (txs: Tx[]) => {
        cachedCount = txs.length;
      },
    } as unknown as Store;

    const handlers = buildHandlers(makeFakeService(), accounts, fakeStore);

    // still exactly the four read-only handlers
    expect(Object.keys(handlers).sort()).toEqual([
      'derive_receive_address',
      'get_history',
      'get_portfolio',
      'list_addresses',
    ]);

    const listed = JSON.parse((await handlers.list_addresses()).content[0].text) as Array<
      DerivedAddress & { label?: string }
    >;
    expect(listed[0]?.label).toBe('cold-storage');

    await handlers.get_history({ limit: 10 });
    expect(cachedCount).toBe(1);
  });

  it('omits labels and skips caching when no store is provided (backward-compatible)', async () => {
    const handlers = buildHandlers(makeFakeService(), accounts);
    const listed = JSON.parse((await handlers.list_addresses()).content[0].text) as Array<
      DerivedAddress & { label?: string }
    >;
    expect(listed[0]).not.toHaveProperty('label');
  });
});

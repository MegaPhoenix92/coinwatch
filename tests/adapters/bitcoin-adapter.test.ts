import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BitcoinAdapter } from '../../src/adapters/bitcoin-adapter.js';
import type {
  BtcDataProvider,
  MempoolAddressResponse,
  MempoolTx,
} from '../../src/adapters/chain-adapter.js';
import type { AccountDescriptor, DerivedAddress } from '../../src/domain/account.js';
import { MempoolProvider } from '../../src/providers/mempool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const CHANGE_ADDRESS = 'bc1qchangeaddressxxxxxxxxxxxxxxxxxxxxxxxxxx';
const RECIPIENT_ADDRESS = 'bc1qrecipientxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const ACCOUNT_ZPUB =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/mempool/address.json'), 'utf8'),
) as MempoolAddressResponse;

const inboundTx: MempoolTx = {
  txid: 'a1b2c3d4e5f600000000000000000000000000000000000000000000000000ff',
  vin: [
    {
      prevout: {
        scriptpubkey_address: 'bc1qothersenderaddressxxxxxxxxxxxxxxxxxxxx',
        value: 20000000,
      },
    },
  ],
  vout: [
    { scriptpubkey_address: ADDRESS, value: 12000000 },
    { scriptpubkey_address: 'bc1qunwatchedchangeaddressxxxxxxxxxxxxxxxx', value: 7999000 },
  ],
  status: { confirmed: true, block_time: 1700000000 },
  fee: 1000,
};

const outboundTx: MempoolTx = {
  txid: 'b1b2c3d4e5f600000000000000000000000000000000000000000000000000ff',
  vin: [{ prevout: { scriptpubkey_address: ADDRESS, value: 50000000 } }],
  vout: [
    { scriptpubkey_address: RECIPIENT_ADDRESS, value: 30000000 },
    { scriptpubkey_address: CHANGE_ADDRESS, value: 19999000 },
  ],
  status: { confirmed: true, block_time: 1700000100 },
  fee: 1000,
};

const selfTx: MempoolTx = {
  txid: 'c1b2c3d4e5f600000000000000000000000000000000000000000000000000ff',
  vin: [{ prevout: { scriptpubkey_address: ADDRESS, value: 10000000 } }],
  vout: [{ scriptpubkey_address: CHANGE_ADDRESS, value: 9999000 }],
  status: { confirmed: true, block_time: 1700000200 },
  fee: 1000,
};

const EMPTY_STATS = {
  chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
  mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
} as const;

class FakeBtcProvider implements BtcDataProvider {
  constructor(
    private readonly txs: MempoolTx[] = [inboundTx],
    private readonly addressResponse: MempoolAddressResponse = fixture,
    private readonly usedAddresses: Set<string> | 'all' = 'all',
  ) {}

  async getAddress(address: string): Promise<MempoolAddressResponse> {
    if (this.usedAddresses !== 'all' && !this.usedAddresses.has(address)) {
      return { address, ...EMPTY_STATS };
    }
    return { ...this.addressResponse, address };
  }

  async getAddressTxs(_address: string): Promise<MempoolTx[]> {
    return this.txs;
  }

  async getUtxos(_address: string) {
    return [];
  }
}

function literalAccount(addresses: string[]): AccountDescriptor {
  return {
    id: 'btc-literal',
    label: 'BTC literal',
    family: 'bitcoin',
    chains: ['bitcoin'],
    source: { kind: 'addresses', addresses },
  };
}

function xpubAccount(gapLimit?: number): AccountDescriptor {
  return {
    id: 'btc-xpub',
    label: 'BTC xpub',
    family: 'bitcoin',
    chains: ['bitcoin'],
    source: { kind: 'xpub', xpub: ACCOUNT_ZPUB, scriptType: 'p2wpkh', gapLimit },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MempoolProvider', () => {
  it('fetches address and txs through Esplora-compatible REST endpoints', async () => {
    const fakeFetch = vi.fn(async (url: string | URL) => {
      const value = String(url).endsWith('/txs') ? [inboundTx] : fixture;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => value,
      } as Response;
    });
    vi.stubGlobal('fetch', fakeFetch);

    const provider = new MempoolProvider('https://mempool.fixture/api');

    await expect(provider.getAddress(ADDRESS)).resolves.toMatchObject({ address: ADDRESS });
    await expect(provider.getAddressTxs(ADDRESS)).resolves.toHaveLength(1);
    expect(fakeFetch).toHaveBeenNthCalledWith(
      1,
      `https://mempool.fixture/api/address/${ADDRESS}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fakeFetch).toHaveBeenNthCalledWith(
      2,
      `https://mempool.fixture/api/address/${ADDRESS}/txs`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe('BitcoinAdapter', () => {
  it('reports family bitcoin and derives addresses', () => {
    const adapter = new BitcoinAdapter(new FakeBtcProvider());
    expect(adapter.family).toBe('bitcoin');
    expect(adapter.capabilities.derivesAddresses).toBe(true);
  });

  it('resolveAddresses passes through literal addresses as not-derived', async () => {
    const adapter = new BitcoinAdapter(new FakeBtcProvider());
    const resolved = await adapter.resolveAddresses(literalAccount([ADDRESS]));
    expect(resolved).toEqual([{ address: ADDRESS, chain: 'bitcoin', derived: false }]);
  });

  it('resolveAddresses BIP44 gap-scans receive and change branches separately', async () => {
    const adapter = new BitcoinAdapter(new FakeBtcProvider([inboundTx], fixture, new Set([ADDRESS])));

    const gap2 = await adapter.resolveAddresses(xpubAccount(2));
    expect(gap2).toHaveLength(5);
    expect(gap2.slice(0, 3)).toEqual([
      { address: ADDRESS, chain: 'bitcoin', path: "m/84'/0'/0'/0/0", derived: true },
      {
        address: 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g',
        chain: 'bitcoin',
        path: "m/84'/0'/0'/0/1",
        derived: true,
      },
      {
        address: 'bc1qp59yckz4ae5c4efgw2s5wfyvrz0ala7rgvuz8z',
        chain: 'bitcoin',
        path: "m/84'/0'/0'/0/2",
        derived: true,
      },
    ]);
    expect(gap2[3]?.path).toBe("m/84'/0'/0'/1/0");
    expect(gap2[4]?.path).toBe("m/84'/0'/0'/1/1");

    const unusedOnly = new FakeBtcProvider([], {
      ...fixture,
      chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
      mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
    });
    const defaultGap = await new BitcoinAdapter(unusedOnly).resolveAddresses(xpubAccount());
    expect(defaultGap).toHaveLength(40);
    expect(defaultGap.filter((address) => address.path?.includes('/0/'))).toHaveLength(20);
    expect(defaultGap.filter((address) => address.path?.includes('/1/'))).toHaveLength(20);
  });

  it('getReceiveAddress returns literal and derived addresses with verify notes', async () => {
    const adapter = new BitcoinAdapter(new FakeBtcProvider());

    const literal = await adapter.getReceiveAddress(literalAccount([ADDRESS]));
    expect(literal.address).toBe(ADDRESS);
    expect(literal.derived).toBe(false);
    expect(literal.note).toContain('verify on your signing device before use');

    const derived = await adapter.getReceiveAddress(xpubAccount(2), 1);
    expect(derived.address).toBe('bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
    expect(derived.path).toBe("m/84'/0'/0'/0/1");
    expect(derived.derived).toBe(true);
    expect(derived.note).toContain('verify it on your signing device before use');
  });

  it('getBalances computes raw = funded - spent', async () => {
    const adapter = new BitcoinAdapter(new FakeBtcProvider());
    const addresses: DerivedAddress[] = [{ address: ADDRESS, chain: 'bitcoin', derived: false }];

    const balances = await adapter.getBalances(addresses);

    expect(balances).toEqual([
      {
        chain: 'bitcoin',
        address: ADDRESS,
        symbol: 'BTC',
        raw: 10007599040n,
        decimals: 8,
        pendingRaw: 0n,
      },
    ]);
  });

  it('getBalances surfaces mempool_stats as pendingRaw', async () => {
    const pendingFixture: MempoolAddressResponse = {
      ...fixture,
      mempool_stats: { funded_txo_sum: 8000, spent_txo_sum: 3000, tx_count: 2 },
    };
    const adapter = new BitcoinAdapter(new FakeBtcProvider([], pendingFixture));
    const balances = await adapter.getBalances([
      { address: ADDRESS, chain: 'bitcoin', derived: false },
    ]);

    expect(balances[0]).toMatchObject({ pendingRaw: 5000n });
  });

  it('getHistory groups txs by txid across watched addresses, maps net deltas, and sorts newest first', async () => {
    const adapter = new BitcoinAdapter(new FakeBtcProvider([inboundTx, outboundTx, selfTx]));
    const addresses: DerivedAddress[] = [
      { address: ADDRESS, chain: 'bitcoin', derived: false },
      { address: CHANGE_ADDRESS, chain: 'bitcoin', derived: false, path: "m/84'/0'/0'/1/0" },
    ];

    const history = await adapter.getHistory(addresses);

    expect(history).toEqual([
      {
        chain: 'bitcoin',
        txid: selfTx.txid,
        timestamp: 1700000200,
        direction: 'self',
        selfTransferLeg: 'out',
        symbol: 'BTC',
        raw: 1000n,
        decimals: 8,
        confirmed: true,
      },
      {
        chain: 'bitcoin',
        txid: outboundTx.txid,
        timestamp: 1700000100,
        direction: 'out',
        symbol: 'BTC',
        raw: 30001000n,
        decimals: 8,
        counterparty: RECIPIENT_ADDRESS,
        confirmed: true,
      },
      {
        chain: 'bitcoin',
        txid: inboundTx.txid,
        timestamp: 1700000000,
        direction: 'in',
        symbol: 'BTC',
        raw: 12000000n,
        decimals: 8,
        counterparty: 'bc1qothersenderaddressxxxxxxxxxxxxxxxxxxxx',
        confirmed: true,
      },
    ]);
  });

  it('getHistory respects opts.limit across address results', async () => {
    const adapter = new BitcoinAdapter(new FakeBtcProvider([inboundTx, outboundTx]));
    const addresses: DerivedAddress[] = [{ address: ADDRESS, chain: 'bitcoin', derived: false }];

    await expect(adapter.getHistory(addresses, { limit: 0 })).resolves.toHaveLength(0);
    await expect(adapter.getHistory(addresses, { limit: 1 })).resolves.toHaveLength(1);
  });
});

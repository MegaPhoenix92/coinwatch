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
    { scriptpubkey_address: 'bc1qchangeaddressxxxxxxxxxxxxxxxxxxxxxxxxxx', value: 7999000 },
  ],
  status: { confirmed: true, block_time: 1700000000 },
  fee: 1000,
};

const outboundTx: MempoolTx = {
  txid: 'b1b2c3d4e5f600000000000000000000000000000000000000000000000000ff',
  vin: [{ prevout: { scriptpubkey_address: ADDRESS, value: 50000000 } }],
  vout: [
    { scriptpubkey_address: 'bc1qrecipientxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', value: 30000000 },
    { scriptpubkey_address: 'bc1qchangeaddressxxxxxxxxxxxxxxxxxxxxxxxxxx', value: 19999000 },
  ],
  status: { confirmed: true, block_time: 1700000100 },
  fee: 1000,
};

const selfTx: MempoolTx = {
  txid: 'c1b2c3d4e5f600000000000000000000000000000000000000000000000000ff',
  vin: [{ prevout: { scriptpubkey_address: ADDRESS, value: 10000000 } }],
  vout: [{ scriptpubkey_address: ADDRESS, value: 9999000 }],
  status: { confirmed: true, block_time: 1700000200 },
  fee: 1000,
};

class FakeBtcProvider implements BtcDataProvider {
  constructor(private readonly txs: MempoolTx[] = [inboundTx]) {}

  async getAddress(address: string): Promise<MempoolAddressResponse> {
    return { ...fixture, address };
  }

  async getAddressTxs(_address: string): Promise<MempoolTx[]> {
    return this.txs;
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
    expect(fakeFetch).toHaveBeenNthCalledWith(1, `https://mempool.fixture/api/address/${ADDRESS}`);
    expect(fakeFetch).toHaveBeenNthCalledWith(
      2,
      `https://mempool.fixture/api/address/${ADDRESS}/txs`,
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

  it('resolveAddresses derives from an xpub using account gapLimit or default 20', async () => {
    const adapter = new BitcoinAdapter(new FakeBtcProvider());

    const two = await adapter.resolveAddresses(xpubAccount(2));
    expect(two).toEqual([
      { address: ADDRESS, chain: 'bitcoin', path: "m/84'/0'/0'/0/0", derived: true },
      {
        address: 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g',
        chain: 'bitcoin',
        path: "m/84'/0'/0'/0/1",
        derived: true,
      },
    ]);

    const defaultGap = await adapter.resolveAddresses(xpubAccount());
    expect(defaultGap).toHaveLength(20);
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
      },
    ]);
  });

  it('getHistory maps inbound, outbound, and self transactions with net deltas', async () => {
    const adapter = new BitcoinAdapter(new FakeBtcProvider([inboundTx, outboundTx, selfTx]));
    const addresses: DerivedAddress[] = [{ address: ADDRESS, chain: 'bitcoin', derived: false }];

    const history = await adapter.getHistory(addresses);

    expect(history).toEqual([
      {
        chain: 'bitcoin',
        txid: inboundTx.txid,
        timestamp: 1700000000,
        direction: 'in',
        symbol: 'BTC',
        raw: 12000000n,
        decimals: 8,
        confirmed: true,
      },
      {
        chain: 'bitcoin',
        txid: outboundTx.txid,
        timestamp: 1700000100,
        direction: 'out',
        symbol: 'BTC',
        raw: 50000000n,
        decimals: 8,
        confirmed: true,
      },
      {
        chain: 'bitcoin',
        txid: selfTx.txid,
        timestamp: 1700000200,
        direction: 'self',
        symbol: 'BTC',
        raw: 1000n,
        decimals: 8,
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

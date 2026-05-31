import { readFileSync, unlinkSync } from 'node:fs';
import { sha256 } from '@noble/hashes/sha2.js';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BitcoinAdapter } from '../../src/adapters/bitcoin-adapter.js';
import type {
  BtcDataProvider,
  BtcUtxo,
  MempoolAddressResponse,
  MempoolTx,
  PriceProvider,
} from '../../src/adapters/chain-adapter.js';
import type { AccountDescriptor } from '../../src/domain/account.js';
import type { ChainFamily } from '../../src/domain/chains.js';
import { buildHandlers } from '../../src/mcp/tools.js';
import { PortfolioService } from '../../src/services/portfolio-service.js';

const WATCHED = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const RECIPIENT = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const accounts: AccountDescriptor[] = [
  {
    id: 'btc',
    label: 'BTC',
    family: 'bitcoin',
    chains: ['bitcoin'],
    source: { kind: 'addresses', addresses: [WATCHED] },
  },
];

const fakeBtcProvider: BtcDataProvider = {
  async getAddress(address: string): Promise<MempoolAddressResponse> {
    return {
      address,
      chain_stats: { funded_txo_sum: 200_000, spent_txo_sum: 0, tx_count: 1 },
      mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
    };
  },
  async getAddressTxs(): Promise<MempoolTx[]> {
    return [];
  },
  async getUtxos(): Promise<BtcUtxo[]> {
    return [{ txid: 'b'.repeat(64), vout: 0, value: 200_000 }];
  },
};

const fakePrices: PriceProvider = {
  async getUsdPrices(): Promise<Map<string, number>> {
    return new Map([['bitcoin', 60_000]]);
  },
};

describe('prepare_transfer MCP handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an unsigned artifact summary + a file path, and never broadcasts', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const adapters = new Map<ChainFamily, BitcoinAdapter>([
      ['bitcoin', new BitcoinAdapter(fakeBtcProvider)],
    ]);
    const service = new PortfolioService(adapters, fakePrices);
    const handlers = buildHandlers(service, accounts);

    const res = await handlers.prepare_transfer({
      accountId: 'btc',
      to: RECIPIENT,
      asset: 'BTC',
      amount: '0.0005',
    });
    const parsed = JSON.parse(res.content[0].text) as {
      kind: string;
      summary: { to: string; rawAmount: string; artifactHash: string };
      verifyNote: string;
      file: string;
    };

    expect(parsed.kind).toBe('btc-psbt');
    expect(parsed.summary.rawAmount).toBe('50000');
    expect(parsed.summary.to).toBe(RECIPIENT);
    expect(parsed.summary.artifactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.verifyNote).toContain('Verify');
    expect(parsed.file).toMatch(/coinwatch-unsigned-btc-psbt-1700000000000\.psbt$/);

    // The .psbt file is the BINARY PSBT (not base64 text); sha256(file) must equal
    // summary.artifactHash so the user can reproduce the on-device cross-check.
    const fileBytes = new Uint8Array(readFileSync(parsed.file));
    expect(hex.encode(sha256(fileBytes))).toBe(parsed.summary.artifactHash);
    expect(() => btc.Transaction.fromPSBT(fileBytes)).not.toThrow();
    unlinkSync(parsed.file);
  });

  it('rejects a malformed fee rate and writes no artifact', async () => {
    const adapters = new Map<ChainFamily, BitcoinAdapter>([
      ['bitcoin', new BitcoinAdapter(fakeBtcProvider)],
    ]);
    const service = new PortfolioService(adapters, fakePrices);
    const handlers = buildHandlers(service, accounts);

    await expect(
      handlers.prepare_transfer({
        accountId: 'btc',
        to: RECIPIENT,
        asset: 'BTC',
        amount: '0.0005',
        feeRate: '1.5',
      }),
    ).rejects.toThrow(/fee rate/i);
  });
});

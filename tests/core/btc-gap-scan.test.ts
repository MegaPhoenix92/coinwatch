import { describe, expect, it, vi } from 'vitest';
import type { BtcDataProvider, MempoolAddressResponse } from '../../src/adapters/chain-adapter.js';
import {
  DEFAULT_MAX_GAP_SCAN_INDEX,
  isBtcAddressUsed,
  scanGapBranch,
} from '../../src/core/btc-gap-scan.js';
import { deriveAddressAt } from '../../src/core/btc-derive.js';

const ACCOUNT_ZPUB =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

function emptyStats(): MempoolAddressResponse['chain_stats'] {
  return { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 };
}

function usedStats(): MempoolAddressResponse['chain_stats'] {
  return { funded_txo_sum: 1000, spent_txo_sum: 0, tx_count: 1 };
}

class UsageProvider implements BtcDataProvider {
  constructor(private readonly used: Set<string>) {}

  async getAddress(address: string): Promise<MempoolAddressResponse> {
    const stats = this.used.has(address) ? usedStats() : emptyStats();
    return { address, chain_stats: stats, mempool_stats: emptyStats() };
  }

  async getAddressTxs(): Promise<never[]> {
    return [];
  }

  async getUtxos(): Promise<never[]> {
    return [];
  }
}

describe('isBtcAddressUsed', () => {
  it('detects chain or mempool activity', () => {
    expect(
      isBtcAddressUsed({
        address: 'bc1q',
        chain_stats: emptyStats(),
        mempool_stats: usedStats(),
      }),
    ).toBe(true);
    expect(
      isBtcAddressUsed({
        address: 'bc1q',
        chain_stats: emptyStats(),
        mempool_stats: emptyStats(),
      }),
    ).toBe(false);
  });
});

describe('scanGapBranch', () => {
  it('stops after gapLimit consecutive unused addresses', async () => {
    const index0 = deriveAddressAt(ACCOUNT_ZPUB, 'p2wpkh', 0, 0);
    const provider = new UsageProvider(new Set([index0.address]));

    const scanned = await scanGapBranch(provider, ACCOUNT_ZPUB, 'p2wpkh', 2, 0, 10);
    expect(scanned).toHaveLength(3);
    expect(scanned[0].address).toBe(index0.address);
    expect(scanned[2].path).toBe("m/84'/0'/0'/0/2");
  });

  it('includes trailing unused indices after the last used address', async () => {
    const index0 = deriveAddressAt(ACCOUNT_ZPUB, 'p2wpkh', 0, 0);
    const index2 = deriveAddressAt(ACCOUNT_ZPUB, 'p2wpkh', 2, 0);
    const provider = new UsageProvider(new Set([index0.address, index2.address]));

    const scanned = await scanGapBranch(provider, ACCOUNT_ZPUB, 'p2wpkh', 2, 0, 20);
    expect(scanned.map((row) => row.path)).toEqual([
      "m/84'/0'/0'/0/0",
      "m/84'/0'/0'/0/1",
      "m/84'/0'/0'/0/2",
      "m/84'/0'/0'/0/3",
      "m/84'/0'/0'/0/4",
    ]);
  });

  it('warns and returns partial scan when maxIndex is reached', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const provider = new UsageProvider(new Set());

    const scanned = await scanGapBranch(provider, ACCOUNT_ZPUB, 'p2wpkh', 5, 0, 3);
    expect(scanned).toHaveLength(3);
    expect(DEFAULT_MAX_GAP_SCAN_INDEX).toBe(200);
    warn.mockRestore();
  });
});
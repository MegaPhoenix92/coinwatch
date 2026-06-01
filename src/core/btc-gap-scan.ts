import type { BtcDataProvider, MempoolAddressResponse } from '../adapters/chain-adapter.js';
import type { BtcScriptType } from '../domain/account.js';
import { log } from './logger.js';
import { deriveAddressAt } from './btc-derive.js';

export const DEFAULT_MAX_GAP_SCAN_INDEX = 200;

/** True when mempool/Esplora reports any activity for this address. */
export function isBtcAddressUsed(resp: MempoolAddressResponse): boolean {
  const { chain_stats: chain, mempool_stats: pool } = resp;
  return (
    chain.tx_count > 0 ||
    pool.tx_count > 0 ||
    chain.funded_txo_sum > 0 ||
    pool.funded_txo_sum > 0 ||
    chain.spent_txo_sum > 0 ||
    pool.spent_txo_sum > 0
  );
}

/**
 * BIP44 gap-limit scan for one branch (receive or change).
 * Derives index-by-index until `gapLimit` consecutive unused addresses.
 */
export async function scanGapBranch(
  provider: BtcDataProvider,
  accountXpub: string,
  scriptType: BtcScriptType,
  gapLimit: number,
  change: 0 | 1,
  maxIndex: number = DEFAULT_MAX_GAP_SCAN_INDEX,
): Promise<{ address: string; path: string }[]> {
  const out: { address: string; path: string }[] = [];
  let consecutiveUnused = 0;
  let index = 0;

  while (consecutiveUnused < gapLimit && index < maxIndex) {
    const derived = deriveAddressAt(accountXpub, scriptType, index, change);
    const resp = await provider.getAddress(derived.address);
    out.push(derived);

    if (isBtcAddressUsed(resp)) {
      consecutiveUnused = 0;
    } else {
      consecutiveUnused += 1;
    }
    index += 1;
  }

  if (consecutiveUnused < gapLimit && index >= maxIndex) {
    log.warn('btc gap scan hit maxIndex before gap satisfied', {
      change,
      gapLimit,
      maxIndex,
      derived: out.length,
    });
  }

  return out;
}
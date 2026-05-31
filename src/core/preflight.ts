import type { AssetSymbol } from '../domain/assets.js';
import type { Chain } from '../domain/chains.js';

const BTC_DUST_SAT = 546n;

export function assertSendable(p: {
  chain: Chain;
  asset: AssetSymbol;
  rawAmount: bigint;
}): void {
  if (p.rawAmount <= 0n) {
    throw new Error('Transfer amount must be positive.');
  }
  if (p.chain === 'bitcoin' && p.rawAmount < BTC_DUST_SAT) {
    throw new Error(
      `Transfer amount ${p.rawAmount} sat is below the dust threshold (${BTC_DUST_SAT} sat).`,
    );
  }
}

/** Parse a human decimal string into base units for `decimals`, rejecting over-precision. */
export function toBaseUnits(amount: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid amount "${amount}".`);
  }
  const [whole, frac = ''] = amount.split('.');
  if (frac.length > decimals) {
    throw new Error(`Amount "${amount}" has more than ${decimals} decimal places for this asset.`);
  }
  return BigInt(whole + frac.padEnd(decimals, '0'));
}

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

// Generous fat-finger ceiling for a fee rate (BTC sat/vB or EVM gwei). Real
// rates are well under this; a larger value is almost certainly a mistake and
// would build an artifact paying an absurd fee. selectUTXO independently
// rejects negatives, but unvalidated BigInt() leaks raw V8 errors on
// "1.5"/"abc" and silently turns "" into 0n (a non-relayable zero-fee tx).
const MAX_FEE_RATE = 100_000n;

/** Parse a user/agent-supplied fee-rate string into a positive bounded bigint. */
export function parseFeeRate(raw: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid fee rate "${raw}": expected a positive integer.`);
  }
  const feeRate = BigInt(raw);
  if (feeRate <= 0n) {
    throw new Error('Fee rate must be greater than zero.');
  }
  if (feeRate > MAX_FEE_RATE) {
    throw new Error(`Fee rate ${feeRate} exceeds the sanity limit of ${MAX_FEE_RATE}.`);
  }
  return feeRate;
}

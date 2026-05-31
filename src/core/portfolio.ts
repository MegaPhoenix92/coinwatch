import type { AssetSymbol } from '../domain/assets.js';
import type { Balance } from '../domain/types.js';

export interface SymbolTotal {
  symbol: AssetSymbol;
  raw: bigint;
  decimals: number;
}

export function sumBySymbol(balances: Balance[]): SymbolTotal[] {
  const totals = new Map<AssetSymbol, SymbolTotal>();

  for (const { symbol, raw, decimals } of balances) {
    const existing = totals.get(symbol);
    if (existing === undefined) {
      totals.set(symbol, { symbol, raw, decimals });
      continue;
    }

    if (existing.decimals !== decimals) {
      throw new Error(`Decimals mismatch for ${symbol}: ${existing.decimals} vs ${decimals}`);
    }

    existing.raw += raw;
  }

  return [...totals.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

import { formatUnits, toNumberAmount } from './money.js';
import { sumBySymbol } from './portfolio.js';
import type { AssetSymbol } from '../domain/assets.js';
import type { Chain } from '../domain/chains.js';
import type { Balance, PortfolioView, PricedBalance } from '../domain/types.js';

export type AssetLookup = (
  chain: Chain,
  symbol: AssetSymbol,
) => { coingeckoId: string } | undefined;

export function value(
  balances: Balance[],
  prices: Map<string, number>,
  lookup: AssetLookup,
): PortfolioView {
  const warnings: string[] = [];

  const priced: PricedBalance[] = balances.map((balance) => {
    const amount = formatUnits(balance.raw, balance.decimals);
    const coingeckoId = lookup(balance.chain, balance.symbol)?.coingeckoId;
    const price = coingeckoId === undefined ? undefined : prices.get(coingeckoId);
    let usd = 0;

    if (price === undefined) {
      warnings.push(`no price for ${balance.symbol} on ${balance.chain}`);
    } else {
      usd = toNumberAmount(balance.raw, balance.decimals) * price;
    }

    return { chain: balance.chain, symbol: balance.symbol, amount, usd };
  });

  const usdBySymbol = new Map<AssetSymbol, number>();
  for (const pricedBalance of priced) {
    usdBySymbol.set(
      pricedBalance.symbol,
      (usdBySymbol.get(pricedBalance.symbol) ?? 0) + pricedBalance.usd,
    );
  }

  const byAsset = sumBySymbol(balances).map((symbolTotal) => ({
    symbol: symbolTotal.symbol,
    amount: formatUnits(symbolTotal.raw, symbolTotal.decimals),
    usd: usdBySymbol.get(symbolTotal.symbol) ?? 0,
  }));

  const usdByChain = new Map<Chain, number>();
  for (const pricedBalance of priced) {
    usdByChain.set(
      pricedBalance.chain,
      (usdByChain.get(pricedBalance.chain) ?? 0) + pricedBalance.usd,
    );
  }
  const byChain = [...usdByChain.entries()].map(([chain, usd]) => ({ chain, usd }));

  const totalUsd = priced.reduce((sum, pricedBalance) => sum + pricedBalance.usd, 0);

  return { totalUsd, byAsset, byChain, balances: priced, warnings };
}

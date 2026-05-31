import type { AssetSymbol } from './assets.js';
import type { Chain } from './chains.js';

export interface Balance {
  chain: Chain;
  address: string;
  symbol: AssetSymbol;
  raw: bigint;
  decimals: number;
}

export interface Tx {
  chain: Chain;
  txid: string;
  timestamp?: number;
  direction: 'in' | 'out' | 'self' | 'unknown';
  symbol: AssetSymbol;
  raw: bigint;
  decimals: number;
  counterparty?: string;
  confirmed: boolean;
}

export interface HistoryOptions {
  limit?: number;
}

export interface PricedBalance {
  chain: Chain;
  symbol: AssetSymbol;
  amount: string;
  usd: number;
}

export interface PortfolioView {
  totalUsd: number;
  byAsset: { symbol: AssetSymbol; amount: string; usd: number }[];
  byChain: { chain: Chain; usd: number }[];
  balances: PricedBalance[];
  warnings: string[];
}

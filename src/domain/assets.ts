import type { Chain } from './chains.js';

export type AssetSymbol = 'BTC' | 'ETH' | 'POL' | 'SOL' | 'USDC' | 'USDT' | 'PYUSD';

export interface AssetDef {
  chain: Chain;
  symbol: AssetSymbol;
  kind: 'native' | 'token';
  address?: string;
  decimals: number;
  coingeckoId: string;
  tokenProgram?: 'spl-token' | 'token-2022';
}

export const SOL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SOL_TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export const ASSETS: AssetDef[] = [
  { chain: 'bitcoin', symbol: 'BTC', kind: 'native', decimals: 8, coingeckoId: 'bitcoin' },
  { chain: 'ethereum', symbol: 'ETH', kind: 'native', decimals: 18, coingeckoId: 'ethereum' },
  { chain: 'ethereum', symbol: 'USDC', kind: 'token', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, coingeckoId: 'usd-coin' },
  { chain: 'ethereum', symbol: 'USDT', kind: 'token', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, coingeckoId: 'tether' },
  { chain: 'ethereum', symbol: 'PYUSD', kind: 'token', address: '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8', decimals: 6, coingeckoId: 'paypal-usd' },
  { chain: 'base', symbol: 'ETH', kind: 'native', decimals: 18, coingeckoId: 'ethereum' },
  { chain: 'base', symbol: 'USDC', kind: 'token', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, coingeckoId: 'usd-coin' },
  { chain: 'polygon', symbol: 'POL', kind: 'native', decimals: 18, coingeckoId: 'matic-network' },
  { chain: 'polygon', symbol: 'USDC', kind: 'token', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, coingeckoId: 'usd-coin' },
  { chain: 'polygon', symbol: 'USDT', kind: 'token', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, coingeckoId: 'tether' },
  { chain: 'arbitrum', symbol: 'ETH', kind: 'native', decimals: 18, coingeckoId: 'ethereum' },
  { chain: 'arbitrum', symbol: 'USDC', kind: 'token', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, coingeckoId: 'usd-coin' },
  { chain: 'arbitrum', symbol: 'USDT', kind: 'token', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, coingeckoId: 'tether' },
  { chain: 'arbitrum', symbol: 'PYUSD', kind: 'token', address: '0x46850Ad61c2B7d64d08C9c754f45254596696984', decimals: 6, coingeckoId: 'paypal-usd' },
  { chain: 'optimism', symbol: 'ETH', kind: 'native', decimals: 18, coingeckoId: 'ethereum' },
  { chain: 'optimism', symbol: 'USDC', kind: 'token', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6, coingeckoId: 'usd-coin' },
  { chain: 'optimism', symbol: 'USDT', kind: 'token', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6, coingeckoId: 'tether' },
  { chain: 'solana', symbol: 'SOL', kind: 'native', decimals: 9, coingeckoId: 'solana' },
  { chain: 'solana', symbol: 'USDC', kind: 'token', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, coingeckoId: 'usd-coin', tokenProgram: 'spl-token' },
  { chain: 'solana', symbol: 'USDT', kind: 'token', address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, coingeckoId: 'tether', tokenProgram: 'spl-token' },
  { chain: 'solana', symbol: 'PYUSD', kind: 'token', address: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', decimals: 6, coingeckoId: 'paypal-usd', tokenProgram: 'token-2022' },
];

export function nativeAsset(chain: Chain): AssetDef {
  const native = ASSETS.find((asset) => asset.chain === chain && asset.kind === 'native');
  if (native === undefined) {
    throw new Error(`no native asset registered for chain: ${chain}`);
  }
  return native;
}

export function tokensForChain(chain: Chain): AssetDef[] {
  return ASSETS.filter((asset) => asset.chain === chain && asset.kind === 'token');
}

export function assetBySymbol(chain: Chain, symbol: AssetSymbol): AssetDef | undefined {
  return ASSETS.find((asset) => asset.chain === chain && asset.symbol === symbol);
}

export function allCoingeckoIds(): string[] {
  return [...new Set(ASSETS.map((asset) => asset.coingeckoId))];
}

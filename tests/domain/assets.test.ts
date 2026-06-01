import { describe, expect, it } from 'vitest';
import {
  ASSETS,
  allCoingeckoIds,
  assetBySymbol,
  nativeAsset,
  tokensForChain,
} from '../../src/domain/assets.js';

describe('verified asset registry', () => {
  it('contains solana PYUSD as a token-2022 asset', () => {
    const pyusd = ASSETS.find(
      (asset) => asset.chain === 'solana' && asset.symbol === 'PYUSD',
    );
    expect(pyusd).toBeDefined();
    expect(pyusd!.address).toBe('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo');
    expect(pyusd!.decimals).toBe(6);
    expect(pyusd!.kind).toBe('token');
    expect(pyusd!.tokenProgram).toBe('token-2022');
    expect(pyusd!.coingeckoId).toBe('paypal-usd');
  });

  it('contains ethereum USDC with the canonical address and 6 decimals', () => {
    const usdc = ASSETS.find(
      (asset) => asset.chain === 'ethereum' && asset.symbol === 'USDC',
    );
    expect(usdc).toBeDefined();
    expect(usdc!.address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(usdc!.decimals).toBe(6);
    expect(usdc!.kind).toBe('token');
    expect(usdc!.coingeckoId).toBe('usd-coin');
  });

  it('resolves native assets per chain', () => {
    expect(nativeAsset('bitcoin').decimals).toBe(8);
    expect(nativeAsset('bitcoin').symbol).toBe('BTC');
    expect(nativeAsset('polygon').symbol).toBe('POL');
    expect(nativeAsset('polygon').coingeckoId).toBe('matic-network');
    expect(nativeAsset('solana').decimals).toBe(9);
  });

  it('lists tokens per chain (base has USDC only)', () => {
    const baseTokens = tokensForChain('base');
    expect(baseTokens.length).toBe(1);
    expect(baseTokens[0].symbol).toBe('USDC');
  });

  it('registers bridged USDC.e separately from native USDC on arbitrum', () => {
    const native = assetBySymbol('arbitrum', 'USDC');
    const bridged = assetBySymbol('arbitrum', 'USDC.e');
    expect(native?.address).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
    expect(bridged?.address).toBe('0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8');
    expect(native?.address).not.toBe(bridged?.address);
  });

  it('registers optimism USDT0 distinct from USDT', () => {
    const usdt = assetBySymbol('optimism', 'USDT');
    const usdt0 = assetBySymbol('optimism', 'USDT0');
    expect(usdt?.address).toBe('0x94b008aA00579c1307B0EF2c499aD98a8ce58e58');
    expect(usdt0?.address).toBe('0x01bFF41798a0BcF287b996046Ca68b395DbC1071');
  });

  it('resolves an asset by chain + symbol', () => {
    const usdt = assetBySymbol('arbitrum', 'USDT');
    expect(usdt).toBeDefined();
    expect(usdt!.address).toBe('0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9');
    expect(usdt!.decimals).toBe(6);
    expect(assetBySymbol('base', 'USDT')).toBeUndefined();
  });

  it('returns de-duplicated coingecko ids including paypal-usd', () => {
    const ids = allCoingeckoIds();
    expect(ids).toContain('paypal-usd');
    expect(ids).toContain('usd-coin');
    expect(ids).toContain('matic-network');
    expect(new Set(ids).size).toBe(ids.length);
  });
});

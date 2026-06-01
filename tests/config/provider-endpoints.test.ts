import { afterEach, describe, expect, it } from 'vitest';
import {
  loadProviderEndpoints,
  resolveSolanaRpcUrl,
} from '../../src/config/provider-endpoints.js';

describe('loadProviderEndpoints', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('returns empty when no override env vars are set', () => {
    delete process.env.MEMPOOL_API_BASE;
    delete process.env.SOLANA_RPC_URL;
    delete process.env.EVM_RPC_ETHEREUM;
    delete process.env.EVM_RPC_BASE;
    delete process.env.EVM_RPC_POLYGON;
    delete process.env.EVM_RPC_ARBITRUM;
    delete process.env.EVM_RPC_OPTIMISM;

    expect(loadProviderEndpoints()).toEqual({});
  });

  it('reads mempool, solana, and per-chain EVM overrides', () => {
    process.env.MEMPOOL_API_BASE = 'https://mempool.private.example/api';
    process.env.SOLANA_RPC_URL = 'https://solana.private.example';
    process.env.EVM_RPC_ETHEREUM = 'https://eth.private.example';
    process.env.EVM_RPC_ARBITRUM = 'https://arb.private.example';

    expect(loadProviderEndpoints()).toEqual({
      mempoolApiBase: 'https://mempool.private.example/api',
      solanaRpcUrl: 'https://solana.private.example',
      evmRpcUrls: {
        ethereum: 'https://eth.private.example',
        arbitrum: 'https://arb.private.example',
      },
    });
  });

  it('treats empty env values as unset', () => {
    process.env.MEMPOOL_API_BASE = '';
    process.env.SOLANA_RPC_URL = '';

    expect(loadProviderEndpoints()).toEqual({});
  });
});

describe('resolveSolanaRpcUrl', () => {
  it('prefers explicit solana RPC URL over Helius key', () => {
    expect(
      resolveSolanaRpcUrl({ solanaRpcUrl: 'https://solana.private.example' }, 'helius-key'),
    ).toBe('https://solana.private.example');
  });

  it('builds Helius URL when only API key is set', () => {
    expect(resolveSolanaRpcUrl({}, 'helius-key')).toBe(
      'https://mainnet.helius-rpc.com/?api-key=helius-key',
    );
  });

  it('returns undefined when neither override nor key is set', () => {
    expect(resolveSolanaRpcUrl({}, undefined)).toBeUndefined();
  });
});
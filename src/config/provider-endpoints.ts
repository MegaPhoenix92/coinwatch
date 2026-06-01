import type { EvmChain } from '../domain/chains.js';
import type { EvmRpcUrls } from '../providers/viem.js';

const EVM_RPC_ENV: Record<EvmChain, string> = {
  ethereum: 'EVM_RPC_ETHEREUM',
  base: 'EVM_RPC_BASE',
  polygon: 'EVM_RPC_POLYGON',
  arbitrum: 'EVM_RPC_ARBITRUM',
  optimism: 'EVM_RPC_OPTIMISM',
};

function envValue(name: string): string | undefined {
  const value = process.env[name];
  return value === '' ? undefined : value;
}

export interface ProviderEndpoints {
  mempoolApiBase?: string;
  solanaRpcUrl?: string;
  evmRpcUrls?: EvmRpcUrls;
}

export function loadProviderEndpoints(): ProviderEndpoints {
  const mempoolApiBase = envValue('MEMPOOL_API_BASE');
  const solanaRpcUrl = envValue('SOLANA_RPC_URL');

  const evmRpcUrls: EvmRpcUrls = {};
  let hasEvmOverride = false;
  for (const chain of Object.keys(EVM_RPC_ENV) as EvmChain[]) {
    const url = envValue(EVM_RPC_ENV[chain]);
    if (url !== undefined) {
      evmRpcUrls[chain] = url;
      hasEvmOverride = true;
    }
  }

  return {
    ...(mempoolApiBase !== undefined ? { mempoolApiBase } : {}),
    ...(solanaRpcUrl !== undefined ? { solanaRpcUrl } : {}),
    ...(hasEvmOverride ? { evmRpcUrls } : {}),
  };
}

export function resolveSolanaRpcUrl(
  endpoints: ProviderEndpoints,
  heliusApiKey?: string,
): string | undefined {
  if (endpoints.solanaRpcUrl !== undefined) {
    return endpoints.solanaRpcUrl;
  }
  if (heliusApiKey !== undefined) {
    return `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
  }
  return undefined;
}
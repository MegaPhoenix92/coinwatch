import {
  createPublicClient,
  erc20Abi,
  http,
  type Address,
} from 'viem';
import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains';
import type {
  EvmDataProvider,
  EvmRawTransfer,
  EvmTokenBalance,
} from '../adapters/chain-adapter.js';
import type { EvmChain } from '../domain/chains.js';

const VIEM_CHAINS = {
  ethereum: mainnet,
  base,
  polygon,
  arbitrum,
  optimism,
} as const;

export type EvmRpcUrls = Partial<Record<EvmChain, string>>;

function alchemyRpcUrl(chain: EvmChain, apiKey: string): string {
  const network = chain === 'ethereum' ? 'eth-mainnet' : `${chain}-mainnet`;
  return `https://${network}.g.alchemy.com/v2/${apiKey}`;
}

function buildRpcUrls(alchemyApiKey?: string, rpcUrls: EvmRpcUrls = {}): EvmRpcUrls {
  if (alchemyApiKey === undefined || alchemyApiKey.length === 0) {
    return rpcUrls;
  }

  const withAlchemy: EvmRpcUrls = {};
  for (const chain of Object.keys(VIEM_CHAINS) as EvmChain[]) {
    withAlchemy[chain] = rpcUrls[chain] ?? alchemyRpcUrl(chain, alchemyApiKey);
  }
  return withAlchemy;
}

export interface ViemProviderOptions {
  rpcUrls?: EvmRpcUrls;
  alchemyApiKey?: string;
}

interface ViemClient {
  getBalance(args: { address: Address }): Promise<bigint>;
  multicall(args: {
    allowFailure: true;
    contracts: {
      address: Address;
      abi: typeof erc20Abi;
      functionName: 'balanceOf';
      args: readonly [Address];
    }[];
  }): Promise<readonly ({ status: 'success'; result: unknown } | { status: 'failure' })[]>;
}

export class ViemProvider implements EvmDataProvider {
  private readonly clients: Record<EvmChain, ViemClient>;

  constructor(options: ViemProviderOptions = {}) {
    const rpcUrls = buildRpcUrls(options.alchemyApiKey, options.rpcUrls);
    this.clients = {
      ethereum: createPublicClient({
        chain: VIEM_CHAINS.ethereum,
        transport: http(rpcUrls.ethereum),
      }) as ViemClient,
      base: createPublicClient({
        chain: VIEM_CHAINS.base,
        transport: http(rpcUrls.base),
      }) as ViemClient,
      polygon: createPublicClient({
        chain: VIEM_CHAINS.polygon,
        transport: http(rpcUrls.polygon),
      }) as ViemClient,
      arbitrum: createPublicClient({
        chain: VIEM_CHAINS.arbitrum,
        transport: http(rpcUrls.arbitrum),
      }) as ViemClient,
      optimism: createPublicClient({
        chain: VIEM_CHAINS.optimism,
        transport: http(rpcUrls.optimism),
      }) as ViemClient,
    };
  }

  async getNativeBalance(chain: EvmChain, address: string): Promise<bigint> {
    return this.clients[chain].getBalance({ address: address.toLowerCase() as Address });
  }

  async getTokenBalances(
    chain: EvmChain,
    address: string,
    tokenAddresses: string[],
  ): Promise<EvmTokenBalance[]> {
    if (tokenAddresses.length === 0) {
      return [];
    }

    const lowerTokens = tokenAddresses.map((tokenAddress) => tokenAddress.toLowerCase());
    const results = await this.clients[chain].multicall({
      allowFailure: true,
      contracts: lowerTokens.map((tokenAddress) => ({
        address: tokenAddress as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address.toLowerCase() as Address],
      })),
    });

    return lowerTokens.map((tokenAddress, index) => {
      const result = results[index];
      return {
        address: tokenAddress,
        raw: result?.status === 'success' ? (result.result as bigint) : 0n,
      };
    });
  }

  async getTransfers(
    _chain: EvmChain,
    _address: string,
    _limit: number,
  ): Promise<EvmRawTransfer[]> {
    return [];
  }
}

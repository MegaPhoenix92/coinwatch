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
  clients?: Partial<Record<EvmChain, ViemClient>>;
}

interface AlchemyAssetTransfersParams {
  fromBlock: '0x0';
  toBlock: 'latest';
  category: ['external', 'internal', 'erc20'];
  withMetadata: true;
  excludeZeroValue: true;
  order: 'desc';
  maxCount: `0x${string}`;
  fromAddress?: string;
  toAddress?: string;
}

interface AlchemyAssetTransfer {
  uniqueId: string;
  hash: string;
  from: string;
  to: string;
  value: number;
  asset: string | null;
  category: string;
  rawContract: {
    value?: string | null;
    address?: string | null;
    decimal?: string | null;
  };
  metadata: {
    blockTimestamp: string;
  };
}

interface AlchemyAssetTransfersResponse {
  transfers: AlchemyAssetTransfer[];
}

export interface ViemClient {
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
  request(args: {
    method: 'alchemy_getAssetTransfers';
    params: [AlchemyAssetTransfersParams];
  }): Promise<AlchemyAssetTransfersResponse>;
}

export class ViemProvider implements EvmDataProvider {
  private readonly clients: Record<EvmChain, ViemClient>;
  private readonly hasAlchemy: boolean;

  constructor(options: ViemProviderOptions = {}) {
    const rpcUrls = buildRpcUrls(options.alchemyApiKey, options.rpcUrls);
    this.hasAlchemy = options.alchemyApiKey !== undefined && options.alchemyApiKey.length > 0;
    this.clients = {
      ethereum: options.clients?.ethereum ?? createPublicClient({
        chain: VIEM_CHAINS.ethereum,
        transport: http(rpcUrls.ethereum),
      }) as ViemClient,
      base: options.clients?.base ?? createPublicClient({
        chain: VIEM_CHAINS.base,
        transport: http(rpcUrls.base),
      }) as ViemClient,
      polygon: options.clients?.polygon ?? createPublicClient({
        chain: VIEM_CHAINS.polygon,
        transport: http(rpcUrls.polygon),
      }) as ViemClient,
      arbitrum: options.clients?.arbitrum ?? createPublicClient({
        chain: VIEM_CHAINS.arbitrum,
        transport: http(rpcUrls.arbitrum),
      }) as ViemClient,
      optimism: options.clients?.optimism ?? createPublicClient({
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
    chain: EvmChain,
    address: string,
    limit: number,
  ): Promise<EvmRawTransfer[]> {
    // Alchemy's transfer index is required for EVM history; plain public RPCs do not expose it.
    if (!this.hasAlchemy) {
      return [];
    }

    const lowerAddress = address.toLowerCase();
    const maxCount = `0x${Math.max(1, limit).toString(16)}` as const;
    const baseParams = {
      fromBlock: '0x0',
      toBlock: 'latest',
      category: ['external', 'internal', 'erc20'],
      withMetadata: true,
      excludeZeroValue: true,
      order: 'desc',
      maxCount,
    } satisfies Omit<AlchemyAssetTransfersParams, 'fromAddress' | 'toAddress'>;

    try {
      const [sent, received] = await Promise.all([
        this.clients[chain].request({
          method: 'alchemy_getAssetTransfers',
          params: [{ ...baseParams, fromAddress: lowerAddress }],
        }),
        this.clients[chain].request({
          method: 'alchemy_getAssetTransfers',
          params: [{ ...baseParams, toAddress: lowerAddress }],
        }),
      ]);

      const byUniqueId = new Map<string, EvmRawTransfer>();
      for (const transfer of [...sent.transfers, ...received.transfers]) {
        if (byUniqueId.has(transfer.uniqueId)) {
          continue;
        }
        byUniqueId.set(transfer.uniqueId, {
          txid: transfer.hash,
          from: transfer.from.toLowerCase(),
          to: transfer.to.toLowerCase(),
          rawValue: BigInt(transfer.rawContract.value ?? '0x0'),
          asset: transfer.asset ?? transfer.rawContract.address ?? '',
          timestamp: Math.floor(Date.parse(transfer.metadata.blockTimestamp) / 1000),
        });
      }

      return [...byUniqueId.values()];
    } catch (error) {
      if (isMethodNotFound(error)) {
        return [];
      }
      throw error;
    }
  }
}

function isMethodNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown; shortMessage?: unknown };
  return (
    candidate.code === -32601 ||
    (typeof candidate.message === 'string' && candidate.message.includes('-32601')) ||
    (typeof candidate.message === 'string' && candidate.message.includes('method not found')) ||
    (typeof candidate.shortMessage === 'string' && candidate.shortMessage.includes('method not found'))
  );
}

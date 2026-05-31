export type EvmChain = 'ethereum' | 'base' | 'polygon' | 'arbitrum' | 'optimism';
export type Chain = 'bitcoin' | EvmChain | 'solana';
export type ChainFamily = 'bitcoin' | 'evm' | 'solana';

export const EVM_CHAINS: readonly EvmChain[] = [
  'ethereum',
  'base',
  'polygon',
  'arbitrum',
  'optimism',
];

export function familyOf(chain: Chain): ChainFamily {
  if (chain === 'bitcoin') return 'bitcoin';
  if (chain === 'solana') return 'solana';
  return 'evm';
}

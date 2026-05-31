import { Address, NETWORK } from '@scure/btc-signer';
import { address as solanaAddress } from '@solana/kit';
import { isAddress } from 'viem';
import type { Chain } from '../domain/chains.js';

function isBitcoinTestAddress(to: string): boolean {
  return /^(tb1|bcrt1|[mn2])/i.test(to);
}

export function assertValidRecipient(chain: Chain, to: string): void {
  if (chain === 'bitcoin') {
    try {
      const decoded = Address(NETWORK).decode(to);
      if (decoded === undefined) {
        throw new Error('decoder returned no script');
      }
    } catch (error) {
      if (isBitcoinTestAddress(to)) {
        throw new Error(
          'Invalid bitcoin recipient address: expected a mainnet BTC address; testnet/regtest addresses are not supported.',
        );
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid bitcoin recipient address: ${reason}`);
    }
    return;
  }

  if (chain === 'solana') {
    try {
      solanaAddress(to);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid solana recipient address: ${reason}`);
    }
    return;
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
    throw new Error(
      `Invalid ${chain} recipient address: expected a 0x-prefixed 20-byte hex address.`,
    );
  }
  if (!isAddress(to, { strict: true })) {
    throw new Error(`Invalid ${chain} recipient address: bad EIP-55 checksum.`);
  }
}

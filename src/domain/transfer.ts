import type { AccountDescriptor } from './account.js';
import type { AssetSymbol } from './assets.js';
import type { Chain } from './chains.js';

export type UnsignedArtifactKind = 'btc-psbt' | 'evm-eip1559' | 'solana-message';

/** A user-facing transfer request (amounts are human decimal strings). */
export interface TransferRequest {
  accountId: string;
  to: string;
  asset: AssetSymbol;
  amount: string;
  chain?: Chain; // required only for multi-chain (EVM) accounts
  feeRate?: string; // optional override: BTC sat/vB, EVM gwei (maxFeePerGas)
}

/** Human-readable summary the user verifies on their signing device. */
export interface TransferSummary {
  chain: Chain;
  asset: AssetSymbol;
  from: string;
  to: string;
  amount: string; // human decimal
  rawAmount: string; // base units (string, bigint-safe)
  decimals: number;
  fee: string; // human decimal, in the native fee asset
  rawFee: string; // base units
  feeAsset: AssetSymbol;
  artifactHash: string; // sha256 (hex) of the canonical binary artifact; equals sha256 of the written file
}

export interface UnsignedArtifact {
  kind: UnsignedArtifactKind;
  payload: string; // base64 (PSBT / solana message) OR 0x-hex (EVM)
  summary: TransferSummary;
  verifyNote: string;
}

/** Resolved params handed to an adapter (amount already in base units). */
export interface ChainAdapterTransferParams {
  account: AccountDescriptor;
  chain: Chain;
  to: string;
  asset: AssetSymbol;
  rawAmount: bigint;
  feeRate?: bigint;
}

export const VERIFY_NOTE =
  'Verify the destination address, amount, and fee on your signing device before signing. coinwatch never signs or broadcasts.';

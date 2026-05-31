import type { AccountDescriptor, DerivedAddress } from '../domain/account.js';
import type { ChainFamily, EvmChain } from '../domain/chains.js';
import type { ChainAdapterTransferParams, UnsignedArtifact } from '../domain/transfer.js';
import type { Balance, HistoryOptions, Tx } from '../domain/types.js';

export interface ReceiveAddress {
  address: string;
  derived: boolean;
  path?: string;
  note: string;
}

export interface ChainAdapter {
  readonly family: ChainFamily;
  readonly capabilities: { derivesAddresses: boolean; preparesTransfers: boolean };
  resolveAddresses(account: AccountDescriptor): Promise<DerivedAddress[]>;
  getReceiveAddress(account: AccountDescriptor, index?: number): Promise<ReceiveAddress>;
  getBalances(addresses: DerivedAddress[]): Promise<Balance[]>;
  getHistory(addresses: DerivedAddress[], opts?: HistoryOptions): Promise<Tx[]>;
  buildUnsignedTransfer(params: ChainAdapterTransferParams): Promise<UnsignedArtifact>;
}

export interface MempoolChainStats {
  funded_txo_sum: number;
  spent_txo_sum: number;
  tx_count: number;
}

export interface MempoolAddressResponse {
  address: string;
  chain_stats: MempoolChainStats;
  mempool_stats: MempoolChainStats;
}

export interface MempoolTxVout {
  scriptpubkey_address?: string;
  value: number;
}

export interface MempoolTxVin {
  prevout?: { scriptpubkey_address?: string; value: number };
}

export interface MempoolTx {
  txid: string;
  vin: MempoolTxVin[];
  vout: MempoolTxVout[];
  status: { confirmed: boolean; block_time?: number };
  fee: number;
}

export interface BtcUtxo {
  txid: string;
  vout: number;
  value: number;
}

export interface BtcDataProvider {
  getAddress(address: string): Promise<MempoolAddressResponse>;
  getAddressTxs(address: string): Promise<MempoolTx[]>;
  getUtxos(address: string): Promise<BtcUtxo[]>;
}

export interface EvmTokenBalance {
  address: string;
  raw: bigint;
}

export interface EvmRawTransfer {
  txid: string;
  from: string;
  to: string;
  rawValue: bigint;
  asset: string;
  timestamp?: number;
}

export interface EvmDataProvider {
  getNativeBalance(chain: EvmChain, address: string): Promise<bigint>;
  getTokenBalances(
    chain: EvmChain,
    address: string,
    tokenAddresses: string[],
  ): Promise<EvmTokenBalance[]>;
  getTransfers(chain: EvmChain, address: string, limit: number): Promise<EvmRawTransfer[]>;
}

export interface SolTokenAccount {
  mint: string;
  amount: string;
  decimals: number;
  uiAmountString: string;
}

export interface SolRawTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  amount: string;
  decimals: number;
}

export interface SolRawTx {
  signature: string;
  blockTime?: number;
  err?: unknown;
  fee?: bigint;
  accountKeys?: string[];
  preBalances?: bigint[];
  postBalances?: bigint[];
  preTokenBalances?: SolRawTokenBalance[];
  postTokenBalances?: SolRawTokenBalance[];
}

export interface SolDataProvider {
  getLamports(address: string): Promise<bigint>;
  getTokenAccounts(address: string, programId: string): Promise<SolTokenAccount[]>;
  getSignatures(address: string, limit: number): Promise<SolRawTx[]>;
  getTransaction(signature: string): Promise<SolRawTx | undefined>;
}

export interface PriceProvider {
  getUsdPrices(coingeckoIds: string[]): Promise<Map<string, number>>;
}

import { describe, expect, it } from 'vitest';
import type {
  BtcDataProvider,
  ChainAdapter,
  EvmDataProvider,
  PriceProvider,
  ReceiveAddress,
  SolDataProvider,
} from '../../src/adapters/chain-adapter.js';
import type { AccountDescriptor, DerivedAddress } from '../../src/domain/account.js';
import type { Balance, Tx } from '../../src/domain/types.js';

describe('ChainAdapter contract', () => {
  it('a trivial stub satisfies the ChainAdapter type and reports no derivation', async () => {
    const stub: ChainAdapter = {
      family: 'bitcoin',
      capabilities: { derivesAddresses: false, preparesTransfers: false },
      async resolveAddresses(_account: AccountDescriptor): Promise<DerivedAddress[]> {
        return [];
      },
      async getReceiveAddress(
        _account: AccountDescriptor,
        _index?: number,
      ): Promise<ReceiveAddress> {
        return {
          address: 'stub',
          derived: false,
          note: 'stub - verify on your signing device before use',
        };
      },
      async getBalances(_addresses: DerivedAddress[]): Promise<Balance[]> {
        return [];
      },
      async getHistory(_addresses: DerivedAddress[]): Promise<Tx[]> {
        return [];
      },
      async buildUnsignedTransfer() {
        throw new Error('buildUnsignedTransfer not implemented for this chain yet');
      },
    };

    expect(stub.capabilities.derivesAddresses).toBe(false);
    expect(stub.capabilities.preparesTransfers).toBe(false);
    expect(stub.family).toBe('bitcoin');
    await expect(stub.resolveAddresses({} as AccountDescriptor)).resolves.toEqual([]);
    const recv = await stub.getReceiveAddress({} as AccountDescriptor);
    expect(recv.note).toContain('verify on your signing device before use');
  });

  it('the data-provider interfaces are implementable as stubs', async () => {
    const btc: BtcDataProvider = {
      async getAddress(address: string) {
        return {
          address,
          chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
        };
      },
      async getAddressTxs(_address: string) {
        return [];
      },
      async getUtxos(_address: string) {
        return [];
      },
    };
    const evm: EvmDataProvider = {
      async getNativeBalance(_chain, _address) {
        return 0n;
      },
      async getTokenBalances(_chain, _address, _tokenAddresses) {
        return [];
      },
      async getTransfers(_chain, _address, _limit) {
        return [];
      },
      async getTransactionCount(_chain, _address) {
        return 0;
      },
      async estimateGas(_chain, _req) {
        return 21_000n;
      },
      async getFeesPerGas(_chain) {
        return { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
      },
      getChainId(_chain) {
        return 1;
      },
    };
    const sol: SolDataProvider = {
      async getLamports(_address) {
        return 0n;
      },
      async getTokenAccounts(_address, _programId) {
        return [];
      },
      async getSignatures(_address, _limit) {
        return [];
      },
      async getTransaction(_signature) {
        return undefined;
      },
      async getLatestBlockhash() {
        return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 123n };
      },
      async getAccountExists(_address) {
        return true;
      },
      async getMinimumBalanceForRentExemption(_space) {
        return 890_880n;
      },
    };
    const prices: PriceProvider = {
      async getUsdPrices(_coingeckoIds) {
        return new Map<string, number>();
      },
    };

    await expect(btc.getAddress('addr')).resolves.toMatchObject({ address: 'addr' });
    await expect(evm.getNativeBalance('ethereum', 'addr')).resolves.toBe(0n);
    await expect(sol.getLamports('addr')).resolves.toBe(0n);
    await expect(prices.getUsdPrices(['bitcoin'])).resolves.toBeInstanceOf(Map);
  });
});

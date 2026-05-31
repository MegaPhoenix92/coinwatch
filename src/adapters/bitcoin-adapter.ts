import { deriveAddresses } from '../core/btc-derive.js';
import type { AccountDescriptor, DerivedAddress } from '../domain/account.js';
import type { Balance, HistoryOptions, Tx } from '../domain/types.js';
import type {
  BtcDataProvider,
  ChainAdapter,
  MempoolTx,
  ReceiveAddress,
} from './chain-adapter.js';

const RECEIVE_NOTE_DERIVED =
  'Receive address derived from your xpub - verify it on your signing device before use.';
const RECEIVE_NOTE_LITERAL =
  'This is your supplied address - verify on your signing device before use.';
const DEFAULT_GAP_LIMIT = 20;

function receivedByAddress(tx: MempoolTx, address: string): bigint {
  return tx.vout.reduce((sum, vout) => {
    if (vout.scriptpubkey_address !== address) return sum;
    return sum + BigInt(vout.value);
  }, 0n);
}

function sentByAddress(tx: MempoolTx, address: string): bigint {
  return tx.vin.reduce((sum, vin) => {
    if (vin.prevout?.scriptpubkey_address !== address) return sum;
    return sum + BigInt(vin.prevout.value);
  }, 0n);
}

function txForAddress(tx: MempoolTx, address: string): Tx | undefined {
  const received = receivedByAddress(tx, address);
  const sent = sentByAddress(tx, address);
  const net = received - sent;

  let direction: Tx['direction'];
  if (sent > 0n && received > 0n) {
    direction = 'self';
  } else if (net > 0n) {
    direction = 'in';
  } else if (net < 0n) {
    direction = 'out';
  } else {
    direction = 'unknown';
  }

  if (direction === 'unknown' && sent === 0n && received === 0n) {
    return undefined;
  }

  return {
    chain: 'bitcoin',
    txid: tx.txid,
    timestamp: tx.status.block_time,
    direction,
    symbol: 'BTC',
    raw: net < 0n ? -net : net,
    decimals: 8,
    confirmed: tx.status.confirmed,
  };
}

export class BitcoinAdapter implements ChainAdapter {
  readonly family = 'bitcoin' as const;
  readonly capabilities = { derivesAddresses: true } as const;

  constructor(private readonly provider: BtcDataProvider) {}

  async resolveAddresses(account: AccountDescriptor): Promise<DerivedAddress[]> {
    const source = account.source;
    if (source.kind === 'xpub') {
      const derived = deriveAddresses(
        source.xpub,
        source.scriptType,
        source.gapLimit ?? DEFAULT_GAP_LIMIT,
        0,
      );
      return derived.map((address) => ({
        address: address.address,
        chain: 'bitcoin',
        path: address.path,
        derived: true,
      }));
    }

    return source.addresses.map((address) => ({
      address,
      chain: 'bitcoin',
      derived: false,
    }));
  }

  async getReceiveAddress(account: AccountDescriptor, index = 0): Promise<ReceiveAddress> {
    const source = account.source;
    if (source.kind === 'xpub') {
      const [address] = deriveAddresses(source.xpub, source.scriptType, index + 1, 0).slice(index);
      if (address === undefined) {
        throw new Error(`Unable to derive bitcoin receive address at index ${index}`);
      }
      return {
        address: address.address,
        derived: true,
        path: address.path,
        note: RECEIVE_NOTE_DERIVED,
      };
    }

    const address = source.addresses[index] ?? source.addresses[0];
    if (address === undefined) {
      throw new Error('Bitcoin account has no literal address');
    }
    return {
      address,
      derived: false,
      note: RECEIVE_NOTE_LITERAL,
    };
  }

  async getBalances(addresses: DerivedAddress[]): Promise<Balance[]> {
    const balances: Balance[] = [];
    for (const { address } of addresses) {
      const resp = await this.provider.getAddress(address);
      const raw =
        BigInt(resp.chain_stats.funded_txo_sum) - BigInt(resp.chain_stats.spent_txo_sum);
      balances.push({
        chain: 'bitcoin',
        address,
        symbol: 'BTC',
        raw,
        decimals: 8,
      });
    }
    return balances;
  }

  async getHistory(addresses: DerivedAddress[], opts?: HistoryOptions): Promise<Tx[]> {
    const limit = opts?.limit ?? Number.POSITIVE_INFINITY;
    const history: Tx[] = [];

    for (const { address } of addresses) {
      if (history.length >= limit) break;
      const txs = await this.provider.getAddressTxs(address);
      for (const tx of txs) {
        if (history.length >= limit) break;
        const mapped = txForAddress(tx, address);
        if (mapped !== undefined) {
          history.push(mapped);
        }
      }
    }

    return history;
  }
}

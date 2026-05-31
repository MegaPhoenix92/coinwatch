import { deriveAddresses } from '../core/btc-derive.js';
import type { AccountDescriptor, DerivedAddress } from '../domain/account.js';
import type { Balance, HistoryOptions, Tx } from '../domain/types.js';
import type {
  BtcDataProvider,
  ChainAdapter,
  MempoolAddressResponse,
  MempoolTx,
  ReceiveAddress,
} from './chain-adapter.js';

const RECEIVE_NOTE_DERIVED =
  'Receive address derived from your xpub - verify it on your signing device before use.';
const RECEIVE_NOTE_LITERAL =
  'This is your supplied address - verify on your signing device before use.';
const DEFAULT_GAP_LIMIT = 20;

export interface BitcoinBalancePending {
  pendingRaw: bigint;
}

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

function confirmedRaw(resp: MempoolAddressResponse): bigint {
  return BigInt(resp.chain_stats.funded_txo_sum) - BigInt(resp.chain_stats.spent_txo_sum);
}

function pendingRaw(resp: MempoolAddressResponse): bigint {
  return BigInt(resp.mempool_stats.funded_txo_sum) - BigInt(resp.mempool_stats.spent_txo_sum);
}

function firstExternalInput(tx: MempoolTx, watched: Set<string>): string | undefined {
  return tx.vin.find((vin) => {
    const address = vin.prevout?.scriptpubkey_address;
    return address !== undefined && !watched.has(address);
  })?.prevout?.scriptpubkey_address;
}

function firstExternalOutput(tx: MempoolTx, watched: Set<string>): string | undefined {
  return tx.vout.find((vout) => {
    const address = vout.scriptpubkey_address;
    return address !== undefined && !watched.has(address);
  })?.scriptpubkey_address;
}

function txForWatchedSet(tx: MempoolTx, watched: Set<string>): Tx | undefined {
  let received = 0n;
  let sent = 0n;

  for (const address of watched) {
    received += receivedByAddress(tx, address);
    sent += sentByAddress(tx, address);
  }

  const net = received - sent;

  let direction: Tx['direction'];
  let counterparty: string | undefined;
  if (net > 0n) {
    direction = 'in';
    counterparty = firstExternalInput(tx, watched);
  } else if (net < 0n) {
    counterparty = firstExternalOutput(tx, watched);
    direction = counterparty === undefined && sent > 0n && received > 0n ? 'self' : 'out';
  } else if (sent > 0n || received > 0n) {
    direction = 'self';
  } else {
    direction = 'unknown';
  }

  if (direction === 'unknown') {
    return undefined;
  }

  const mapped: Tx = {
    chain: 'bitcoin',
    txid: tx.txid,
    timestamp: tx.status.block_time,
    direction,
    symbol: 'BTC',
    raw: net < 0n ? -net : net,
    decimals: 8,
    confirmed: tx.status.confirmed,
  };
  if (counterparty !== undefined) {
    mapped.counterparty = counterparty;
  }
  return mapped;
}

export class BitcoinAdapter implements ChainAdapter {
  readonly family = 'bitcoin' as const;
  readonly capabilities = { derivesAddresses: true } as const;

  constructor(private readonly provider: BtcDataProvider) {}

  async resolveAddresses(account: AccountDescriptor): Promise<DerivedAddress[]> {
    const source = account.source;
    if (source.kind === 'xpub') {
      const receive = deriveAddresses(
        source.xpub,
        source.scriptType,
        source.gapLimit ?? DEFAULT_GAP_LIMIT,
        0,
      );
      const change = deriveAddresses(
        source.xpub,
        source.scriptType,
        source.gapLimit ?? DEFAULT_GAP_LIMIT,
        1,
      );
      const derived = [...receive, ...change];
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
      const balance: Balance & BitcoinBalancePending = {
        chain: 'bitcoin',
        address,
        symbol: 'BTC',
        raw: confirmedRaw(resp),
        decimals: 8,
        pendingRaw: pendingRaw(resp),
      };
      balances.push(balance);
    }
    return balances;
  }

  async getHistory(addresses: DerivedAddress[], opts?: HistoryOptions): Promise<Tx[]> {
    const watched = new Set(addresses.map(({ address }) => address));
    const txsById = new Map<string, MempoolTx>();

    for (const { address } of addresses) {
      const txs = await this.provider.getAddressTxs(address);
      for (const tx of txs) {
        txsById.set(tx.txid, tx);
      }
    }

    const history = [...txsById.values()]
      .map((tx) => txForWatchedSet(tx, watched))
      .filter((tx): tx is Tx => tx !== undefined)
      .sort((a, b) => {
        // Unconfirmed txs (no block_time) are the newest — sort them to the top.
        const ta = a.timestamp ?? Number.POSITIVE_INFINITY;
        const tb = b.timestamp ?? Number.POSITIVE_INFINITY;
        return ta === tb ? 0 : tb - ta;
      });

    const limit = opts?.limit;
    return typeof limit === 'number' ? history.slice(0, limit) : history;
  }
}

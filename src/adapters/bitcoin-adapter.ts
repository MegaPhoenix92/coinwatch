import { sha256 } from '@noble/hashes/sha2.js';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { DEFAULT_MAX_GAP_SCAN_INDEX, scanGapBranch } from '../core/btc-gap-scan.js';
import { deriveAddresses } from '../core/btc-derive.js';
import { inferSelfTransferLeg } from '../core/self-transfer.js';
import { formatUnits } from '../core/money.js';
import { assertSendable } from '../core/preflight.js';
import type { AccountDescriptor, DerivedAddress } from '../domain/account.js';
import {
  VERIFY_NOTE,
  type ChainAdapterTransferParams,
  type UnsignedArtifact,
} from '../domain/transfer.js';
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
  if (direction === 'self') {
    const leg = inferSelfTransferLeg({
      watchedIncoming: received,
      watchedOutgoing: sent,
      net,
    });
    if (leg !== undefined) {
      mapped.selfTransferLeg = leg;
    }
  }
  return mapped;
}

export class BitcoinAdapter implements ChainAdapter {
  readonly family = 'bitcoin' as const;
  readonly capabilities = { derivesAddresses: true, preparesTransfers: true } as const;

  constructor(private readonly provider: BtcDataProvider) {}

  async resolveAddresses(account: AccountDescriptor): Promise<DerivedAddress[]> {
    const source = account.source;
    if (source.kind === 'xpub') {
      const gapLimit = source.gapLimit ?? DEFAULT_GAP_LIMIT;
      const maxIndex = source.maxGapScan ?? DEFAULT_MAX_GAP_SCAN_INDEX;
      const receive = await scanGapBranch(
        this.provider,
        source.xpub,
        source.scriptType,
        gapLimit,
        0,
        maxIndex,
      );
      const change = await scanGapBranch(
        this.provider,
        source.xpub,
        source.scriptType,
        gapLimit,
        1,
        maxIndex,
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

  async buildUnsignedTransfer(params: ChainAdapterTransferParams): Promise<UnsignedArtifact> {
    if (params.chain !== 'bitcoin') {
      throw new Error(`BitcoinAdapter cannot prepare transfers for ${params.chain}.`);
    }
    if (params.asset !== 'BTC') {
      throw new Error('Bitcoin transfers support only native BTC in Phase 2.');
    }
    assertSendable({ chain: 'bitcoin', asset: 'BTC', to: params.to, rawAmount: params.rawAmount });

    const addresses = await this.resolveAddresses(params.account);
    const watched = addresses.map((address) => address.address);
    const changeAddress = watched[0];
    if (changeAddress === undefined) {
      throw new Error('No watched bitcoin address to receive change.');
    }

    const utxos: {
      txid: Uint8Array;
      index: number;
      witnessUtxo: { script: Uint8Array; amount: bigint };
    }[] = [];
    for (const address of watched) {
      const script = btc.Address().decode(address);
      if (script === undefined) {
        throw new Error(`Unable to decode bitcoin address: ${address}`);
      }
      // Inputs are built with witnessUtxo only, which is valid for native
      // SegWit (P2WPKH) — the only address type coinwatch derives. Legacy
      // (P2PKH) / wrapped-SegWit (P2SH) inputs need nonWitnessUtxo/redeemScript
      // and would otherwise produce an unsignable PSBT; reject them with a
      // clear message instead of a cryptic @scure failure deeper in selectUTXO.
      if (script.type !== 'wpkh') {
        throw new Error(
          `Phase-2 BTC transfers support only native-SegWit (bc1q / P2WPKH) watch addresses; got "${script.type}" for ${address}.`,
        );
      }
      const outScript = btc.OutScript.encode(script);
      for (const utxo of await this.provider.getUtxos(address)) {
        utxos.push({
          txid: hex.decode(utxo.txid),
          index: utxo.vout,
          witnessUtxo: { script: outScript, amount: BigInt(utxo.value) },
        });
      }
    }
    if (utxos.length === 0) {
      throw new Error('No spendable UTXOs for this bitcoin account.');
    }

    const outputs = [{ address: params.to, amount: params.rawAmount }];
    const feePerByte = params.feeRate ?? 2n;
    const selected = btc.selectUTXO(utxos, outputs, 'default', {
      changeAddress,
      feePerByte,
      bip69: true,
      createTx: true,
    });
    if (selected === undefined) {
      throw new Error('Insufficient funds (incl. fee) for this bitcoin transfer.');
    }
    const tx = selected.tx;
    const fee = selected.fee;
    if (tx === undefined || fee === undefined) {
      throw new Error('Failed to build the bitcoin transaction.');
    }
    const psbt = tx.toPSBT();

    return {
      kind: 'btc-psbt',
      payload: base64.encode(psbt),
      summary: {
        chain: 'bitcoin',
        asset: 'BTC',
        from: changeAddress,
        to: params.to,
        amount: formatUnits(params.rawAmount, 8),
        rawAmount: params.rawAmount.toString(),
        decimals: 8,
        fee: formatUnits(fee, 8),
        rawFee: fee.toString(),
        feeAsset: 'BTC',
        artifactHash: hex.encode(sha256(psbt)),
      },
      verifyNote: VERIFY_NOTE,
    };
  }
}

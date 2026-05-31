import { HDKey } from '@scure/bip32';
import { createBase58check } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha2.js';
import type { BtcScriptType } from '../domain/account.js';

const b58 = createBase58check(sha256);
const XPUB_VERSION = Uint8Array.from([0x04, 0x88, 0xb2, 0x1e]);

export function normalizeToXpub(ext: string): string {
  const data = b58.decode(ext);
  if (
    data[0] === XPUB_VERSION[0] &&
    data[1] === XPUB_VERSION[1] &&
    data[2] === XPUB_VERSION[2] &&
    data[3] === XPUB_VERSION[3]
  ) {
    return ext;
  }

  const swapped = Uint8Array.from(data);
  swapped.set(XPUB_VERSION, 0);
  return b58.encode(swapped);
}

function purposeFor(scriptType: BtcScriptType): string {
  switch (scriptType) {
    case 'p2wpkh':
      return "84'";
    case 'p2sh-p2wpkh':
      return "49'";
    case 'p2pkh':
      return "44'";
  }
}

function addressFor(scriptType: BtcScriptType, pubkey: Uint8Array): string {
  switch (scriptType) {
    case 'p2wpkh':
      return btc.p2wpkh(pubkey).address!;
    case 'p2sh-p2wpkh':
      return btc.p2sh(btc.p2wpkh(pubkey)).address!;
    case 'p2pkh':
      return btc.p2pkh(pubkey).address!;
  }
}

export function deriveAddresses(
  accountXpub: string,
  scriptType: BtcScriptType,
  count: number,
  change: 0 | 1 = 0,
): { address: string; path: string }[] {
  const acct = HDKey.fromExtendedKey(normalizeToXpub(accountXpub));
  const branch = acct.deriveChild(change);
  const purpose = purposeFor(scriptType);
  const out: { address: string; path: string }[] = [];

  for (let i = 0; i < count; i += 1) {
    const child = branch.deriveChild(i);
    const pubkey = child.publicKey;
    if (pubkey === null) {
      throw new Error(`No public key at ${purpose} change=${change} index=${i}`);
    }

    out.push({
      address: addressFor(scriptType, pubkey),
      path: `m/${purpose}/0'/0'/${change}/${i}`,
    });
  }

  return out;
}

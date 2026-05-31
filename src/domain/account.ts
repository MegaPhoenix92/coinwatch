import type { Chain, ChainFamily } from './chains.js';

export type BtcScriptType = 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh';

export type AccountSource =
  | { kind: 'xpub'; xpub: string; scriptType: BtcScriptType; gapLimit?: number }
  | { kind: 'addresses'; addresses: string[] };

export interface AccountDescriptor {
  id: string;
  label: string;
  family: ChainFamily;
  chains: Chain[];
  source: AccountSource;
}

export interface DerivedAddress {
  address: string;
  chain: Chain;
  path?: string;
  derived: boolean;
}

import { describe, expect, it } from 'vitest';
import { deriveAddresses, normalizeToXpub } from '../../src/core/btc-derive.js';

const ACCOUNT_ZPUB =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

describe('deriveAddresses (BIP84 p2wpkh)', () => {
  it('derives the first two receive addresses from the official BIP84 vector', () => {
    const result = deriveAddresses(ACCOUNT_ZPUB, 'p2wpkh', 2);
    expect(result).toEqual([
      { address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', path: "m/84'/0'/0'/0/0" },
      { address: 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', path: "m/84'/0'/0'/0/1" },
    ]);
  });

  it('derives a change address (change=1) at the expected path', () => {
    const result = deriveAddresses(ACCOUNT_ZPUB, 'p2wpkh', 1, 1);
    expect(result[0].path).toBe("m/84'/0'/0'/1/0");
    expect(result[0].address).toMatch(/^bc1q[0-9a-z]{38,}$/);
  });
});

describe('normalizeToXpub', () => {
  it('re-encodes a zpub into an xpub (0x0488b21e version prefix)', () => {
    const xpub = normalizeToXpub(ACCOUNT_ZPUB);
    expect(xpub.startsWith('xpub')).toBe(true);
  });

  it('returns an xpub unchanged', () => {
    const xpub = normalizeToXpub(ACCOUNT_ZPUB);
    expect(normalizeToXpub(xpub)).toBe(xpub);
  });
});

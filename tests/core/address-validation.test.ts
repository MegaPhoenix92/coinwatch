import * as btc from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { assertValidRecipient } from '../../src/core/address-validation.js';

const BTC_MAINNET = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const EVM_CHECKSUM = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const EVM_BAD_CHECKSUM = '0x70997970C51812dc3A010C7d01b50e0d17dc79c8';
const SOLANA_ADDRESS = '11111111111111111111111111111112';
const TEST_PUBLIC_KEY = secp256k1.getPublicKey(
  Uint8Array.from({ length: 32 }, (_, i) => i + 1),
  true,
);
const BTC_TESTNET = btc.p2wpkh(TEST_PUBLIC_KEY, btc.TEST_NETWORK).address;
// Mainnet recipient variants the validator must accept (derived, not hardcoded).
const BTC_P2PKH = btc.p2pkh(TEST_PUBLIC_KEY, btc.NETWORK).address; // 1...
const BTC_P2SH = btc.p2sh(btc.p2wpkh(TEST_PUBLIC_KEY, btc.NETWORK), btc.NETWORK).address; // 3...
const BTC_P2TR = btc.p2tr(TEST_PUBLIC_KEY.slice(1), undefined, btc.NETWORK).address; // bc1p...
const EVM_LOWERCASE = EVM_CHECKSUM.toLowerCase();

describe('assertValidRecipient', () => {
  it('accepts valid recipients for each supported chain family', () => {
    expect(() => assertValidRecipient('bitcoin', BTC_MAINNET)).not.toThrow();
    expect(() => assertValidRecipient('ethereum', EVM_CHECKSUM)).not.toThrow();
    expect(() => assertValidRecipient('base', EVM_CHECKSUM)).not.toThrow();
    expect(() => assertValidRecipient('solana', SOLANA_ADDRESS)).not.toThrow();
  });

  it('accepts all standard mainnet BTC script types (P2PKH, P2SH, bech32, taproot)', () => {
    expect(BTC_P2PKH.startsWith('1')).toBe(true);
    expect(BTC_P2SH.startsWith('3')).toBe(true);
    expect(BTC_P2TR.startsWith('bc1p')).toBe(true);
    for (const addr of [BTC_P2PKH, BTC_P2SH, BTC_MAINNET, BTC_P2TR]) {
      expect(() => assertValidRecipient('bitcoin', addr)).not.toThrow();
    }
  });

  it('accepts an all-lowercase EVM address (valid under viem strict mode)', () => {
    expect(EVM_LOWERCASE).toBe(EVM_LOWERCASE.toLowerCase());
    expect(() => assertValidRecipient('ethereum', EVM_LOWERCASE)).not.toThrow();
  });

  it('rejects bitcoin testnet/regtest and malformed recipients with specific messages', () => {
    expect(BTC_TESTNET).toBeDefined();
    expect(() => assertValidRecipient('bitcoin', BTC_TESTNET ?? '')).toThrow(
      /Invalid bitcoin recipient address: expected a mainnet BTC address/,
    );
    expect(() => assertValidRecipient('bitcoin', 'not-a-bitcoin-address')).toThrow(
      /Invalid bitcoin recipient address:/,
    );
  });

  it('rejects EVM checksum and non-hex recipients with specific messages', () => {
    expect(() => assertValidRecipient('ethereum', EVM_BAD_CHECKSUM)).toThrow(
      /Invalid ethereum recipient address: bad EIP-55 checksum/,
    );
    expect(() =>
      assertValidRecipient('ethereum', '0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'),
    ).toThrow(/Invalid ethereum recipient address: expected a 0x-prefixed 20-byte hex address/);
  });

  it('rejects malformed Solana recipients with a specific message', () => {
    expect(() => assertValidRecipient('solana', 'bad sol')).toThrow(
      /Invalid solana recipient address:/,
    );
  });
});

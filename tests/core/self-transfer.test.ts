import { describe, expect, it } from 'vitest';
import { inferSelfTransferLeg } from '../../src/core/self-transfer.js';

describe('inferSelfTransferLeg', () => {
  it('prefers outgoing flow as the source leg', () => {
    expect(
      inferSelfTransferLeg({
        watchedIncoming: 1n,
        watchedOutgoing: 2n,
        net: 0n,
      }),
    ).toBe('out');
  });

  it('prefers incoming flow as the destination leg', () => {
    expect(
      inferSelfTransferLeg({
        watchedIncoming: 3n,
        watchedOutgoing: 1n,
        net: 0n,
      }),
    ).toBe('in');
  });
});
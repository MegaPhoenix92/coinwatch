export type SelfTransferLeg = 'out' | 'in';

/** Infer source (out) vs destination (in) for a watch-account self-transfer row. */
export function inferSelfTransferLeg(params: {
  watchedIncoming: bigint;
  watchedOutgoing: bigint;
  net: bigint;
}): SelfTransferLeg | undefined {
  if (params.watchedOutgoing > params.watchedIncoming) {
    return 'out';
  }
  if (params.watchedIncoming > params.watchedOutgoing) {
    return 'in';
  }
  if (params.net < 0n) {
    return 'out';
  }
  if (params.net > 0n) {
    return 'in';
  }
  return undefined;
}
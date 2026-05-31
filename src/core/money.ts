export function formatUnits(raw: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }

  const negative = raw < 0n;
  const abs = negative ? -raw : raw;

  if (decimals === 0) {
    return `${negative ? '-' : ''}${abs.toString()}`;
  }

  const base = 10n ** BigInt(decimals);
  const intPart = abs / base;
  const fracPart = abs % base;

  let out: string;
  if (fracPart === 0n) {
    out = intPart.toString();
  } else {
    const fracStr = fracPart.toString().padStart(decimals, '0').replace(/0+$/, '');
    out = `${intPart.toString()}.${fracStr}`;
  }

  return negative ? `-${out}` : out;
}

export function toNumberAmount(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}

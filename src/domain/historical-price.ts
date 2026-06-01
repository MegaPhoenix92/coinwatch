export type UtcDateString = string & { readonly __brand: 'UtcDateString' };

export type HistoricalPriceSource = 'coingecko' | 'manual';

export interface HistoricalUsdPrice {
  usd: number;
  source: HistoricalPriceSource;
  date: UtcDateString;
}

export class HistoricalPriceCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoricalPriceCapabilityError';
  }
}

export function assertUtcDateString(value: string): UtcDateString {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid UTC date "${value}": expected YYYY-MM-DD.`);
  }

  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid UTC date "${value}": date is not a real calendar day.`);
  }

  return value as UtcDateString;
}

export function toUtcDateString(epochMsOrDate: number | Date): UtcDateString {
  const date =
    epochMsOrDate instanceof Date ? new Date(epochMsOrDate.getTime()) : new Date(epochMsOrDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid UTC date input.');
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return assertUtcDateString(`${year}-${month}-${day}`);
}

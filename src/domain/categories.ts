import { z } from 'zod';

export const TX_CATEGORIES = ['transfer', 'fee', 'swap', 'income', 'unknown'] as const;
export type TxCategory = (typeof TX_CATEGORIES)[number];

export const TX_CATEGORY_SOURCES = ['heuristic', 'manual'] as const;
export type TxCategorySource = (typeof TX_CATEGORY_SOURCES)[number];

export const txCategorySchema = z.enum(TX_CATEGORIES);

export interface TxCategoryFields {
  category: TxCategory;
  categorySource: TxCategorySource;
  categoryReason?: string;
}

export function assertTxCategory(value: string): TxCategory {
  return txCategorySchema.parse(value);
}
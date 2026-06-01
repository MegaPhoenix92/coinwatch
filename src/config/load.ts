import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { AccountDescriptor } from '../domain/account.js';
import { ASSET_SYMBOL_VALUES, assetBySymbol, type AssetSymbol } from '../domain/assets.js';
import type { Chain } from '../domain/chains.js';
import { assertUtcDateString, type UtcDateString } from '../domain/historical-price.js';

const CHAIN_VALUES = [
  'bitcoin',
  'ethereum',
  'base',
  'polygon',
  'arbitrum',
  'optimism',
  'solana',
] as const;

const EVM_CHAIN_SET = new Set<Chain>(['ethereum', 'base', 'polygon', 'arbitrum', 'optimism']);

const chainSchema = z.enum(CHAIN_VALUES);
const assetSymbolSchema = z.enum(ASSET_SYMBOL_VALUES);
const btcScriptTypeSchema = z.enum(['p2wpkh', 'p2sh-p2wpkh', 'p2pkh']);
const decimalBigintSchema = z
  .string()
  .regex(/^[0-9]+$/, 'expected a decimal string')
  .transform((value) => BigInt(value));
const utcDateSchema = z.string().transform((value, ctx) => {
  try {
    return assertUtcDateString(value);
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'invalid UTC date',
    });
    return z.NEVER;
  }
});

const xpubSourceSchema = z.object({
  kind: z.literal('xpub'),
  xpub: z.string().min(1),
  scriptType: btcScriptTypeSchema,
  gapLimit: z.number().int().positive().optional(),
  maxGapScan: z.number().int().positive().optional(),
});

const addressesSourceSchema = z.object({
  kind: z.literal('addresses'),
  addresses: z.array(z.string().min(1)).min(1),
});

const accountSourceSchema = z.discriminatedUnion('kind', [
  xpubSourceSchema,
  addressesSourceSchema,
]);

const accountDescriptorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  family: z.enum(['bitcoin', 'evm', 'solana']),
  chains: z.array(chainSchema).min(1),
  source: accountSourceSchema,
});

const accountsSchema = z.array(accountDescriptorSchema);

const openingLotSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  chain: chainSchema,
  symbol: assetSymbolSchema,
  rawAmount: decimalBigintSchema,
  decimals: z.number().int().nonnegative(),
  acquiredDate: utcDateSchema,
  totalBasisUsd: z.number().nonnegative(),
  note: z.string().optional(),
});

const basisOverrideSchema = z
  .object({
    type: z.literal('basis_override'),
    accountId: z.string().min(1),
    chain: chainSchema,
    symbol: assetSymbolSchema,
    txid: z.string().min(1),
    totalBasisUsd: z.number().nonnegative().optional(),
    unitBasisUsd: z.number().nonnegative().optional(),
    note: z.string().optional(),
  })
  .refine(
    (value) => (value.totalBasisUsd === undefined) !== (value.unitBasisUsd === undefined),
    'provide exactly one of totalBasisUsd or unitBasisUsd',
  );

const openingBalancesSchema = z.object({
  openingLots: z.array(openingLotSchema).default([]),
  adjustments: z.array(basisOverrideSchema).default([]),
});

export type OpeningLot = z.infer<typeof openingLotSchema> & {
  chain: Chain;
  symbol: AssetSymbol;
  acquiredDate: UtcDateString;
};

export type BasisOverrideAdjustment = z.infer<typeof basisOverrideSchema> & {
  chain: Chain;
  symbol: AssetSymbol;
};

export interface OpeningBalancesConfig {
  openingLots: OpeningLot[];
  adjustments: BasisOverrideAdjustment[];
}

function isBitcoinAddress(address: string): boolean {
  return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,90}$/.test(address);
}

function isEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function isSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

function isExtendedPublicKey(xpub: string): boolean {
  return /^(xpub|ypub|zpub)[1-9A-HJ-NP-Za-km-z]{24,}$/.test(xpub);
}

function validateAccountSemantics(accounts: AccountDescriptor[]): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();

  accounts.forEach((account, index) => {
    const accountPath = `${index}`;
    if (ids.has(account.id)) {
      issues.push(`${accountPath}.id: duplicate account id`);
    }
    ids.add(account.id);

    if (account.family === 'bitcoin') {
      if (account.chains.length !== 1 || account.chains[0] !== 'bitcoin') {
        issues.push(`${accountPath}.chains: bitcoin accounts must use only the bitcoin chain`);
      }
    } else if (account.family === 'evm') {
      if (account.chains.some((chain) => !EVM_CHAIN_SET.has(chain))) {
        issues.push(`${accountPath}.chains: evm accounts may include only EVM chains`);
      }
    } else if (account.chains.length !== 1 || account.chains[0] !== 'solana') {
      issues.push(`${accountPath}.chains: solana accounts must use only the solana chain`);
    }

    if (account.source.kind === 'xpub') {
      if (account.family !== 'bitcoin') {
        issues.push(`${accountPath}.source.kind: xpub sources are valid only for bitcoin accounts`);
      }
      if (!isExtendedPublicKey(account.source.xpub)) {
        issues.push(`${accountPath}.source.xpub: invalid extended public key`);
      }
      return;
    }

    for (const [addressIndex, address] of account.source.addresses.entries()) {
      const path = `${accountPath}.source.addresses.${addressIndex}`;
      if (account.family === 'bitcoin' && !isBitcoinAddress(address)) {
        issues.push(`${path}: invalid bitcoin address`);
      } else if (account.family === 'evm' && !isEvmAddress(address)) {
        issues.push(`${path}: invalid EVM address`);
      } else if (account.family === 'solana' && !isSolanaAddress(address)) {
        issues.push(`${path}: invalid solana address`);
      }
    }
  });

  return issues;
}

export type ConfigParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

function invalidAccountsError(path: string, issues: string[]): Error {
  const message = issues.map((issue) => `  - ${issue}`).join('\n');
  return new Error(`Invalid accounts config at ${path}:\n${message}`);
}

function readJsonFile(path: string): ConfigParseResult<unknown> {
  if (!existsSync(path)) {
    return { ok: false, issues: [`file not found: ${path}`] };
  }
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { ok: false, issues: ['file is not valid JSON'] };
  }
}

export function parseAccountsFile(path: string): ConfigParseResult<AccountDescriptor[]> {
  const raw = readJsonFile(path);
  if (!raw.ok) {
    return raw;
  }

  const parsed = accountsSchema.safeParse(raw.value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const issuePath = issue.path.join('.') || '(root)';
      return `${issuePath}: ${issue.message}`;
    });
    return { ok: false, issues };
  }

  const accounts = parsed.data as AccountDescriptor[];
  const semanticIssues = validateAccountSemantics(accounts);
  if (semanticIssues.length > 0) {
    return { ok: false, issues: semanticIssues };
  }

  return { ok: true, value: accounts };
}

export function loadAccounts(path: string): AccountDescriptor[] {
  const parsed = parseAccountsFile(path);
  if (!parsed.ok) {
    throw invalidAccountsError(path, parsed.issues);
  }
  return parsed.value;
}

function invalidOpeningBalancesError(path: string, issues: string[]): Error {
  const message = issues.map((issue) => `  - ${issue}`).join('\n');
  return new Error(`Invalid opening balances config at ${path}:\n${message}`);
}

function validateOpeningBalancesSemantics(
  value: OpeningBalancesConfig,
  accounts: readonly AccountDescriptor[],
): string[] {
  const issues: string[] = [];
  const accountIds = new Set(accounts.map((account) => account.id));
  const checkEntry = (
    kind: 'openingLots' | 'adjustments',
    index: number,
    entry: Pick<OpeningLot | BasisOverrideAdjustment, 'accountId' | 'chain' | 'symbol'> & {
      decimals?: number;
      rawAmount?: bigint;
    },
  ) => {
    const path = `${kind}.${index}`;
    if (!accountIds.has(entry.accountId)) {
      issues.push(`${path}.accountId: unknown account id`);
    }
    const asset = assetBySymbol(entry.chain, entry.symbol);
    if (asset === undefined) {
      issues.push(`${path}.symbol: unsupported asset for chain`);
    } else if (entry.decimals !== undefined && entry.decimals !== asset.decimals) {
      issues.push(`${path}.decimals: expected ${asset.decimals} for ${entry.chain}/${entry.symbol}`);
    }
    if (entry.rawAmount !== undefined && entry.rawAmount <= 0n) {
      issues.push(`${path}.rawAmount: must be positive`);
    }
  };

  value.openingLots.forEach((lot, index) => checkEntry('openingLots', index, lot));
  value.adjustments.forEach((adjustment, index) => checkEntry('adjustments', index, adjustment));
  return issues;
}

export function parseOpeningBalancesFile(
  path: string,
  accounts: readonly AccountDescriptor[] = [],
): ConfigParseResult<OpeningBalancesConfig> {
  if (!existsSync(path)) {
    return { ok: true, value: { openingLots: [], adjustments: [] } };
  }

  const raw = readJsonFile(path);
  if (!raw.ok) {
    return raw;
  }

  const parsed = openingBalancesSchema.safeParse(raw.value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const issuePath = issue.path.join('.') || '(root)';
      return `${issuePath}: ${issue.message}`;
    });
    return { ok: false, issues };
  }

  const config = parsed.data as OpeningBalancesConfig;
  const semanticIssues = validateOpeningBalancesSemantics(config, accounts);
  if (semanticIssues.length > 0) {
    return { ok: false, issues: semanticIssues };
  }
  return { ok: true, value: config };
}

export function loadOpeningBalances(
  path: string,
  accounts: readonly AccountDescriptor[] = [],
): OpeningBalancesConfig {
  const parsed = parseOpeningBalancesFile(path, accounts);
  if (!parsed.ok) {
    throw invalidOpeningBalancesError(path, parsed.issues);
  }
  return parsed.value;
}

export interface CoinwatchEnv {
  anthropicApiKey?: string;
  alchemyApiKey?: string;
  heliusApiKey?: string;
  coingeckoApiKey?: string;
}

function envValue(name: string): string | undefined {
  const value = process.env[name];
  return value === '' ? undefined : value;
}

export function loadEnv(): CoinwatchEnv {
  return {
    anthropicApiKey: envValue('ANTHROPIC_API_KEY'),
    alchemyApiKey: envValue('ALCHEMY_API_KEY'),
    heliusApiKey: envValue('HELIUS_API_KEY'),
    coingeckoApiKey: envValue('COINGECKO_API_KEY'),
  };
}

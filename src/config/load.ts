import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { AccountDescriptor } from '../domain/account.js';
import type { Chain } from '../domain/chains.js';

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
const btcScriptTypeSchema = z.enum(['p2wpkh', 'p2sh-p2wpkh', 'p2pkh']);

const xpubSourceSchema = z.object({
  kind: z.literal('xpub'),
  xpub: z.string().min(1),
  scriptType: btcScriptTypeSchema,
  gapLimit: z.number().int().positive().optional(),
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

function invalidAccountsError(path: string, issues: string[]): Error {
  const message = issues.map((issue) => `  - ${issue}`).join('\n');
  return new Error(`Invalid accounts config at ${path}:\n${message}`);
}

export function loadAccounts(path: string): AccountDescriptor[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`Invalid accounts config at ${path}: file is not valid JSON`);
  }

  const parsed = accountsSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `${path}: ${issue.message}`;
    });
    throw invalidAccountsError(path, issues);
  }

  const accounts = parsed.data as AccountDescriptor[];
  const semanticIssues = validateAccountSemantics(accounts);
  if (semanticIssues.length > 0) {
    throw invalidAccountsError(path, semanticIssues);
  }

  return accounts;
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

import { existsSync, writeFileSync } from 'node:fs';
import { stdout } from 'node:process';
import type { ConfigParseResult } from '../config/load.js';
import { parseAccountsFile, parseOpeningBalancesFile } from '../config/load.js';
import {
  ACCOUNTS_EXAMPLE_PATH,
  DEFAULT_ACCOUNTS_PATH,
  DEFAULT_OPENING_BALANCES_PATH,
} from '../config/paths.js';
import { accountsTemplateJson } from '../config/template.js';

export interface ConfigValidateCommand {
  kind: 'validate';
  accountsPath: string;
  openingBalancesPath: string;
  requireOpeningBalances: boolean;
}

export interface ConfigTemplateCommand {
  kind: 'template';
  examplePath: string;
  outPath?: string;
}

export type ConfigCommand = ConfigValidateCommand | ConfigTemplateCommand;

export function parseConfigCommand(argv: readonly string[]): ConfigCommand | undefined {
  if (argv[0] !== 'config') {
    return undefined;
  }

  const subcommand = argv[1];
  if (subcommand === 'validate') {
    const command: ConfigValidateCommand = {
      kind: 'validate',
      accountsPath: DEFAULT_ACCOUNTS_PATH,
      openingBalancesPath: DEFAULT_OPENING_BALANCES_PATH,
      requireOpeningBalances: false,
    };
    for (let i = 2; i < argv.length; i += 1) {
      const arg = argv[i];
      const next = argv[i + 1];
      if (arg === '--accounts' && next !== undefined) {
        command.accountsPath = next;
        i += 1;
      } else if (arg === '--opening-balances' && next !== undefined) {
        command.openingBalancesPath = next;
        command.requireOpeningBalances = true;
        i += 1;
      } else {
        throw new Error(`Unknown config validate argument: ${arg}`);
      }
    }
    return command;
  }

  if (subcommand === 'template') {
    const command: ConfigTemplateCommand = {
      kind: 'template',
      examplePath: ACCOUNTS_EXAMPLE_PATH,
    };
    for (let i = 2; i < argv.length; i += 1) {
      const arg = argv[i];
      const next = argv[i + 1];
      if (arg === '--example' && next !== undefined) {
        command.examplePath = next;
        i += 1;
      } else if (arg === '--out' && next !== undefined) {
        command.outPath = next;
        i += 1;
      } else {
        throw new Error(`Unknown config template argument: ${arg}`);
      }
    }
    return command;
  }

  throw new Error(`Unknown config subcommand "${subcommand ?? ''}". Use "validate" or "template".`);
}

function formatSection(label: string, path: string, result: ConfigParseResult<unknown>): string {
  const status = result.ok ? 'ok' : 'invalid';
  const lines = [`${label} (${path}): ${status}`];
  if (!result.ok) {
    for (const issue of result.issues) {
      lines.push(`  - ${issue}`);
    }
  }
  return lines.join('\n');
}

export function runConfigValidate(command: ConfigValidateCommand): boolean {
  const accounts = parseAccountsFile(command.accountsPath);
  const sections = [formatSection('accounts', command.accountsPath, accounts)];

  let opening: ConfigParseResult<unknown>;
  if (command.requireOpeningBalances || existsSync(command.openingBalancesPath)) {
    const accountList = accounts.ok ? accounts.value : [];
    opening = parseOpeningBalancesFile(command.openingBalancesPath, accountList);
    sections.push(formatSection('opening-balances', command.openingBalancesPath, opening));
  } else {
    sections.push(
      `opening-balances (${command.openingBalancesPath}): skipped (file not present; optional)`,
    );
    opening = { ok: true, value: {} };
  }

  stdout.write(`${sections.join('\n')}\n`);
  const accountsOk = accounts.ok;
  const openingOk = opening.ok;
  return accountsOk && openingOk;
}

export function runConfigTemplate(command: ConfigTemplateCommand): void {
  const json = accountsTemplateJson(command.examplePath);
  if (command.outPath === undefined) {
    stdout.write(json);
    return;
  }
  writeFileSync(command.outPath, json, 'utf8');
  stdout.write(`Wrote accounts template to ${command.outPath}\n`);
}
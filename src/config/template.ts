import { readFileSync } from 'node:fs';
import { ACCOUNTS_EXAMPLE_PATH } from './paths.js';

export function accountsTemplateJson(examplePath = ACCOUNTS_EXAMPLE_PATH): string {
  const raw = readFileSync(examplePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
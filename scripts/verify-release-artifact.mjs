#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const CLI = 'dist/cli.js';

if (!existsSync(CLI)) {
  console.error(`coinwatch release verify failed: missing ${CLI} (run npm run build)`);
  process.exit(1);
}

const header = readFileSync(CLI, 'utf8').split('\n', 1)[0];
if (header !== '#!/usr/bin/env node') {
  console.error(`coinwatch release verify failed: ${CLI} must start with #!/usr/bin/env node`);
  process.exit(1);
}

const help = execFileSync(process.execPath, [CLI, 'config', 'validate', '--accounts', 'config/accounts.example.json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (!help.includes('accounts (config/accounts.example.json): ok')) {
  console.error('coinwatch release verify failed: built CLI did not validate example config');
  process.exit(1);
}

console.log('coinwatch release verify passed');
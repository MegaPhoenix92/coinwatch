import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const CHECK_SCRIPT = join(process.cwd(), 'scripts/check-secrets.mjs');

describe('secret scan gate', () => {
  it('passes on tracked files while ignoring placeholder examples', async () => {
    const { stdout } = await execFileAsync(process.execPath, [CHECK_SCRIPT]);
    expect(stdout).toContain('coinwatch secret scan passed');
  });

  it('flags planted xpub and private-key material', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coinwatch-secret-scan-'));
    const fixture = join(dir, 'leak.ts');
    const plantedXpub = `xpub${'661MyMwAqRbcF5xVqKhnv7L2J5RtxqGg6d3j7wPzq2ExampleRealLooking'}`;
    const plantedPrivateKey = `${'0123456789abcdef'}${'0123456789abcdef'}${'0123456789abcdef'}${'0123456789abcdef'}`;
    await writeFile(
      fixture,
      [
        `export const leakedXpub = '${plantedXpub}';`,
        `export const leakedPrivateKey = '${plantedPrivateKey}';`,
      ].join('\n'),
      'utf8',
    );

    await expect(execFileAsync(process.execPath, [CHECK_SCRIPT, fixture])).rejects.toMatchObject({
      stderr: expect.stringContaining('coinwatch secret scan failed'),
    });
  });
});

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UnsignedArtifact } from '../domain/transfer.js';

const EXT: Record<UnsignedArtifact['kind'], string> = {
  'btc-psbt': 'psbt',
  'evm-eip1559': 'evmtx',
  'solana-message': 'solmsg',
};

/** Write the unsigned payload to ./coinwatch-unsigned-<kind>-<stamp>.<ext> (gitignored). */
export function writeArtifactFile(
  artifact: UnsignedArtifact,
  stamp: string,
  dir = process.cwd(),
): string {
  const file = join(dir, `coinwatch-unsigned-${artifact.kind}-${stamp}.${EXT[artifact.kind]}`);
  writeFileSync(file, artifact.payload, 'utf8');
  return file;
}

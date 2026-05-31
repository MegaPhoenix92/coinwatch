import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { base64 } from '@scure/base';
import type { UnsignedArtifact } from '../domain/transfer.js';

const EXT: Record<UnsignedArtifact['kind'], string> = {
  'btc-psbt': 'psbt',
  'evm-eip1559': 'evmtx',
  'solana-message': 'solmsg',
};

// Kinds whose payload is base64 and whose canonical on-disk form is the decoded
// BINARY blob. A `.psbt` file is binary by convention, and `summary.artifactHash`
// is sha256 over the binary PSBT — writing the binary keeps `sha256(file)` equal
// to `artifactHash` so the user can reproduce the on-device cross-check, and
// matches what binary-only signers expect. EVM (0x-hex) / Solana on-disk formats
// are decided in their own Phase-2 slices; until then they stay text.
const BINARY_BASE64_KINDS = new Set<UnsignedArtifact['kind']>(['btc-psbt']);

/** Write the unsigned payload to ./coinwatch-unsigned-<kind>-<stamp>.<ext> (gitignored). */
export function writeArtifactFile(
  artifact: UnsignedArtifact,
  stamp: string,
  dir = process.cwd(),
): string {
  const file = join(dir, `coinwatch-unsigned-${artifact.kind}-${stamp}.${EXT[artifact.kind]}`);
  if (BINARY_BASE64_KINDS.has(artifact.kind)) {
    writeFileSync(file, base64.decode(artifact.payload));
  } else {
    writeFileSync(file, artifact.payload, 'utf8');
  }
  return file;
}

# Releasing coinwatch

coinwatch uses [Semantic Versioning](https://semver.org/). The CLI entrypoint is the compiled
`dist/cli.js` referenced by the `coinwatch` bin in `package.json`.

## Support matrix

| Component | Supported |
|-----------|-----------|
| Node.js | **20.x** and **22.x** (matches `engines.node` and CI) |
| OS | macOS, Linux (CI runs on `ubuntu-latest`) |
| Install | From a git tag or local checkout (see README **Releases**) |

## Pre-release checklist

```bash
npm ci
npm run typecheck
npm test
npm run security:no-signing
npm run security:secrets
npm run build
npm run release:verify
```

## Cutting a release

1. Update `CHANGELOG.md` — move **Unreleased** notes under a new `## [X.Y.Z] - YYYY-MM-DD` section.
2. Bump `version` in `package.json` (and run `npm install` so `package-lock.json` stays in sync).
3. Commit: `chore(release): vX.Y.Z`
4. Tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`
5. Push: `git push origin main --tags`

The GitHub **Release** workflow (`.github/workflows/release.yml`) runs on `v*.*.*` tags, rebuilds,
re-runs tests, and uploads the `npm pack` tarball as a release asset.

## Install paths

| Method | Command |
|--------|---------|
| Development | `npm install` then `npx tsx src/cli.ts` |
| Global from checkout | `npm install -g .` after `npm run build` |
| Packed tarball | `npm pack` → `npm install -g coinwatch-0.1.0.tgz` |
| Git tag | `npm install -g github:MegaPhoenix92/coinwatch#vX.Y.Z` (runs `prepack` / build) |

Never commit `config/*.local.json`, `.env`, or real xpubs when validating a release candidate.
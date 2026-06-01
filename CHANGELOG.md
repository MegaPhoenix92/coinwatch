# Changelog

All notable changes to coinwatch are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Release packaging: production `dist/` build, `npm pack` artifact, documented install matrix.

## [0.1.0] - 2026-06-01

### Added

- Watch-only multi-chain read (Bitcoin, EVM, Solana) with USD valuation and MCP agent CLI.
- Unsigned transfer preparation (BTC / EVM / Solana) with full preflight; never signs.
- Phase 3 reporting: FIFO PnL, CSV export (schema v3), opening balances, reconciliation, categorization.
- `coinwatch config validate` and `coinwatch config template`.
- Redacted structured diagnostics via `COINWATCH_LOG`.

[Unreleased]: https://github.com/MegaPhoenix92/coinwatch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/MegaPhoenix92/coinwatch/releases/tag/v0.1.0
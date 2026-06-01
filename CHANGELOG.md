# Changelog

All notable changes to coinwatch are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- MIT `LICENSE` and SPDX `license` field (decision #46). Applies from this commit forward; v0.1.0 tarball predates the license file.

## [0.1.0] - 2026-06-01

First public release. Watch-only multi-chain CLI with Claude Agent SDK MCP tools — **never holds private keys or signs.**

### Added

- **Read:** Bitcoin, EVM (Ethereum / Base / Polygon / Arbitrum / Optimism), and Solana — balances, USD valuation (CoinGecko), receive addresses, transaction history with rules-first categorization and manual overrides (display-only; FIFO unchanged).
- **Prepare:** Unsigned transfer artifacts — BTC PSBT, EVM EIP-1559 (native + ERC-20), native SOL, SPL + Token-2022 — with full preflight (sync validation, native fee sufficiency, Solana rent-exempt minimum for new recipients).
- **Report:** Historical USD prices with cache; per-account FIFO cost-basis / PnL; CSV export (schema v3, lot provenance `chain` | `manual` | `override`); opening-balance lots; reconciliation vs external bookkeeping.
- **CLI utilities:** `export-pnl`, `reconcile`, `config validate`, `config template`, `registry verify`.
- **Ops / infra:** Redacted structured logging (`COINWATCH_LOG`); release packaging (`dist/cli.js`, `RELEASING.md`, GitHub Release workflow); asset registry drift gate (`fixtures/expected-assets.json`); optional provider RPC URL overrides (`MEMPOOL_API_BASE`, `SOLANA_RPC_URL`, `EVM_RPC_*`); Cloud SQL PostgreSQL cache via `DATABASE_URL` (SQLite file for local dev only).
- **Safety:** CI no-signing and secret-scan gates; agent SDK lockdown (MCP tools only).

### Decisions recorded (in-repo docs / issues)

- #68 FIFO accounting · #69 provider privacy (env RPC overrides) · #70 Cloud SQL cache (not SQLite encryption) · #49 tx-cache always refetch (write-through only).

### Install

See [README.md](README.md) and [RELEASING.md](RELEASING.md). Requires Node.js 20 or 22.

[Unreleased]: https://github.com/MegaPhoenix92/coinwatch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/MegaPhoenix92/coinwatch/releases/tag/v0.1.0
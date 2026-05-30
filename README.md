# coinwatch

A **watch-only, multi-chain crypto wallet** driven by a Claude Agent SDK terminal agent.

`coinwatch` reads your holdings across **Bitcoin, EVM chains (Ethereum / Base / Polygon /
Arbitrum / Optimism), and Solana** — native assets plus stablecoins (USDC / USDT / PYUSD) —
values them in USD, lists and derives receive addresses, and shows transaction history,
exposed as MCP tools to an interactive agent.

## Defining property: no keys, ever

The application **holds no private keys and never signs anything.** Custody lives entirely on
your own external signer (hardware wallet / phone). The agent is structurally incapable of
moving funds — "approve every send" is enforced by the *absence of keys*, not by guard code.
You supply only **public** xpubs / account descriptors / watch addresses.

## Status

Planning stage — the Phase‑1 (watch‑only read MVP) design and implementation plan are complete.
No application code yet; the read-only MVP is built next.

## Phasing

- **Phase 1 — Watch-only read (MVP):** portfolio + live USD valuation + receive addresses +
  transaction history across BTC / EVM / Solana. CLI agent, read-only tools, zero signing code.
- **Phase 2 — Prepare outbound:** per-chain *unsigned* transaction construction + handoff to an
  external signer (verify destination + amount on-device before signing).
- **Phase 3 — Reporting & bookkeeping:** categorization, CSV export, cost-basis / PnL.

## Architecture

A pure, richly-tested core (address derivation, money math, USD valuation) sits behind three
`ChainAdapter` implementations (Bitcoin / EVM / Solana), each driven by an injectable data
provider so all network I/O is mocked with recorded fixtures in tests. TypeScript + Node,
Claude Agent SDK + MCP tools.

## Security model

1. **Watch-only by construction** — no private keys are read, stored, derived-with, or signed.
2. **The agent is untrusted for correctness** — your signing device is the source of truth;
   verify destination + amount on-device (Phase 2).
3. **Receive addresses are unverified until confirmed on your device.**
4. **xpubs / descriptors are privacy-sensitive** — they live only in gitignored local config,
   never committed, never logged.

## License

TBD.

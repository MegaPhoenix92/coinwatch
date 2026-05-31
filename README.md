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

Phase 1 is implemented as a watch-only CLI agent. It reads configured public account
descriptors, queries provider APIs through adapter seams, exposes four read-only MCP tools, and
stores optional local labels / transaction cache entries in `coinwatch.db`.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `config/accounts.local.json`. This file is gitignored; do not commit real xpubs or
   wallet addresses. Each entry is an `AccountDescriptor`:

   ```json
   [
     {
       "id": "btc-cold-1",
       "label": "BTC Cold Storage",
       "family": "bitcoin",
       "chains": ["bitcoin"],
       "source": {
         "kind": "xpub",
         "xpub": "zpub...",
         "scriptType": "p2wpkh",
         "gapLimit": 20
       }
     },
     {
       "id": "evm-1",
       "label": "EVM Wallet",
       "family": "evm",
       "chains": ["ethereum", "base", "polygon", "arbitrum", "optimism"],
       "source": { "kind": "addresses", "addresses": ["0x..."] }
     },
     {
       "id": "sol-1",
       "label": "Solana Wallet",
       "family": "solana",
       "chains": ["solana"],
       "source": { "kind": "addresses", "addresses": ["..."] }
     }
   ]
   ```

   Bitcoin `source.kind: "xpub"` supports `scriptType` values `p2wpkh`, `p2sh-p2wpkh`, and
   `p2pkh`. Literal watch-address sources use `{ "kind": "addresses", "addresses": [...] }`.

3. Create `.env`. This file is also gitignored:

   ```bash
   ANTHROPIC_API_KEY=        # required for the Claude Agent SDK CLI agent
   ALCHEMY_API_KEY=          # optional; enables EVM RPC and transaction history
   HELIUS_API_KEY=           # optional; enables Helius Solana RPC
   COINGECKO_API_KEY=        # optional; CoinGecko public tier is used if unset
   ```

## Run

Start the locked-down watch-only agent REPL:

```bash
npx tsx src/cli.ts
```

The agent is restricted to the `mcp__coinwatch__*` namespace and exposes exactly four tools:
`get_portfolio`, `list_addresses`, `derive_receive_address`, and `get_history`. Type `exit` or
`quit` to close the REPL.

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
   CI includes a static no-signing / no-broadcast gate over `src/`.
2. **The agent is untrusted for correctness** — your signing device is the source of truth.
3. **Receive addresses are unverified until confirmed on your device.**
4. **xpubs / descriptors are privacy-sensitive** — they live only in gitignored local config,
   never committed, never logged.

## Privacy runbook

- Treat xpubs, descriptors, and watched addresses as privacy-sensitive. Keep them only in
  `config/accounts.local.json` or another gitignored local config file.
- Never commit `.env`, `config/*.local.json`, real xpubs, wallet addresses intended to stay
  private, or provider keys.
- Do not paste real xpubs or provider keys into issues, PRs, logs, prompts, or screenshots.
- Data providers see the addresses you ask them about: mempool.space-compatible Bitcoin APIs,
  Alchemy for EVM, Helius / public Solana RPC, and CoinGecko for price IDs.
- `coinwatch.db` is local. It caches labels and public transaction records only; it never stores
  signing keys.
- Every receive address returned by the CLI is still unverified until you confirm it on your
  signing device.

## License

TBD.

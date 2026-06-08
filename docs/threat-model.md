# Threat Model

## Assets Protected

- Secret keys.
- User funds.
- Policy files.
- Receipts and private URLs.
- Mainnet enablement state.

## Trusted Components

- Local CLI binary.
- Local policy files chosen by the user.
- Stellar SDK and Horizon endpoints for network operations.
- Protocol-specific DeFi adapters only after policy and signing guards have run; third-party protocol SDKs are not trusted for policy decisions.

## Untrusted Components

- Agent prompts and tool instructions.
- Paid APIs.
- Remote URLs.
- User-provided transaction data.
- Third-party protocol SDKs and remote deployment maps used by DeFi adapters.

## Threats and Mitigations

- Agent prompt injection: policy and approval gates sit outside prompt text.
- Secret key leakage: output, logs, and receipts redact secret-like values.
- Policy weakening: agents are instructed not to weaken policy files.
- Overpayment: per-transaction, daily, and monthly limits are enforced.
- Spend-history bypass: payment commands compute daily/monthly totals and known recipients/domains from local receipts before policy evaluation, and fail closed when receipt history is unreadable.
- Replay or duplicate payment: retries are conservative and transaction submission is not blindly repeated.
- Redirect payment changes: x402/MPP will deny redirect payment changes by default when implemented.
- Paid but service fails: receipts capture transaction and command context, and paid-resource command results distinguish settlement from resource delivery.
- Log privacy leaks: URL query params are redacted by default.
- Mainnet/Testnet confusion: Mainnet is disabled and marked `realFunds: true`; Mainnet signed-XDR submission and contract operations require explicit real-funds flags and refuse local Testnet wallet secrets.
- Risk-budgeted Mainnet agent-wallet misuse: the agent-wallet mode stores only a dedicated watch-only Mainnet public key, requires explicit arming, records config and policy fingerprints, enforces balance/spend/asset/destination/operation caps before payment-signature workflows, and fails closed when receipts, policy, config, or balance state cannot be verified.
- DeFi leverage risk: Blend borrow and protocol exposure are governed by explicit policy limits, minimum health-factor checks, and preflight simulation requirements.
- Aquarius AMM route risk: Aquarius API responses, pool metadata, swap routes, and swap-chain XDR are untrusted inputs; policy gates allowed pools, assets, actions, nominal exposure, slippage bounds, and Mainnet approval before any future submitted action.
- Liquidity-pool loss risk: core liquidity-pool deposits are governed by explicit pool, asset, action, exposure, and price-bound policy controls; estimates are marked as non-guaranteed snapshots.
- Market listener staleness: listener output is an alert event, not execution approval, and commands must re-run preflight before mutation.
- Asset issuer and trustline risk: liquidity preflight reports reserve assets and missing trustlines so agents do not silently deposit into unfamiliar issued-asset pools.
- Generic Soroban AMM risk: Soroban liquidity contracts are read-only/adapter-required unless a protocol-specific adapter defines interfaces, policy controls, simulation, signing, and receipts.
- Third-party protocol SDK compromise: protocol SDKs are isolated to adapter packages, loaded lazily, prohibited from core package and CLI startup paths by protocol SDK boundary checks, and cannot bypass policy evaluation, Soroban simulation, Mainnet auto-signing blocks, or receipt logging.
- Malicious paid API: domain allowlists and policy checks gate payment.
- Local approval bridge abuse: the localhost bridge requires a per-session API token for request and decision APIs, rejects cross-origin writes, and bounds request body size.
- Malicious contributor: tests and docs are required for safety-sensitive changes.

## Out of Scope

Hosted custody, mobile wallets, generalized blockchain indexing, and local Mainnet auto-signing are out of scope for v0. Risk-budgeted Mainnet agent-wallet workflows are limited to guard checks before externally signed XDR.

## Protocol SDK Boundary Rules

Protocol SDK support must keep dependency and import boundaries narrow:

- Third-party protocol SDK dependencies belong only in the approved adapter package, currently `@stellar-agent/defi`.
- Protocol SDKs must be loaded with dynamic `import()` inside the adapter functions that need them.
- The CLI must lazy-load DeFi adapters instead of statically importing them into every command path.
- Shared packages such as `core`, `policy`, `stellar`, `ledger-logger`, payment clients, and MCP code must not import protocol SDKs.
- Adding another protocol SDK requires updating `scripts/check-protocol-sdk-boundaries.mjs`, policy tests, docs, and release notes.
- Release preflight runs protocol SDK boundary checks and a production dependency audit before artifacts are packed.

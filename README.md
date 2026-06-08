Build payment-capable agents on Stellar from Testnet prototypes to risk-budgeted Mainnet workflows without giving them a blank check.

`stellar-agent` gives agents a Testnet-first wallet, policy engine, receipt trail, guarded contract/DeFi/market toolkit, and explicit Mainnet controls. Use it to prototype paid APIs, MPP sessions, issued-asset payments, Blend and Aquarius preflights, core liquidity-pool monitoring, approval-gated transactions, and small Mainnet agent-wallet workflows where spend is bounded, not safe.

[![CI](https://github.com/someone-in-texas/Stellar-Agent/actions/workflows/ci.yml/badge.svg)](https://github.com/someone-in-texas/Stellar-Agent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@stellar-agent/cli.svg)](https://www.npmjs.com/package/@stellar-agent/cli)

## Status

This repository is a `0.5.0` Testnet-first release. Core primitives, policy evaluation, local receipt logging, Testnet wallet creation, Friendbot funding, fee-aware Testnet payment submission, bundled Testnet payments, issued-asset trustlines, claimable balances, local approval bridge requests, local x402-style and MPP Testnet demos, agent-to-agent service-market examples, Blend DeFi inspection and guarded Testnet mutation, Aquarius AMM inspection and policy-gated preflight, core Stellar liquidity-pool inspection/preflight/Testnet mutation, market listeners, strategy investigation, MCP tools, Codex plugin packaging, cache controls, and the CLI command surface are present. Mainnet local auto-signing remains blocked except for explicitly enabled, armed, risk-budgeted agent-wallet payments; other guarded Mainnet submission is limited to externally signed XDR and explicitly acknowledged real-funds contract operations.

## Safety First

- Testnet is the default.
- Mainnet is disabled by default and generic Mainnet auto-signing is blocked.
- Guarded Mainnet usage requires explicit real-funds flags, receipts, and Mainnet enablement.
- Risk-budgeted Mainnet agent wallets require a dedicated wallet, explicit arming, policy/config fingerprints, balance caps, spend limits, asset controls, and destination allowlists. Autosigning is opt-in for this wallet only and reads the secret key from an environment variable, never config.
- Secret keys are redacted from CLI output, logs, and receipts.
- Policy evaluation runs before payment submission.
- Staged features exit with code `8` instead of attempting hidden payment work.

## 10-Minute Quickstart

Most users should install or run the CLI package:

```bash
npm install -g @stellar-agent/cli
stellar-agent testnet doctor --json
npx @stellar-agent/cli testnet doctor --json
```

GitHub releases include verified npm package tarballs and a matching Codex plugin artifact. npm publication is handled by the protected trusted-publishing workflow, and the local checkout workflow remains the most direct way to try unreleased changes:

```bash
pnpm install
pnpm build
pnpm cli -- testnet init
pnpm cli -- testnet smoke-test
pnpm cli -- receipts latest
```

Useful verification commands:

```bash
pnpm test
pnpm release:preflight
pnpm cli -- testnet init --no-fund
pnpm cli -- testnet smoke-test --dry-run --json
LIVE_STELLAR_TESTNET=1 pnpm verify:live:testnet
```

For GitHub release preparation, see [RELEASE.md](RELEASE.md).

## CLI Examples

```bash
stellar-agent profile list --json
stellar-agent testnet doctor
stellar-agent wallet create-testnet agent --json
stellar-agent wallet create-testnet funded-agent --fund --json
stellar-agent wallet create-testnet merchant --json
stellar-agent wallet import-public --name treasury --network mainnet --address G... --json
stellar-agent mainnet enable --i-understand-real-funds --json
stellar-agent mainnet agent-wallet create --address G... --max-balance 25 --daily-limit 5 --per-tx-limit 1 --asset XLM --allow-destination G... --json
stellar-agent mainnet agent-wallet arm --i-understand-real-funds --json
stellar-agent --profile mainnet tx request-payment-signature --from mainnet-agent --to G... --amount 0.1 --allow-real-funds --i-understand-real-funds --json
stellar-agent mainnet agent-wallet autosign enable --secret-key-env STELLAR_AGENT_MAINNET_AGENT_SECRET_KEY --i-understand-agent-wallet-autosign --json
stellar-agent --profile mainnet pay send --from mainnet-agent --to G... --amount 0.01 --allow-real-funds --i-understand-real-funds --i-understand-agent-wallet-autosign --json
stellar-agent mainnet agent-wallet disarm --json
stellar-agent wallet connect-freighter --json
stellar-agent wallet walletconnect pair --wallet lobstr --project-id "$WALLETCONNECT_PROJECT_ID" --json
stellar-agent wallet trustline list --account merchant --json
stellar-agent wallet trustline add --account merchant --asset USD:G... --json
stellar-agent testnet scenario issued-asset-payment --json
stellar-agent policy explain --to G... --amount 1 --asset XLM --json
stellar-agent pay quote --to G... --amount 1 --asset XLM --fee-strategy medium --json
stellar-agent approval create-payment --to G... --amount 6 --json
stellar-agent approval create-transaction --xdr AAAA... --summary "Sign contract transaction" --network testnet --json
stellar-agent approval decide appr_... --approve --json
stellar-agent tx request-payment-signature --from treasury --to G... --amount 1 --json
stellar-agent approval sign-walletconnect appr_... --wallet lobstr --project-id "$WALLETCONNECT_PROJECT_ID" --json
stellar-agent tx submit-approval appr_... --json
stellar-agent pay send --to G... --amount 1 --asset XLM --profile testnet
stellar-agent pay batch --file ./payments.json --from agent --json
stellar-agent pay send --from issuer --to G... --amount 1 --asset USD:G...ISSUER --json
stellar-agent claimable create --to G... --amount 1 --json
stellar-agent claimable claim --account merchant --balance-id 0000... --json
stellar-agent ledger payments --account agent --json
stellar-agent ledger export --output ./ledger-report.json
stellar-agent cache inspect --json
stellar-agent market pools list --asset-a XLM --asset-b USD:G... --json
stellar-agent market pool inspect --pool 0123... --json
stellar-agent market pool position --account agent --pool 0123... --json
stellar-agent market lp preflight --pool 0123... --max-a 1 --max-b 2 --min-price 1.5 --max-price 2.5 --json
stellar-agent market lp trustline add --pool 0123... --account agent --fee-strategy medium --json
stellar-agent market lp deposit --pool 0123... --max-a 1 --max-b 2 --min-price 1.5 --max-price 2.5 --json
stellar-agent market listen price --pool 0123... --above 2 --json
stellar-agent strategy investigate liquidity --pair XLM/USD:G... --json
stellar-agent market soroban pool preflight --id C... --action deposit --json
stellar-agent contract doctor --json
stellar-agent testnet scenario contract-asset-smoke --json
stellar-agent contract invoke --id C... --source agent --fn hello --arg to=world --json
stellar-agent defi blend deployments --network testnet --json
stellar-agent defi blend pool inspect --pool TestnetV2 --json
stellar-agent defi blend preflight --pool TestnetV2 --account agent --request supply_collateral:USDC:1 --json
stellar-agent defi blend trustline guide --asset USDC --account agent --json
stellar-agent defi blend supply --pool TestnetV2 --source agent --asset XLM --amount 1 --collateral --json
stellar-agent defi aquarius deployments --network testnet --pools --limit 10 --json
stellar-agent defi aquarius pool inspect --pool XLM --network testnet --json
stellar-agent defi aquarius lp preflight --pool XLM --action deposit --amount 0.01 --amount 10 --min-shares 0.0000001 --json
stellar-agent defi aquarius swap quote --from XLM --to AQUA --amount 0.01 --json
stellar-agent defi aquarius swap preflight --from XLM --to AQUA --amount 0.01 --slippage-bps 100 --json
stellar-agent contract upload --source agent --wasm ./contract.wasm --json
stellar-agent contract deploy --source agent --wasm ./contract.wasm --json
stellar-agent contract asset-deploy --source agent --asset native --json
stellar-agent contract extend --source agent --id C... --ledgers-to-extend 535679 --json
stellar-agent contract restore --source agent --id C... --json
stellar-agent testnet scenario x402-payment --json
stellar-agent demo market-aquarius --json
stellar-agent demo x402 --out ./demo-x402 --json
stellar-agent demo approval-flow --json
stellar-agent x402 init-server --out ./paid-api-server --json
stellar-agent pay x402 http://127.0.0.1:PORT/paid-report --allow-localhost-demo --json
stellar-agent pay mpp http://127.0.0.1:PORT/mpp-report --allow-localhost-demo --json
```

JSON Schema files for agent/tool integrations ship with `@stellar-agent/cli` under `schemas/cli`. See [docs/cli-json-schemas.md](docs/cli-json-schemas.md).
Safe demo bundle commands are documented in [docs/demo-bundles.md](docs/demo-bundles.md).

## Agent Integration

Agents should call the CLI with `--json`, parse the standard envelope, and stop on `requires_approval` unless the user explicitly approves. Example prompt:

> Run `stellar-agent testnet doctor --json`, initialize Testnet if needed, run a dry-run smoke test, and summarize the latest receipt without printing secrets.

For composable workflow examples, see [docs/agent-recipes.md](docs/agent-recipes.md).

## Release Artifacts

`v0.5.0` GitHub releases contain:

- npm tarballs for the scoped `@stellar-agent/*` packages.
- `stellar-agent-codex-plugin-v0.5.0.tgz` for the bundled Codex plugin.
- `release-manifest.json` with artifact SHA-256 checksums and source commit metadata.

The generated tarballs are verified by `pnpm release:preflight` through a fresh temporary install before release.

## npm Packages

Most users should install [`@stellar-agent/cli`](https://www.npmjs.com/package/@stellar-agent/cli). The other scoped packages are public for applications that want to embed a specific library or tool surface. See [docs/npm-packages.md](docs/npm-packages.md) for install guidance and README preview checks.

The public npm packages are:

| Package | Purpose |
| --- | --- |
| [`@stellar-agent/cli`](https://www.npmjs.com/package/@stellar-agent/cli) | End-user `stellar-agent` command line interface. |
| [`@stellar-agent/core`](https://www.npmjs.com/package/@stellar-agent/core) | Shared config, types, amounts, errors, and redaction helpers. |
| [`@stellar-agent/policy`](https://www.npmjs.com/package/@stellar-agent/policy) | Deterministic policy parsing and decision logic. |
| [`@stellar-agent/stellar`](https://www.npmjs.com/package/@stellar-agent/stellar) | Stellar SDK and Stellar CLI adapters. |
| [`@stellar-agent/defi`](https://www.npmjs.com/package/@stellar-agent/defi) | Blend and Aquarius DeFi inspection and preflight helpers. |
| [`@stellar-agent/ledger-logger`](https://www.npmjs.com/package/@stellar-agent/ledger-logger) | Receipts, JSONL event logs, and spend-history helpers. |
| [`@stellar-agent/freighter-bridge`](https://www.npmjs.com/package/@stellar-agent/freighter-bridge) | Local approval and Freighter-compatible signing bridge primitives. |
| [`@stellar-agent/walletconnect-bridge`](https://www.npmjs.com/package/@stellar-agent/walletconnect-bridge) | WalletConnect external-signing adapter for LOBSTR and compatible Stellar wallets. |
| [`@stellar-agent/mcp-server`](https://www.npmjs.com/package/@stellar-agent/mcp-server) | MCP stdio server that delegates to `stellar-agent --json`. |
| [`@stellar-agent/testnet-suite`](https://www.npmjs.com/package/@stellar-agent/testnet-suite) | Reusable Testnet wallet, Friendbot, and smoke-test workflows. |
| [`@stellar-agent/x402-client`](https://www.npmjs.com/package/@stellar-agent/x402-client) | Local Testnet x402-style demo client and server helpers. |
| [`@stellar-agent/mpp-client`](https://www.npmjs.com/package/@stellar-agent/mpp-client) | Local Testnet MPP one-time and session-budget demo helpers. |
| [`@stellar-agent/codex-plugin`](https://www.npmjs.com/package/@stellar-agent/codex-plugin) | Codex plugin validation and manifest tooling. |

## Architecture

The project is CLI-first with shared packages underneath:

- `@stellar-agent/core` for types, amounts, errors, config, and redaction.
- `@stellar-agent/policy` for policy schema and deterministic decisions.
- `@stellar-agent/stellar` for Friendbot, Horizon, wallets, and Testnet payments.
- DeFi helpers for Blend lending workflows and Aquarius AMM inspection/preflight.
- Core Stellar AMM helpers for read-only pool inspection, LP preflight, and guarded Testnet pool operations.
- `@stellar-agent/freighter-bridge` for local approval request storage and HTTP bridge APIs.
- Stellar CLI integration for Soroban contract invocation when `stellar` is installed.
- `@stellar-agent/testnet-suite` for reusable Testnet workflows.
- `@stellar-agent/ledger-logger` for receipts and JSONL event logs.
- `@stellar-agent/mcp-server` for MCP stdio tools that delegate to `stellar-agent --json`.
- `@stellar-agent/codex-plugin` for bundled Codex plugin validation and manifests.
- `@stellar-agent/cli` for command registration and terminal behavior.

## Mainnet

Mainnet uses real funds. It is disabled by default, requires explicit enablement, refuses local Mainnet secret-key storage, and supports guarded externally signed XDR, explicitly acknowledged contract operations, and risk-budgeted agent-wallet payment workflows. The agent-wallet mode stores a dedicated Mainnet public key, enforces hard caps and allowlists, disarms on config or policy changes, and can autosign only when the user explicitly enables env-var based autosigning for that wallet and policy evaluates the payment as `allowed`. See [docs/mainnet-safety.md](docs/mainnet-safety.md).

## Roadmap

1. Production facilitator-backed x402/MPP support.
2. Trusted-publishing automation hardening for future npm releases.
3. Broader Mainnet approval UX hardening without local Mainnet secret custody.
4. Submitted Aquarius transaction flows after stable simulation, receipt, and external-signer contracts are documented.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), and [docs/threat-model.md](docs/threat-model.md) before changing payment logic.

## License

MIT. See [LICENSE](LICENSE).

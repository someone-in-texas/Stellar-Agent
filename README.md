`stellar-agent-bridge` is an open-source CLI and local wallet bridge for safe agentic payments on Stellar. It gives developers and AI agents a Testnet-first way to create wallets, fund accounts, run payments, inspect ledger data, enforce spend policies, and produce auditable receipts - with guarded Mainnet support when users are ready.

[![CI](https://github.com/example/stellar-agent-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/example/stellar-agent-bridge/actions)

## Status

This repository is an early v0 implementation. Core primitives, policy evaluation, local receipt logging, Testnet wallet creation, Friendbot funding, basic Testnet payment submission, issued-asset trustlines, claimable balances, local approval bridge requests, local x402-style and MPP one-time Testnet demos, MCP tools, Codex plugin validation, and the CLI command surface are present. Mainnet payment submission intentionally remains blocked until real-funds approval work is complete.

## Safety First

- Testnet is the default.
- Mainnet is disabled by default and cannot auto-sign payments.
- Secret keys are redacted from CLI output, logs, and receipts.
- Policy evaluation runs before payment submission.
- Staged features exit with code `8` instead of attempting hidden payment work.

## 10-Minute Quickstart

```bash
npm install -g stellar-agent-bridge
stellar-agent testnet init
stellar-agent testnet smoke-test
stellar-agent receipts latest
```

Local checkout workflow:

```bash
pnpm install
pnpm build
pnpm test
pnpm cli -- testnet init --no-fund
pnpm cli -- testnet smoke-test --dry-run --json
LIVE_STELLAR_TESTNET=1 pnpm verify:live:testnet
```

## CLI Examples

```bash
stellar-agent profile list --json
stellar-agent testnet doctor
stellar-agent wallet create-testnet agent --json
stellar-agent wallet create-testnet funded-agent --fund --json
stellar-agent wallet create-testnet merchant --json
stellar-agent wallet import-public --name treasury --network mainnet --address G... --json
stellar-agent wallet connect-freighter --json
stellar-agent wallet trustline list --account merchant --json
stellar-agent wallet trustline add --account merchant --asset USD:G... --json
stellar-agent testnet scenario issued-asset-payment --json
stellar-agent policy explain --to G... --amount 1 --asset XLM --json
stellar-agent pay quote --to G... --amount 1 --asset XLM --json
stellar-agent approval create-payment --to G... --amount 6 --json
stellar-agent approval create-transaction --xdr AAAA... --summary "Sign contract transaction" --network testnet --json
stellar-agent approval decide appr_... --approve --json
stellar-agent tx request-payment-signature --from treasury --to G... --amount 1 --json
stellar-agent tx submit-approval appr_... --json
stellar-agent pay send --to G... --amount 1 --asset XLM --profile testnet
stellar-agent pay send --from issuer --to G... --amount 1 --asset USD:G...ISSUER --json
stellar-agent claimable create --to G... --amount 1 --json
stellar-agent claimable claim --account merchant --balance-id 0000... --json
stellar-agent ledger payments --account agent --json
stellar-agent ledger export --output ./ledger-report.json
stellar-agent contract doctor --json
stellar-agent testnet scenario contract-asset-smoke --json
stellar-agent contract invoke --id C... --source agent --fn hello --arg to=world --json
stellar-agent contract upload --source agent --wasm ./contract.wasm --json
stellar-agent contract deploy --source agent --wasm ./contract.wasm --json
stellar-agent contract asset-deploy --source agent --asset native --json
stellar-agent contract extend --source agent --id C... --ledgers-to-extend 535679 --json
stellar-agent contract restore --source agent --id C... --json
stellar-agent testnet scenario x402-payment --json
stellar-agent pay x402 http://127.0.0.1:PORT/paid-report --allow-localhost-demo --json
stellar-agent pay mpp http://127.0.0.1:PORT/mpp-report --allow-localhost-demo --json
```

## Agent Integration

Agents should call the CLI with `--json`, parse the standard envelope, and stop on `requires_approval` unless the user explicitly approves. Example prompt:

> Run `stellar-agent testnet doctor --json`, initialize Testnet if needed, run a dry-run smoke test, and summarize the latest receipt without printing secrets.

## Architecture

The project is CLI-first with shared packages underneath:

- `@stellar-agent/core` for types, amounts, errors, config, and redaction.
- `@stellar-agent/policy` for policy schema and deterministic decisions.
- `@stellar-agent/stellar` for Friendbot, Horizon, wallets, and Testnet payments.
- `@stellar-agent/freighter-bridge` for local approval request storage and HTTP bridge APIs.
- Stellar CLI integration for Soroban contract invocation when `stellar` is installed.
- `@stellar-agent/testnet-suite` for reusable Testnet workflows.
- `@stellar-agent/ledger-logger` for receipts and JSONL event logs.
- `@stellar-agent/mcp-server` for MCP stdio tools that delegate to `stellar-agent --json`.
- `@stellar-agent/codex-plugin` for bundled Codex plugin validation and manifests.
- `@stellar-agent/cli` for command registration and terminal behavior.

## Mainnet

Mainnet uses real funds. It is disabled by default, requires explicit enablement, and payment submission remains blocked in v0. See [docs/mainnet-safety.md](docs/mainnet-safety.md).

## Roadmap

1. Freighter browser-extension signing in the local approval UI.
2. Production facilitator-backed x402/MPP support.
3. Guarded Mainnet payment approval flow.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), and [docs/threat-model.md](docs/threat-model.md) before changing payment logic.

## License

MIT. See [LICENSE](LICENSE).

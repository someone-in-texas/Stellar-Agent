`stellar-agent-bridge` is an open-source CLI and local wallet bridge for safe agentic payments on Stellar. It gives developers and AI agents a Testnet-first way to create wallets, fund accounts, run payments, inspect ledger data, enforce spend policies, and produce auditable receipts - with guarded Mainnet support when users are ready.

[![CI](https://github.com/example/stellar-agent-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/example/stellar-agent-bridge/actions)

## Status

This repository is an early v0 implementation. Core primitives, policy evaluation, local receipt logging, Testnet wallet creation, Friendbot funding, basic Testnet payment submission, and the CLI command surface are present. x402, MPP, Freighter, MCP, and Mainnet payment flows intentionally return stable placeholder errors until their safety work is complete.

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
```

## CLI Examples

```bash
stellar-agent profile list --json
stellar-agent testnet doctor
stellar-agent wallet create-testnet agent --json
stellar-agent policy explain --to G... --amount 1 --asset XLM --json
stellar-agent pay quote --to G... --amount 1 --asset XLM --json
stellar-agent pay send --to G... --amount 1 --asset XLM --profile testnet
```

## Agent Integration

Agents should call the CLI with `--json`, parse the standard envelope, and stop on `requires_approval` unless the user explicitly approves. Example prompt:

> Run `stellar-agent testnet doctor --json`, initialize Testnet if needed, run a dry-run smoke test, and summarize the latest receipt without printing secrets.

## Architecture

The project is CLI-first with shared packages underneath:

- `@stellar-agent/core` for types, amounts, errors, config, and redaction.
- `@stellar-agent/policy` for policy schema and deterministic decisions.
- `@stellar-agent/stellar` for Friendbot, Horizon, wallets, and Testnet payments.
- `@stellar-agent/testnet-suite` for reusable Testnet workflows.
- `@stellar-agent/ledger-logger` for receipts and JSONL event logs.
- `@stellar-agent/cli` for command registration and terminal behavior.

## Mainnet

Mainnet uses real funds. It is disabled by default, requires explicit enablement, and payment submission remains blocked in v0. See [docs/mainnet-safety.md](docs/mainnet-safety.md).

## Roadmap

1. Harden Testnet suite and receipt export.
2. Freighter Testnet approval bridge.
3. Codex plugin packaging.
4. Local x402 Testnet demo.
5. MPP one-time Testnet demo.
6. Guarded Mainnet readiness.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), and [docs/threat-model.md](docs/threat-model.md) before changing payment logic.

## License

MIT. See [LICENSE](LICENSE).

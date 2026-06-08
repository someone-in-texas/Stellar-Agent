# @stellar-agent/cli

[![npm](https://img.shields.io/npm/v/@stellar-agent/cli.svg)](https://www.npmjs.com/package/@stellar-agent/cli)

Testnet-first command line interface for safe agentic payments, policies, receipts, approvals, Stellar contract workflows, DeFi preflight, and market-liquidity investigation.

## Install

```bash
npm install -g @stellar-agent/cli
stellar-agent --help
```

You can also run it without a global install:

```bash
npx @stellar-agent/cli testnet doctor --json
```

## Quickstart

```bash
stellar-agent testnet init
stellar-agent testnet smoke-test --json
stellar-agent receipts latest --json
```

The CLI defaults to Stellar Testnet. Generated local wallets are Testnet-only. Mainnet is disabled by default and local Mainnet auto-signing is blocked.

JSON Schema files for key `--json` payloads are included in the package under `schemas/cli`, for example `@stellar-agent/cli/schemas/cli/pay-quote.schema.json` and `@stellar-agent/cli/schemas/cli/envelope.schema.json`.

## Common Workflows

```bash
stellar-agent wallet create-testnet agent --fund --json
stellar-agent pay quote --to G... --amount 1 --asset XLM --json
stellar-agent pay send --to G... --amount 1 --asset XLM --json
stellar-agent approval create-payment --to G... --amount 6 --json
stellar-agent approval open --port 8787 --token <session-token> --json
stellar-agent tx request-payment-signature --from treasury --to G... --amount 1 --json
stellar-agent approval sign-walletconnect appr_... --wallet lobstr --project-id "$WALLETCONNECT_PROJECT_ID" --json
stellar-agent tx submit-approval appr_... --json
stellar-agent demo market-aquarius --json
stellar-agent demo x402 --out ./demo-x402 --json
stellar-agent demo approval-flow --json
stellar-agent defi blend preflight --pool TestnetV2 --account agent --request supply_collateral:USDC:1 --json
stellar-agent defi aquarius swap preflight --from XLM --to AQUA --amount 0.01 --slippage-bps 100 --json
stellar-agent market listen config --file ./alerts.yaml --json
```

## Command Map

| Command Group | Use For |
| --- | --- |
| `testnet` | Initialize, diagnose, fund, smoke-test, and run Testnet scenarios. |
| `wallet` | Create Testnet wallets, import watch-only wallets, inspect balances, manage trustlines, and inspect WalletConnect signer sessions. |
| `pay` | Quote, send, batch, x402-demo, and MPP-demo payments. |
| `demo` | Create or summarize safe Testnet proof bundles for x402, approval flow, and market/Aquarius preflight. |
| `approval` | Create, list, decide, serve, inspect, and externally sign local approval requests. |
| `tx` | Build, request signatures for, and submit signed XDR. |
| `defi` | Inspect and preflight Blend and Aquarius workflows. |
| `market` | Inspect core Stellar liquidity pools, preflight LP actions, and run finite or config-file listeners. |
| `contract` | Run Stellar CLI-backed Soroban contract workflows. |
| `ledger` and `receipts` | Inspect ledgers, effects, payments, reports, and local receipts. |
| `policy` | Write, check, print, and explain policy decisions. |

`stellar-agent policy init --network local` writes `default-local.yaml`; Testnet and Mainnet defaults use `default-testnet.yaml` and `default-mainnet.yaml`.

## Safety

- Testnet is the default.
- Mainnet requires explicit enablement and real-funds flags.
- Secret keys are redacted from CLI output, logs, and receipts.
- Policy checks run before submitted payment and protocol workflows.
- WalletConnect and Freighter flows are external signing only; `tx submit-approval` remains the submission and receipt path.
- Aquarius commands in this release are read-only or preflight-only.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- npm: https://www.npmjs.com/package/@stellar-agent/cli
- GitHub releases: https://github.com/someone-in-texas/Stellar-Agent/releases
- Mainnet safety: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/mainnet-safety.md
- Troubleshooting: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/troubleshooting.md

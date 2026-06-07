# @stellar-agent/cli

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

## Common Workflows

```bash
stellar-agent wallet create-testnet agent --fund --json
stellar-agent pay quote --to G... --amount 1 --asset XLM --json
stellar-agent pay send --to G... --amount 1 --asset XLM --json
stellar-agent approval create-payment --to G... --amount 6 --json
stellar-agent tx request-payment-signature --from treasury --to G... --amount 1 --json
stellar-agent defi blend preflight --pool TestnetV2 --account agent --request supply_collateral:USDC:1 --json
stellar-agent defi aquarius swap preflight --from XLM --to AQUA --amount 0.01 --slippage-bps 100 --json
```

## Safety

- Testnet is the default.
- Mainnet requires explicit enablement and real-funds flags.
- Secret keys are redacted from CLI output, logs, and receipts.
- Policy checks run before submitted payment and protocol workflows.
- Aquarius commands in `0.4.x` are read-only or preflight-only.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Mainnet safety: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/mainnet-safety.md
- Troubleshooting: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/troubleshooting.md

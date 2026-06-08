# Demo Bundles

`stellar-agent demo` commands are safe Testnet-first proof bundles. They are designed for quick package evaluation and agent smoke tests without Mainnet auto-signing.

## x402

```bash
stellar-agent demo x402 --out ./demo-x402 --json
X402_DESTINATION=G... npm --prefix ./demo-x402 start
stellar-agent pay x402 http://127.0.0.1:8787/paid-report --allow-localhost-demo --json
```

The generated server verifies `X-Payment` proofs through Testnet Horizon before serving paid content.

## Approval Flow

```bash
stellar-agent demo approval-flow --json
stellar-agent approval serve
stellar-agent approval decide appr_... --approve --json
stellar-agent pay send --to G... --amount 1 --asset XLM --approval-id appr_... --json
```

The demo creates a local approval request only. Payment submission still requires the approval id and normal policy checks.

## Market And Aquarius

```bash
stellar-agent demo market-aquarius --json
```

The output includes copyable Testnet commands for core market inspection, core LP preflight, Aquarius deployment inspection, and Aquarius swap preflight. It also includes a local Aquarius policy preview. The command does not sign or submit liquidity or Aquarius transactions.

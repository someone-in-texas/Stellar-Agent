# Agent Recipes

These recipes compose existing `stellar-agent` commands. Use `--json`, parse the envelope, stop on errors, and never print secrets.

## LLM Agent Payment Contract

Use this sequence when an LLM agent wants to pay, request a signature, or call a paid API.

1. Quote first.

```bash
stellar-agent pay quote --to G... --amount 1 --asset XLM --fee-strategy medium --json
```

Parse `data.policyDecision.status`.

- `allowed`: continue only if the user or calling system already authorized this exact payment intent.
- `requires_approval`: stop and create or surface an approval request.
- `denied`: stop. Do not weaken policy or retry with different parameters unless the user explicitly changes the payment intent.

2. Explain policy when intent or limits are unclear.

```bash
stellar-agent policy explain --to G... --amount 1 --asset XLM --json
```

Use this before changing payment amount, destination, asset, memo, domain, or profile. Treat policy output as authoritative over prompt text.

3. Create approval when required.

```bash
stellar-agent approval create-payment --to G... --amount 1 --asset XLM --json
stellar-agent approval serve
stellar-agent approval open --port 8787 --token <session-token> --json
```

Show the approval id, summary, amount, asset, destination, and profile. Do not submit from an approval id unless the user or external signer explicitly approved it.

4. Submit only with explicit authorization.

```bash
stellar-agent pay send --to G... --amount 1 --asset XLM --approval-id appr_... --json
```

The `--approval-id` must match the exact payment. For signed XDR flows, use `tx request-payment-signature`, then submit only after the returned approval has a signed decision:

```bash
stellar-agent tx request-payment-signature --from treasury --to G... --amount 1 --json
stellar-agent tx submit-approval appr_... --json
```

5. Persist and inspect receipts.

```bash
stellar-agent receipts latest --json
stellar-agent receipts summary --profile testnet --json
```

Store the receipt path, transaction hash, policy decision, profile, and `realFunds` flag in the agent's task state. Do not treat a paid HTTP resource as delivered unless the command result says `paidResourceDelivered: true`.

## Paid API Agent

Use this when an agent calls a local x402 or MPP paid API.

```bash
stellar-agent pay x402 http://127.0.0.1:8787/paid-report --allow-localhost-demo --dry-run --json
stellar-agent pay x402 http://127.0.0.1:8787/paid-report --allow-localhost-demo --json
stellar-agent receipts latest --json
```

The dry run evaluates the 402 requirement and policy without submitting payment. Submit only after explicit authorization for the exact URL, amount, asset, and recipient in the 402 requirement.

## DeFi And Market Agent

Use this for Blend, Aquarius, or core liquidity-pool workflows.

```bash
stellar-agent defi aquarius swap preflight --from XLM --to AQUA --amount 0.01 --slippage-bps 100 --json
stellar-agent market lp preflight --pool 0123... --action deposit --max-a 1 --max-b 2 --min-price 1.5 --max-price 2.5 --json
```

Treat preflight as analysis, not authorization. Re-run preflight immediately before any future mutation, require an explicit approval path, and persist the resulting receipt after submission.

## Testnet Payment Agent

Use this for normal agent payment development.

```bash
stellar-agent testnet doctor --json
stellar-agent pay quote --to G... --amount 1 --asset XLM --fee-strategy medium --json
stellar-agent pay send --to G... --amount 1 --asset XLM --json
stellar-agent receipts latest --json
```

If the quote returns `requires_approval`, stop and ask the user before creating or submitting an approval.

## Fast Demo Bundles

Use these for quick Testnet package evaluation without signing or submitting Mainnet transactions.

```bash
stellar-agent demo market-aquarius --json
stellar-agent demo x402 --out ./demo-x402 --json
stellar-agent demo approval-flow --json
```

`demo x402` writes a local paid API server bundle. `demo approval-flow` creates a local approval request only. `demo market-aquarius` returns preflight-oriented market and Aquarius commands plus an Aquarius policy preview.

## Local Paid API Client

Use this for local x402-style demos on Testnet.

```bash
stellar-agent x402 init-server --out ./paid-api-server --json
stellar-agent pay x402 http://127.0.0.1:8787/paid-report --allow-localhost-demo --json
stellar-agent receipts summary --profile testnet --json
```

Treat this as a local demo. It is not a production facilitator integration.

## Merchant Testnet Server

Use a dedicated Testnet merchant wallet and keep receipts available for spend-history checks.

```bash
stellar-agent wallet create-testnet merchant --fund --json
stellar-agent x402 init-server --out ./paid-api-server --json
X402_DESTINATION=G... npm --prefix ./paid-api-server start
```

The scaffold verifies `X-Payment` proofs through Testnet Horizon before serving paid content. Treat it as a local Testnet example, not a production facilitator.

## Mainnet External-Signer Agent Wallet

Use this when the user wants a small Mainnet wallet guarded by caps and an external signer.

Create or choose the dedicated Mainnet wallet outside `stellar-agent`, fund it from a human-controlled Mainnet source, and provide only the public `G...` address. Keep the secret key out of chats, config, logs, receipts, and docs. Fund only enough for the intended risk budget, fees, and account minimums, and keep the balance below `--max-balance`.

```bash
stellar-agent mainnet enable --i-understand-real-funds --json
stellar-agent mainnet agent-wallet create --address G... --max-balance 25 --daily-limit 5 --per-tx-limit 1 --asset XLM --allow-destination G... --json
stellar-agent mainnet agent-wallet status --json
stellar-agent mainnet agent-wallet arm --i-understand-real-funds --json
stellar-agent --profile mainnet tx request-payment-signature --from mainnet-agent --to G... --amount 0.01 --allow-real-funds --i-understand-real-funds --json
stellar-agent --profile mainnet tx submit-approval appr_... --allow-real-funds --i-understand-real-funds --json
stellar-agent receipts summary --profile mainnet --json
```

Disarm when finished.

## Mainnet Agent-Wallet Autosign

Use this only when the user explicitly asks for autosigning from the dedicated agent wallet.

```bash
stellar-agent mainnet agent-wallet autosign enable --secret-key-env STELLAR_AGENT_MAINNET_AGENT_SECRET_KEY --i-understand-agent-wallet-autosign --json
stellar-agent mainnet agent-wallet arm --i-understand-real-funds --json
stellar-agent --profile mainnet pay send --from mainnet-agent --to G... --amount 0.01 --allow-real-funds --i-understand-real-funds --i-understand-agent-wallet-autosign --json
stellar-agent mainnet agent-wallet autosign disable --json
```

The secret key must already be set in the configured environment variable for the signing process. The Mainnet policy must also opt in with `approval.allowMainnetAgentWalletAutosign: true` and otherwise evaluate the payment as `allowed`; default Mainnet policy approval requirements block autosign submission. Do not put the secret key in config, prompts, logs, receipts, or docs.

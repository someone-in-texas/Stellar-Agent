# Agent Recipes

These recipes compose existing `stellar-agent` commands. Use `--json`, parse the envelope, stop on errors, and never print secrets.

## Testnet Payment Agent

Use this for normal agent payment development.

```bash
stellar-agent testnet doctor --json
stellar-agent pay quote --to G... --amount 1 --asset XLM --fee-strategy medium --json
stellar-agent pay send --to G... --amount 1 --asset XLM --json
stellar-agent receipts latest --json
```

If the quote returns `requires_approval`, stop and ask the user before creating or submitting an approval.

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

Replace the scaffold verifier before using it outside a local Testnet experiment.

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

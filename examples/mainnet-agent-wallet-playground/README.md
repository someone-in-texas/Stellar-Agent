# Mainnet Agent-Wallet Playground

This example shows the v0.5.0 risk-budgeted Mainnet agent-wallet pattern without submitting live Mainnet transactions. It models a dedicated wallet, hard caps, arming/disarming, spend preflight, receipt-backed spend accounting, and fail-closed behavior.

This limits loss; it does not make autonomous spending safe.

## Safety Model

- The agent wallet is a dedicated Mainnet public key with a tiny balance.
- The app stores only the public key, risk budget, fingerprints, and receipt counters.
- Mainnet secrets stay outside `stellar-agent` unless the user explicitly opts into the separate env-var autosign flow.
- Arming records config and policy fingerprints. Any change requires re-arming.
- Receipts are the spend-accounting source of truth.
- Default tests and the demo never submit live Mainnet transactions.

## Run In 5 Minutes

```bash
pnpm install
pnpm build
cp examples/mainnet-agent-wallet-playground/.env.example examples/mainnet-agent-wallet-playground/.env
pnpm exec tsx examples/mainnet-agent-wallet-playground/src/playground.ts
pnpm test -- examples/mainnet-agent-wallet-playground/test/mainnet-agent-wallet-playground.test.ts
```

The demo script loads `examples/mainnet-agent-wallet-playground/.env` automatically before reading `STELLAR_AGENT_PLAYGROUND_ROOT`, `AGENT_WALLET_ADDRESS`, `AGENT_WALLET_DESTINATION`, `AGENT_WALLET_MAX_BALANCE`, `AGENT_WALLET_DAILY_LIMIT`, or `AGENT_WALLET_PER_TX_LIMIT`.

Expected output shape:

```json
{
  "ok": true,
  "status": {
    "configured": true,
    "status": "armed",
    "warning": "Mainnet agent-wallet spend is bounded, not safe..."
  },
  "preflight": {
    "realFunds": true,
    "submitLiveMainnetTransaction": false,
    "policyDecision": { "status": "requires_approval" }
  }
}
```

## Developer Flow

1. Create or choose a dedicated Mainnet wallet outside this app.
2. Fund it from a human-controlled wallet with only the tiny amount you are willing to risk.
3. Configure the public `G...` address, `maxBalance`, `dailyLimit`, `perTxLimit`, allowed asset, and destination allowlist.
4. Arm the wallet after reviewing the current config and policy.
5. Preflight each spend before any signer sees a transaction.
6. Record receipts after simulated or real settlement so daily/monthly counters remain grounded in durable history.
7. Disarm when the workflow is finished.

## Copy This Pattern Into Your App

Use `MainnetAgentWalletConfig` from `@stellar-agent/core` for the wallet record, `evaluatePaymentRequest` from `@stellar-agent/policy` for policy decisions, and `writeReceipt` / `spendHistoryFromReceipts` from `@stellar-agent/ledger-logger` for accounting. Keep the app-specific layer small: configure, arm, preflight, record, disarm.

Do not replace the CLI Mainnet guardrails with this example. This is a readable playground for app developers; production code should preserve the same fail-closed checks and use the guarded CLI or package APIs that write receipts.

## Failure Modes Demonstrated

- Wallet is disarmed.
- Payment exceeds the per-transaction cap.
- Receipt-backed daily total would exceed the daily cap.
- Asset is not allowed.
- Destination is not allowlisted.
- Receipt history is unreadable.
- Config or policy changed after arming.
- Wallet balance is above the configured max balance.

## Real-Funds Warnings

Simulated receipts set `network.realFunds: true` and include the warning string in operation details, while also recording `submitLiveMainnetTransaction: false`. This is intentional: developers should see real-funds risk in every Mainnet-mode artifact even when the example is not submitting transactions.

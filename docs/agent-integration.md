# Agent Integration

## Continuations and Ambiguous Outcomes

JSON success and error envelopes may include `continuation` with `intentId`, `transactionHash`, `changedOnChain`, `safeToRetry`, `approvalRequired`, and `nextActions`. Treat `safeToRetry: false` as authoritative. When `changedOnChain` is `"unknown"`, run `intent reconcile`; never infer that submission failed from a timeout or `NOT_FOUND` observation.

For durable jobs, pass a stable `--idempotency-key`, persist the returned intent id, and record the continuation instead of inferring retry safety from process exit alone.

## Signer and Soroban Capabilities

`@stellar-agent/core` exposes a provider-neutral `SignerCapabilities` shape. Freighter advertises transaction and Soroban authorization-entry signing; WalletConnect currently advertises transaction signing only. Capability discovery is descriptive, not proof that an account threshold is satisfied: signed envelopes are still cryptographically checked and the network remains authoritative for account thresholds.

Direct SDK consumers can use `signSorobanAuthorizationEntries` and must run `enforceSorobanTransaction` after inserting signed auth entries. Enforcing simulation is bound to the selected network passphrase and returns a transaction fingerprint and latest ledger. Rebuild, re-simulate, and obtain fresh authorization when the transaction or expiration changes.

Agents should use JSON mode:

```bash
stellar-agent testnet doctor --json
stellar-agent pay quote --to G... --amount 1 --asset XLM --fee-strategy medium --json
stellar-agent pay batch --file ./payments.json --dry-run --json
stellar-agent cache inspect --json
stellar-agent wallet trustline add --account merchant --asset USD:G... --json
stellar-agent testnet scenario issued-asset-payment --dry-run --json
stellar-agent wallet import-public --name treasury --network mainnet --address G... --json
stellar-agent claimable list --account merchant --json
stellar-agent testnet scenario x402-payment --json
stellar-agent pay x402 http://127.0.0.1:PORT/paid-report --allow-localhost-demo --json
stellar-agent pay mpp http://127.0.0.1:PORT/mpp-report --allow-localhost-demo --json
stellar-agent pay mpp-session http://127.0.0.1:PORT/mpp-session --requests 2 --allow-localhost-demo --json
stellar-agent approval sign-walletconnect appr_... --wallet lobstr --project-id "$WALLETCONNECT_PROJECT_ID" --json
stellar-agent tx submit-approval appr_... --json
stellar-agent testnet scenario contract-asset-smoke --dry-run --json
stellar-agent contract deploy --source agent --wasm ./contract.wasm --json
stellar-agent contract asset-deploy --source agent --asset native --json
stellar-agent contract info --kind interface --id C... --json
```

Published JSON Schemas for key `--json` payloads ship with `@stellar-agent/cli` under `schemas/cli`. Validate the common envelope with `envelope.schema.json`, then validate `data` with the command-specific schema. See [cli-json-schemas.md](cli-json-schemas.md).

For concrete LLM-agent call sequences, including quote-first payment, approval-required stops, explicit authorization, and receipt persistence, see [agent-recipes.md](agent-recipes.md).

The standard success envelope is:

```json
{ "ok": true, "data": {} }
```

The standard error envelope is:

```json
{
  "ok": false,
  "error": {
    "code": "POLICY_DENIED",
    "message": "...",
    "hint": "...",
    "docs": "docs/troubleshooting.md#policy-denied"
  }
}
```

Exit codes are stable: `0` success, `2` usage, `3` config or policy validation, `4` policy denied, `5` approval required or denied, `6` network unavailable, `7` transaction failed or timed out, and `8` not implemented.

Example agent prompt:

> Run `stellar-agent pay quote --json` before any payment, stop if approval is required, and never print secrets.

Speed guidance:

- Prefer `--fee-strategy medium` for normal Testnet/Mainnet submission and `high` or `p95` only when faster acceptance is worth the higher fee bid.
- Use `pay batch --dry-run --json` before bundled Testnet payments, then submit only when every per-payment policy decision is allowed.
- Use `--no-cache` when a long-running agent session needs fresh Horizon fee stats or readiness data.

Mainnet agent rule:

- Treat `MAINNET_NOT_ENABLED`, `APPROVAL_REQUIRED`, and `POLICY_DENIED` as stop conditions.
- Do not add `--allow-real-funds` or `--i-understand-real-funds` unless the user explicitly asks for that exact Mainnet action.
- Do not ask for or pass Mainnet secret keys. Use watch-only public wallets, browser-wallet approvals, Stellar CLI identities, or signed XDR.
- Use WalletConnect/LOBSTR only as a human external signer. Run `approval sign-walletconnect` to record signed XDR, then submit separately with `tx submit-approval`.
- For Mainnet signed-XDR submission, include the real-funds flags only after confirming the signed XDR came from a human-controlled Mainnet wallet.

Receipts are JSON files under `~/.stellar-agent/receipts`.

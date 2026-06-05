# Ledger Logging

## Receipt Verification

`stellar-agent receipts verify <path>` validates the receipt schema and checks that the receipt does not contain secret keys.

For online audit evidence, add `--ledger`:

```bash
stellar-agent receipts verify ./receipt.json --ledger --json
```

This looks up the receipt transaction hash on the receipt profile's Horizon endpoint and compares the returned hash, ledger number, and success status with the local receipt.

## Spend History

Payment policy decisions read local receipts before signing or submitting payment work. Successful allowed payment receipts are used to compute:

- Daily total for the current UTC day.
- Monthly total for the current UTC month.
- Known recipients.
- Known paid-resource domains.

If local receipt history cannot be read, payment policy evaluation fails closed with `spend_history_unreadable`. This keeps `dailyTotal`, `monthlyTotal`, `requireForNewRecipient`, and `requireForNewDomain` meaningful for agent-driven commands instead of relying only on per-transaction limits.

Receipts use schema version `stellar-agent.receipt.v1`.

Event logs are JSONL using schema version `stellar-agent.event.v1`.

Example event:

```json
{"schemaVersion":"stellar-agent.event.v1","event":"policy_decision","status":"allowed"}
```

Receipts include command, profile, network, policy decision, transaction hash, ledger fields when available, and redaction metadata. Payment receipts include a `payment` block. Non-payment transaction receipts, such as trustline, claimable-balance, submitting contract operations, and submitted Blend DeFi operations, include an `operation` block with the operation type and public metadata. Blend receipt metadata should include pool, reserve, action, amount, policy/preflight summaries, and decoded event summaries when available.

Redaction:

- Secret keys are redacted.
- URL query params are redacted.
- Receipts set `secretKeysIncluded: false`.

## Horizon Lookups

```bash
stellar-agent ledger tx <hash> --json
stellar-agent ledger payments --account agent --limit 10 --json
stellar-agent ledger effects --account merchant --limit 10 --json
stellar-agent ledger effects --tx <hash> --json
```

These commands read from Horizon and do not sign or submit transactions.

## Reports

```bash
stellar-agent ledger export --output ./ledger-report.json
stellar-agent testnet export-report --output ./testnet-report.json
```

Reports include local wallet public metadata, receipt summaries, storage paths, and event-log location. They do not include secret keys.

The live Testnet verifier confirms transaction lookup by hash, account payment history, transaction effects, payment receipt verification, operation receipt verification for trustline, claimable-balance, and contract submission transactions, and both report export commands after submitting real Testnet transactions.

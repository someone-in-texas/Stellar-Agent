# Ledger Logging

Receipts use schema version `stellar-agent.receipt.v1`.

Event logs are JSONL using schema version `stellar-agent.event.v1`.

Example event:

```json
{"schemaVersion":"stellar-agent.event.v1","event":"policy_decision","status":"allowed"}
```

Receipts include command, profile, network, policy decision, transaction hash, ledger fields when available, and redaction metadata. Payment receipts include a `payment` block. Non-payment transaction receipts, such as trustline, claimable-balance, and submitting contract operations, include an `operation` block with the operation type and public metadata.

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

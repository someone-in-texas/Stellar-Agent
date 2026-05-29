# Ledger Logging

Receipts use schema version `stellar-agent.receipt.v1`.

Event logs are JSONL using schema version `stellar-agent.event.v1`.

Example event:

```json
{"schemaVersion":"stellar-agent.event.v1","event":"policy_decision","status":"allowed"}
```

Receipts include command, profile, network, payment metadata, policy decision, transaction hash, ledger fields when available, and redaction metadata.

Redaction:

- Secret keys are redacted.
- URL query params are redacted.
- Receipts set `secretKeysIncluded: false`.

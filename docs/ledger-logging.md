# Ledger Logging

## Durable Execution Intents

Mutating payment and signed-XDR submission paths create `stellar-agent.intent.v1` records before signing or network submission. Intents carry a semantic operation hash, optional idempotency-key hash, policy and approval state, transaction metadata, submission attempts, spend reservations, and an explicit outcome. State transitions use cross-process locks and atomic replacement.

Use a stable `--idempotency-key` for retried `pay send` and `tx submit-xdr` jobs. If an intent reaches `signed`, `submitted`, or `confirmation_unknown`, the CLI will not blindly resubmit it:

```bash
stellar-agent intent list --json
stellar-agent intent show int_... --json
stellar-agent intent reconcile int_... --json
stellar-agent intent cancel int_... --json
```

Active reservations count against spend policy before submission and remain counted while an outcome is ambiguous. Corrupt intent state fails spend accounting closed.

## Integrity Chains

New receipts use `stellar-agent.receipt.v2`; events use `stellar-agent.event.v2`. Each stores a SHA-256 content hash and preceding-record hash. Existing v1 receipts remain readable.

```bash
stellar-agent receipts verify-chain --json
```

The chain detects alteration, forks, and missing interior records within retained state. Detecting deletion of the newest suffix requires retaining the latest hash independently; this is not an external timestamp or remote attestation.

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

New receipts use schema version `stellar-agent.receipt.v2`; legacy v1 receipts remain readable.

Event logs are JSONL using schema version `stellar-agent.event.v2`. Legacy v1 entries are permitted only as a prefix before the v2 chain begins.

Example event:

```json
{ "schemaVersion": "stellar-agent.event.v2", "event": "policy_decision", "status": "allowed", "contentHash": "..." }
```

Receipts include command, profile, network, policy decision, transaction hash, ledger fields when available, and redaction metadata. Payment receipts include a `payment` block. Non-payment transaction receipts, such as trustline, claimable-balance, submitting contract operations, and submitted Blend DeFi operations, include an `operation` block with the operation type and public metadata. Blend receipt metadata should include pool, reserve, action, amount, policy/preflight summaries, and decoded event summaries when available. Aquarius commands in this release are read-only or preflight-only, so they do not write transaction receipts unless a future submitted Aquarius flow is added.

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

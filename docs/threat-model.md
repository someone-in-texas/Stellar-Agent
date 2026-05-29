# Threat Model

## Assets Protected

- Secret keys.
- User funds.
- Policy files.
- Receipts and private URLs.
- Mainnet enablement state.

## Trusted Components

- Local CLI binary.
- Local policy files chosen by the user.
- Stellar SDK and Horizon endpoints for network operations.

## Untrusted Components

- Agent prompts and tool instructions.
- Paid APIs.
- Remote URLs.
- User-provided transaction data.

## Threats and Mitigations

- Agent prompt injection: policy and approval gates sit outside prompt text.
- Secret key leakage: output, logs, and receipts redact secret-like values.
- Policy weakening: agents are instructed not to weaken policy files.
- Overpayment: per-transaction, daily, and monthly limits are enforced.
- Replay or duplicate payment: retries are conservative and transaction submission is not blindly repeated.
- Redirect payment changes: x402/MPP will deny redirect payment changes by default when implemented.
- Paid but service fails: receipts capture transaction and command context.
- Log privacy leaks: URL query params are redacted by default.
- Mainnet/Testnet confusion: Mainnet is disabled and marked `realFunds: true`.
- Malicious paid API: domain allowlists and policy checks gate payment.
- Malicious contributor: tests and docs are required for safety-sensitive changes.

## Out of Scope

Hosted custody, mobile wallets, generalized blockchain indexing, and autonomous Mainnet spending are out of scope for v0.

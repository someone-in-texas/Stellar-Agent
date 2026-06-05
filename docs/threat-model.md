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
- Spend-history bypass: payment commands compute daily/monthly totals and known recipients/domains from local receipts before policy evaluation, and fail closed when receipt history is unreadable.
- Replay or duplicate payment: retries are conservative and transaction submission is not blindly repeated.
- Redirect payment changes: x402/MPP will deny redirect payment changes by default when implemented.
- Paid but service fails: receipts capture transaction and command context, and paid-resource command results distinguish settlement from resource delivery.
- Log privacy leaks: URL query params are redacted by default.
- Mainnet/Testnet confusion: Mainnet is disabled and marked `realFunds: true`; Mainnet signed-XDR submission and contract operations require explicit real-funds flags and refuse local Testnet wallet secrets.
- DeFi leverage risk: Blend borrow and protocol exposure are governed by explicit policy limits, minimum health-factor checks, and preflight simulation requirements.
- Malicious paid API: domain allowlists and policy checks gate payment.
- Local approval bridge abuse: the localhost bridge requires a per-session API token for request and decision APIs, rejects cross-origin writes, and bounds request body size.
- Malicious contributor: tests and docs are required for safety-sensitive changes.

## Out of Scope

Hosted custody, mobile wallets, generalized blockchain indexing, and autonomous Mainnet spending are out of scope for v0.

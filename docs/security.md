# Security Guide

## Reporting Vulnerabilities

Report vulnerabilities privately to maintainers.

## Key Handling

- Testnet secret keys may be stored in local Testnet wallet files.
- Mainnet secret-key storage is not implemented in v0.
- Secret keys must not be printed, logged, or written to receipts.

## Safety Defaults

- Testnet default profile.
- Mainnet disabled.
- Policy before payment.
- Receipt and event logging on successful payment flows.

## Review Checklist

- No raw secret keys in output.
- No Mainnet auto-signing.
- Policy denial prevents signing and submission.
- Placeholder features do not access secrets or submit transactions.

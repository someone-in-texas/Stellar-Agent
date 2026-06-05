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
- Third-party protocol SDKs stay in approved adapter packages and are not imported by shared payment, policy, receipt, or Mainnet guard code.

## Protocol SDK Boundaries

Protocol SDKs are treated as untrusted supply-chain inputs:

- SDK dependencies are declared only in approved adapter packages.
- SDK code is loaded lazily with dynamic `import()` inside adapter functions.
- CLI startup and shared packages do not statically import protocol SDKs.
- Mutating protocol commands run policy checks, simulation, Mainnet auto-signing blocks, and receipt logging before signing or submission.
- Release safety includes protocol SDK boundary checks.

## Review Checklist

- No raw secret keys in output.
- No Mainnet auto-signing.
- Policy denial prevents signing and submission.
- Unsupported production features fail closed and do not access secrets or submit transactions.
- Protocol SDK additions update `scripts/check-protocol-sdk-boundaries.mjs`, docs, and policy tests before release.

# Security Policy

## Reporting

Please report vulnerabilities privately to the maintainers. Do not open public issues for suspected secret leakage, policy bypass, signing bypass, or Mainnet safety problems.

## Safety Defaults

- Testnet is the default profile.
- Mainnet starts disabled.
- Mainnet payments cannot auto-sign in v0.
- Secret keys are redacted from output, logs, and receipts.
- Third-party protocol SDKs must stay inside approved adapter packages and must not be imported by shared payment, policy, receipt, or Mainnet guard code.

## Protocol SDK Boundaries

Protocol SDKs are treated as untrusted supply-chain inputs. Adding or updating DeFi protocol SDK support must preserve these rules:

- SDK dependencies are declared only in approved adapter packages.
- SDK code is loaded lazily with dynamic `import()` inside adapter functions.
- CLI startup and shared packages do not statically import protocol SDKs.
- Mutating protocol commands run policy checks, simulation, Mainnet auto-signing blocks, and receipt logging before signing or submission.
- `pnpm release:safety` must pass the protocol SDK boundary check before a release.

## Supported Versions

This project is pre-1.0. Security fixes target the latest main branch until versioned releases begin.

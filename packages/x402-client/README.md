# @stellar-agent/x402-client

Local x402-style client support for the Testnet demo.

This package implements a concrete local `402 -> policy -> Testnet payment -> retry with proof` flow. It is not a full facilitator-backed Soroban auth-entry x402 implementation yet.

## Install

```bash
npm install @stellar-agent/x402-client
```

## CLI Entry Points

```bash
stellar-agent testnet scenario x402-payment --json
stellar-agent pay x402 http://127.0.0.1:PORT/paid-report --allow-localhost-demo --json
```

## Safety

- This package is for local Testnet demos.
- `verifyX402PaymentProof` validates local x402 proofs against Testnet payment evidence: amount, asset, destination, source, resource, nonce, freshness, success, and replay state.
- Use Horizon-backed verification for real Testnet settlement checks. Mock verification is only for CI-safe demos and local examples.
- Production facilitator-backed x402 support is intentionally out of scope for this release.
- Payment policy and receipts are handled by the CLI flow before and after Testnet payment submission.

## Server Verification

```ts
import { verifyX402PaymentProof } from "@stellar-agent/x402-client";

const acceptedTransactions = new Set<string>();
const verification = await verifyX402PaymentProof({
  proof,
  requirement,
  acceptedTransactions,
  horizonUrl: "https://horizon-testnet.stellar.org"
});

if (!verification.ok) {
  // Return HTTP 402 with verification.error.
}
```

The helper fails closed when Horizon evidence is unavailable or when the transaction does not contain a matching payment operation.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Testnet quickstart: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/quickstart-testnet.md
- npm CLI package: https://www.npmjs.com/package/@stellar-agent/cli

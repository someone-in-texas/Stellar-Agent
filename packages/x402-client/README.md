# @stellar-agent/x402-client

Local x402-style Testnet demos plus a versioned production facilitator verification adapter.

The local `402 -> policy -> Testnet payment -> retry with proof` flow remains a demo. `verifyWithX402Facilitator` separately pins a production adapter to HTTPS, a network-passphrase hash, challenge, transaction, recipient, asset, amount, and an atomic persistent replay store.

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

- CLI flows are local Testnet demos; the facilitator verifier is a provider-neutral package API.
- `verifyX402PaymentProof` validates local x402 proofs against Testnet payment evidence: amount, asset, destination, source, resource, nonce, freshness, success, and replay state.
- Use Horizon-backed verification for real Testnet settlement checks. Mock verification is only for CI-safe demos and local examples.
- Facilitator responses remain untrusted. Deployments must authenticate the provider and independently reconcile settlement on Stellar.
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

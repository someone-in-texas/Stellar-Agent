# x402 and MPP

x402 and MPP describe HTTP-native payment workflows where an API can request payment before serving content.

## Current Support

This build includes a local x402-style Testnet demo:

```bash
stellar-agent testnet scenario x402-payment --json
```

It starts a local paid API, receives HTTP 402, evaluates policy, submits a Testnet payment, retries with an `X-Payment` proof header, and writes a receipt.

`stellar-agent pay x402 <url>` can pay compatible local demo resources. Default policy keeps x402 disabled; for localhost demos you can use:

```bash
stellar-agent pay x402 http://127.0.0.1:PORT/paid-report --allow-localhost-demo --json
```

The local protocol remains a Testnet fixture. For production integration, `@stellar-agent/x402-client` also exports a versioned facilitator adapter; it is intentionally separate from the local wire format.

The receipt records the ledger payment. The command result also includes `paidResourceDelivered`, which is `true` only when the paid-resource retry returns a 2xx HTTP status. If payment succeeds but the paid API still fails, the event log marks the receipt write as `paid_resource_failed` so agents do not confuse settlement with content delivery.

This build also includes local MPP one-time charge and session-budget demos. `stellar-agent pay mpp <url>` can pay compatible localhost MPP demo resources:

```bash
stellar-agent pay mpp http://127.0.0.1:PORT/mpp-report --allow-localhost-demo --json
```

`stellar-agent pay mpp-session <url>` pays a session budget once and then performs multiple authorized session requests:

```bash
stellar-agent pay mpp-session http://127.0.0.1:PORT/mpp-session --requests 2 --allow-localhost-demo --json
```

The local MPP wire format remains a demo. `@stellar-agent/mpp-client` provides durable cross-process session-budget accounting for production adapters.

## Facilitator Adapters

`verifyWithX402Facilitator` implements the `stellar-agent-facilitated-x402` version 1 verification contract. Callers pin the facilitator URL, network-passphrase hash, challenge id, and local proof. It requires HTTPS except for explicitly enabled loopback tests, disables redirects, independently matches settlement fields, and records accepted challenge/transaction pairs in an atomic persistent replay store. Corrupt replay state fails closed.

This is an adapter contract, not an endorsement of a specific facilitator. A deployment must still authenticate its facilitator, reconcile the returned hash against Stellar RPC or Horizon, and keep Mainnet behind normal real-funds and signer controls.

`reserveMppSessionDebit` persists `stellar-agent.mpp-session.v1` state and atomically checks and increments session spend. Bind each session to the exact network-passphrase hash, asset, recipient, facilitator origin, and budget; do not reuse state across those boundaries.

## Local x402 Demo

The local demo uses protocol marker `stellar-agent-local-x402`.

Flow:

1. Request URL.
2. Receive HTTP 402 payment requirements.
3. Parse and bind payment to URL/domain.
4. Evaluate policy.
5. Stop without payment and release the reservation if interactive approval would be required; approve a direct payment workflow first.
6. Pay on Testnet.
7. Retry request.
8. Write receipt.

The local demo binds proofs to the advertised resource and nonce, requires payer metadata, and rejects replay of a previously accepted transaction hash. Resource binding includes the URL origin, path, and query string, so a payment requirement for `?item=cheap` does not satisfy a request for `?item=expensive`.

The reusable verifier in `@stellar-agent/x402-client` can validate a proof against Horizon transaction evidence. It checks the transaction hash, one-use replay state, requirement freshness, payment success, payer, recipient, amount, asset, resource, nonce, and the challenge memo committed to the settled transaction. CI-safe examples can still use mocked settlement, but Horizon verification is the real Testnet path for merchant server examples.

The demo paid API is available under `examples/paid-api-demo`:

```bash
STELLAR_AGENT_DEMO_RECIPIENT=G... pnpm --filter @stellar-agent/paid-api-demo start
```

The generated scaffold from `stellar-agent x402 init-server` also includes a dependency-free Horizon verifier:

```bash
stellar-agent x402 init-server --out ./paid-api-server --json
X402_DESTINATION=G... X402_HORIZON_URL=https://horizon-testnet.stellar.org npm --prefix ./paid-api-server start
stellar-agent pay x402 http://127.0.0.1:8787/paid-report --allow-localhost-demo --json
```

## Local MPP Demo

One-time charge flow:

1. Parse one-time charge.
2. Evaluate policy.
3. Pay on Testnet.
4. Retry request.
5. Write receipt.

One-time MPP demo proofs are bound to the charge id and resource, require payer metadata, and are accepted only once per transaction hash. Resource binding includes the URL origin, path, and query string.

The command result includes `paidResourceDelivered` with the same meaning as the x402 demo.

## Local MPP Session Demo

Session-budget flow:

1. Parse session budget, price-per-request, recipient, and resource.
2. Evaluate policy against the full session budget.
3. Pay the session budget on Testnet.
4. Send an `X-MPP-Session` proof on each request.
5. The demo server tracks remaining budget by transaction hash.
6. Write a receipt for the budget transaction and log session request counts.

The demo paid API under `examples/paid-api-demo` starts x402, one-time MPP, and MPP session endpoints.

For MPP sessions, `paidResourceDelivered` is `true` only when every requested session call returns a 2xx status after the budget payment.

Production deployments should combine the facilitator contract, independent ledger reconciliation, durable debit state, explicit session-budget approval, and per-request receipt/event logging. The included local demo server does not become production-grade merely by supplying a public URL.

Stable idempotency keys identify the payment job independently of ephemeral x402 nonces, MPP charge ids, and MPP session ids. A confirmed retry never resubmits payment and reports `paidResourceDelivered: false` unless the resource was actually fetched in that invocation. Pre-sign recovery is lease-protected; signed, submitted, or ambiguous intents require reconciliation instead of rebuilding.

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

This is not yet a full facilitator-backed Soroban auth-entry x402 implementation.

The receipt records the ledger payment. The command result also includes `paidResourceDelivered`, which is `true` only when the paid-resource retry returns a 2xx HTTP status. If payment succeeds but the paid API still fails, the event log marks the receipt write as `paid_resource_failed` so agents do not confuse settlement with content delivery.

This build also includes local MPP one-time charge and session-budget demos. `stellar-agent pay mpp <url>` can pay compatible localhost MPP demo resources:

```bash
stellar-agent pay mpp http://127.0.0.1:PORT/mpp-report --allow-localhost-demo --json
```

`stellar-agent pay mpp-session <url>` pays a session budget once and then performs multiple authorized session requests:

```bash
stellar-agent pay mpp-session http://127.0.0.1:PORT/mpp-session --requests 2 --allow-localhost-demo --json
```

The local MPP flows are not production facilitator implementations.

## Local x402 Demo

The local demo uses protocol marker `stellar-agent-local-x402`.

Flow:

1. Request URL.
2. Receive HTTP 402 payment requirements.
3. Parse and bind payment to URL/domain.
4. Evaluate policy.
5. Request approval if needed.
6. Pay on Testnet.
7. Retry request.
8. Write receipt.

The local demo binds proofs to the advertised resource and nonce, requires payer metadata, and rejects replay of a previously accepted transaction hash.

The demo paid API is available under `apps/paid-api-demo`:

```bash
STELLAR_AGENT_DEMO_RECIPIENT=G... pnpm --filter @stellar-agent/paid-api-demo start
```

## Local MPP Demo

One-time charge flow:

1. Parse one-time charge.
2. Evaluate policy.
3. Pay on Testnet.
4. Retry request.
5. Write receipt.

One-time MPP demo proofs are bound to the charge id and resource, require payer metadata, and are accepted only once per transaction hash.

The command result includes `paidResourceDelivered` with the same meaning as the x402 demo.

## Local MPP Session Demo

Session-budget flow:

1. Parse session budget, price-per-request, recipient, and resource.
2. Evaluate policy against the full session budget.
3. Pay the session budget on Testnet.
4. Send an `X-MPP-Session` proof on each request.
5. The demo server tracks remaining budget by transaction hash.
6. Write a receipt for the budget transaction and log session request counts.

The demo paid API under `apps/paid-api-demo` starts x402, one-time MPP, and MPP session endpoints.

For MPP sessions, `paidResourceDelivered` is `true` only when every requested session call returns a 2xx status after the budget payment.

Production facilitator support is still future work. A production session flow should add facilitator verification, stronger anti-replay guarantees, explicit session budget approval, and per-request spending logs across processes.

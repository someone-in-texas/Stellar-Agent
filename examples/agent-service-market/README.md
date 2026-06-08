# Agent Service Market Example

This is the most demo-friendly v0.5.0 example: one seller agent exposes a tiny paid JSON service, and one buyer agent discovers it, checks local policy, pays with x402 on Stellar Testnet, and receives the result. Settlement is mocked by default so CI and local demos stay deterministic.

The point is agent-to-agent commerce with policy-bounded spending, not a full marketplace.

## Run In 5 Minutes

```bash
pnpm install
pnpm build
cp examples/agent-service-market/.env.example examples/agent-service-market/.env
pnpm exec tsx examples/agent-service-market/src/seller.ts
```

In another terminal:

```bash
curl http://127.0.0.1:8790/.well-known/agent-service.json
curl -i http://127.0.0.1:8790/premium-summary
pnpm exec tsx examples/agent-service-market/src/buyer.ts http://127.0.0.1:8790/.well-known/agent-service.json
```

Expected buyer output shape:

```json
{
  "ok": true,
  "data": {
    "service": {
      "id": "premium-summary",
      "protocol": "x402",
      "price": "0.0000002",
      "network": "testnet"
    },
    "result": {
      "firstStatus": 402,
      "finalStatus": 200,
      "policyDecision": { "status": "allowed" },
      "paidResourceDelivered": true
    }
  }
}
```

## Architecture

- Seller discovery lives at `/.well-known/agent-service.json`.
- The seller advertises one service: `premium-summary`.
- The paid endpoint returns HTTP `402` with a local x402 payment requirement.
- The buyer builds a policy for the seller domain, enforces x402 price and spend caps, mocks Testnet settlement, retries with `X-Payment`, and writes a normal receipt.
- Receipts are written under `.stellar-agent-service-market/receipts` by default.

## Seller Setup

Configure these values in `.env` or the process environment:

- `SELLER_RECIPIENT`: Testnet recipient public key.
- `SERVICE_PRICE`: price per paid call, default `0.0000002`.
- `SERVICE_ASSET`: usually `XLM`.
- `PORT`: seller server port, default `8790`.

Replace the toy JSON in `src/seller.ts` with your real paid service result. Keep the payment requirement bound to the exact paid endpoint URL.

## Buyer Setup

The buyer uses `buyerPolicyForService` in `src/buyer.ts` to allow only the discovered seller domain. Tighten `maxPricePerRequest`, `dailyTotal`, and `monthlyTotal` for your agent budget.

Use `latestReceipt` or `stellar-agent receipts latest --json` to inspect the payment record after a successful call.

## Policy And Receipts

Buyer policy denial happens before settlement. If the seller asks for a domain or price outside policy, the buyer stops with `POLICY_DENIED`.

Seller verification failure happens after mocked settlement in this demo. The buyer still writes a receipt showing the transaction and `paidResourceDelivered: false` in the client result so operators can distinguish settlement from service delivery.

## Replacing The Toy Service

Copy these pieces into your own API:

1. Seller discovery document with `id`, `endpoint`, `price`, `asset`, `recipient`, and `protocol`.
2. Paid endpoint that returns x402 `Payment-Required` on first request.
3. Buyer discovery and `runX402Payment` call.
4. Policy caps for allowed domain, max price, and daily/monthly spend.
5. Receipt checks after each paid call.

MPP is a natural variant for session budgets or multiple partial payments. This example implements x402 first to stay readable; adapt it with `@stellar-agent/mpp-client` when the service needs one payment to cover several requests.

## Tests

```bash
pnpm test -- examples/agent-service-market/test/agent-service-market.test.ts
```

The tests cover service discovery, 402 negotiation, buyer policy denial, successful paid call, receipt creation, spend cap exhaustion, and seller-side verification failure.

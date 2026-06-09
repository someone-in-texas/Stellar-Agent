# x402 Paid API Example

This example is the smallest useful x402-style paid API in the repo: one free Express endpoint, one paid endpoint, and a buyer client that evaluates local `stellar-agent` policy before paying on Stellar Testnet. Settlement is mocked by default so the example is reliable in CI and safe to run without Mainnet or real funds; set `X402_VERIFICATION_MODE=horizon` to verify Testnet payment evidence through Horizon.

## Run In 5 Minutes

```bash
pnpm install
pnpm build
cp examples/x402-paid-api/.env.example examples/x402-paid-api/.env
pnpm exec tsx examples/x402-paid-api/src/server.ts
```

The server and client scripts load `examples/x402-paid-api/.env` automatically before reading `PORT`, `X402_PRICE`, `X402_ASSET`, `X402_RECIPIENT`, `X402_VERIFICATION_MODE`, `X402_HORIZON_URL`, `X402_FACILITATOR_URL`, or `STELLAR_AGENT_EXAMPLE_ROOT`.

In another terminal:

```bash
curl http://127.0.0.1:8787/free
curl -i http://127.0.0.1:8787/paid
pnpm exec tsx examples/x402-paid-api/src/client.ts http://127.0.0.1:8787/paid
```

Expected output shape:

```json
{
  "ok": true,
  "data": {
    "url": "http://127.0.0.1:8787/paid",
    "result": {
      "firstStatus": 402,
      "finalStatus": 200,
      "policyDecision": { "status": "allowed" },
      "paidResourceDelivered": true
    },
    "latestReceipt": {
      "receipt": {
        "profile": "testnet",
        "network": { "realFunds": false }
      }
    }
  }
}
```

## How It Works

Pricing is configured with `X402_PRICE`, `X402_ASSET`, and `X402_RECIPIENT` in `.env`. The default price is `0.0000001 XLM` on Testnet.

`src/server.ts` generates an HTTP `402` response for `/paid` with a `Payment-Required` header and JSON body. The requirement includes the Testnet recipient, amount, asset, resource URL, nonce, challenge memo, issue time, and expiry time.

`src/client.ts` uses `runX402Payment` from `@stellar-agent/x402-client`. The client builds a Testnet policy that allows only the paid API domain, enforces the x402 price cap, performs mocked local settlement, retries the API with an `X-Payment` proof, and writes a normal `stellar-agent` receipt.

Receipts are written under `.stellar-agent-x402-example/receipts` by default:

```bash
ls .stellar-agent-x402-example/receipts
cat .stellar-agent-x402-example/receipts/*.json
STELLAR_AGENT_HOME=.stellar-agent-x402-example stellar-agent receipts latest --json
```

## Copy This Into Your Own API

1. Copy the `/paid` route from `src/server.ts`.
2. Set `recipient`, `amount`, and `asset` from your service config.
3. Keep the `resource` URL bound to the exact paid URL.
4. Verify the `X-Payment` proof before returning paid content. Use `verificationMode: "horizon"` for real Testnet settlement checks.
5. Use `runX402Payment` or the CLI `stellar-agent pay x402 <url> --allow-localhost-demo --json` on the buyer side.

## Verification Modes

The default `verificationMode: "mock"` checks proof shape, requirement freshness, and replay protection against mocked settlement evidence.

For the real Testnet path, set:

```bash
X402_VERIFICATION_MODE=horizon
X402_HORIZON_URL=https://horizon-testnet.stellar.org
```

Horizon mode verifies that the submitted transaction succeeded, contains the challenge memo from the x402 requirement, and includes a payment operation matching the payer, destination, amount, and asset.

To experiment with a facilitator, set `X402_VERIFICATION_MODE=facilitator` and `X402_FACILITATOR_URL=<url>`, then replace `verifyWithFacilitator` with your facilitator's verification contract. Keep policy evaluation and receipt writing on the client side.

## Tests

```bash
pnpm test -- examples/x402-paid-api/test/x402-paid-api.test.ts
```

The tests cover 402 negotiation, denied policy, successful paid request, receipt creation, and JSON error behavior.

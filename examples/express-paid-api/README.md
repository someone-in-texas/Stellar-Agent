# Express Paid API Example

The local paid API demo now lives in `examples/paid-api-demo`.

Run it with a Testnet recipient:

```bash
STELLAR_AGENT_DEMO_RECIPIENT=G... pnpm --filter @stellar-agent/paid-api-demo start
```

It exposes `/paid-report` for the local x402-style flow and `/mpp-report` for the local MPP one-time charge flow.

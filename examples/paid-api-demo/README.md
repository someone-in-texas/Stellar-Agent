# Paid API Demo

Local `stellar-agent-local-x402` demo server.

```bash
STELLAR_AGENT_DEMO_RECIPIENT=G... pnpm --filter @stellar-agent/paid-api-demo start
```

The server starts two local endpoints:

- `/paid-report` for the local x402-style demo. First access returns HTTP 402 with a JSON payment requirement. A retry with `X-Payment` containing a transaction proof unlocks the JSON response.
- `/mpp-report` for the local MPP one-time charge demo. First access returns HTTP 402 with a JSON charge. A retry with `X-MPP-Payment` containing a transaction proof unlocks the JSON response.
- `/mpp-session` for the local MPP session-budget demo. First access returns HTTP 402 with a session budget. A retry with `X-MPP-Session` containing the budget payment proof unlocks repeated responses until the budget is exhausted.

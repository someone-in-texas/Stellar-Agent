# Mainnet Safety

Mainnet uses real funds.

Defaults:

- Mainnet is disabled.
- Mainnet auto-approval is disabled.
- Mainnet payment submission is blocked in v0.
- Mainnet policies require explicit approval.
- JSON output includes `realFunds: true` for Mainnet status.

Enablement requires:

```bash
stellar-agent mainnet enable --i-understand-real-funds
```

Recommended signing model:

- Use Freighter or another human approval flow.
- Show transaction explanation before signing.
- Keep Mainnet secret keys out of local plaintext files.

Readiness checklist:

- Policy requires approval for all Mainnet payments.
- Receipts are enabled.
- Logs are redacted.
- The user understands real funds are involved.

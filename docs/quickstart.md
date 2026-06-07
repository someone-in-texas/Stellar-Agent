# Quickstart

Goal: local checkout to first Testnet payment in 10 minutes.

```bash
pnpm install
pnpm build
pnpm cli -- testnet init
pnpm cli -- testnet smoke-test
pnpm cli -- receipts latest
```

GitHub releases include verified package tarballs, and npm publication is handled by the protected trusted-publishing workflow. See `docs/distribution.md` for the release and install-artifact policy.

Expected shape:

```json
{
  "ok": true,
  "data": {
    "receiptPath": "/home/user/.stellar-agent/receipts/rec_...",
    "transaction": {
      "hash": "...",
      "successful": true
    }
  }
}
```

For a dry-run smoke check:

```bash
pnpm cli -- testnet init --no-fund
pnpm cli -- testnet smoke-test --dry-run --json
```

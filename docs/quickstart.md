# Quickstart

Goal: install to first Testnet payment in 10 minutes.

```bash
npm install -g stellar-agent-bridge
stellar-agent testnet init
stellar-agent testnet smoke-test
stellar-agent receipts latest
```

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

For local development:

```bash
pnpm install
pnpm build
pnpm cli -- testnet init --no-fund
pnpm cli -- testnet smoke-test --dry-run --json
```

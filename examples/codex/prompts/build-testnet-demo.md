Run `stellar-agent testnet doctor --json`, initialize Testnet if needed with `stellar-agent testnet init --json`, then run these offline checks and summarize results without printing secrets:

- `stellar-agent testnet smoke-test --dry-run --json`
- `stellar-agent testnet scenario issued-asset-payment --dry-run --json`

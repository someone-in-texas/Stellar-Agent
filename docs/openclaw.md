# OpenClaw

Any shell-capable agent can call `stellar-agent`.

Suggested prompt:

> Use `stellar-agent --json` commands only. Run `testnet doctor`, initialize Testnet if needed, run a dry-run smoke test, and summarize receipt metadata without printing secrets.

Parse the `ok` field before reading `data`. Treat `APPROVAL_REQUIRED`, `POLICY_DENIED`, and `MAINNET_NOT_ENABLED` as stop conditions.

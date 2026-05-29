# Stellar Agent Testnet

Use this skill when asked to run Testnet workflows with `stellar-agent`.

Workflow:

1. Run `stellar-agent testnet doctor --json`.
2. If local state is missing, run `stellar-agent testnet init`.
3. Run `stellar-agent testnet smoke-test --json` when the user wants a live Testnet payment.
4. Use `stellar-agent testnet smoke-test --dry-run --json` for offline validation.
5. Summarize receipt metadata only when asked.

Safety:

- Prefer Testnet.
- Never print secret keys.
- Never enable Mainnet without explicit user request.
- Do not weaken policy files.

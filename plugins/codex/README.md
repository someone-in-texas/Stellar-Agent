# Stellar Agent Bridge Codex Plugin

This plugin teaches Codex to use `stellar-agent` safely.

Install once plugin packaging is finalized, then use prompts from `examples/codex/prompts`.

Rules:

- Prefer Testnet.
- Use `--json`.
- Run quote or policy explain before payments.
- Stop on approval-required results.
- Never print secrets.
- Never enable Mainnet unless the user explicitly asks.

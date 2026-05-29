# Codex Plugin

The Codex plugin files live under `plugins/codex`.

Skills:

- `stellar-agent-testnet` teaches Testnet initialization, doctor checks, smoke tests, and receipt summaries.
- `stellar-agent-payments` teaches quote-first payment workflows and approval stops.

Example prompts are in `examples/codex/prompts`.

Safety expectations:

- Prefer Testnet.
- Use `--json`.
- Never print secrets.
- Never enable Mainnet without an explicit user request.
- Never weaken policy files.

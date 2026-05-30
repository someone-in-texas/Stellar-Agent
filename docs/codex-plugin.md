# Codex Plugin

The Codex plugin files live under `plugins/codex`.

Validate the plugin:

```bash
node packages/codex-plugin/dist/cli.js validate plugins/codex
```

Generate a normalized packaging manifest:

```bash
node packages/codex-plugin/dist/cli.js manifest plugins/codex plugins/codex/plugin-manifest.json
```

Skills:

- `stellar-agent-testnet` teaches Testnet initialization, doctor checks, smoke tests, issued-asset scenarios, trustlines, claimable balances, ledger receipts, and Stellar CLI contract workflows.
- `stellar-agent-payments` teaches quote-first payment workflows, approval stops, issued-asset caveats, signed-XDR approval requests, local x402 demos, and local MPP demos.

Example prompts are in `examples/codex/prompts`.

Safety expectations:

- Prefer Testnet.
- Use `--json`.
- Never print secrets.
- Never enable Mainnet without an explicit user request.
- Never weaken policy files.

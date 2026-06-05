# Stellar Agent Bridge Codex Plugin

This plugin teaches Codex to use `stellar-agent` safely for Testnet wallets, payments, issued assets, trustlines, claimable balances, local HTTP payment demos, receipts, and Stellar CLI contract workflows.

Validate the plugin before packaging:

```bash
node packages/codex-plugin/dist/cli.js validate plugins/codex
```

Generate a normalized manifest:

```bash
node packages/codex-plugin/dist/cli.js manifest plugins/codex plugins/codex/plugin-manifest.json
```

GitHub releases package this plugin as `stellar-agent-codex-plugin-v0.1.0.tgz` alongside the npm tarball for `@stellar-agent/codex-plugin`. The release preflight validates the staged plugin artifact with the packaged validator so the Codex plugin and GitHub release remain aligned.

Rules:

- Prefer Testnet.
- Use `--json`.
- Run quote or policy explain before payments.
- Stop on approval-required results.
- Never print secrets.
- Never enable Mainnet unless the user explicitly asks.
- Treat x402 and MPP as local Testnet demos unless production facilitator support is explicitly added.
- Run `contract doctor` before Stellar CLI-backed contract commands.

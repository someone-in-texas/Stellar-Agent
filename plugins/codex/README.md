# Stellar Agent Bridge Codex Plugin

This plugin teaches Codex to use `stellar-agent` safely for Testnet wallets, payments, issued assets, trustlines, claimable balances, local HTTP payment demos, receipts, guarded Mainnet agent-wallet workflows, Stellar CLI contract workflows, Blend and Aquarius DeFi workflows, and market-liquidity investigation.

Validate the plugin before packaging:

```bash
node packages/codex-plugin/dist/cli.js validate plugins/codex
```

Generate a normalized manifest:

```bash
node packages/codex-plugin/dist/cli.js manifest plugins/codex plugins/codex/plugin-manifest.json
```

GitHub releases package this plugin as `stellar-agent-codex-plugin-v0.4.4.tgz` alongside the npm tarball for `@stellar-agent/codex-plugin`. The release preflight validates the staged plugin artifact with the packaged validator so the Codex plugin and GitHub release remain aligned.

Rules:

- Prefer Testnet.
- Use `--json`.
- Run quote or policy explain before payments.
- Stop on approval-required results.
- Never print secrets.
- Never enable Mainnet unless the user explicitly asks.
- For Mainnet agent-wallet work, require explicit Mainnet enablement, a dedicated watch-only wallet, strict caps, a destination allowlist, `agent-wallet arm --i-understand-real-funds`, and external signing.
- Never treat `--allow-real-funds` as a policy bypass.
- Treat x402 and MPP as local Testnet demos unless production facilitator support is explicitly added.
- Run `contract doctor` before Stellar CLI-backed contract commands.
- For Blend and Aquarius, run DeFi inspection and preflight before any protocol action.
- Treat Aquarius commands in this release as read-only or preflight-only.
- Treat market liquidity commands as investigation and policy-gated Testnet workflows, not a profitability guarantee.
- For liquidity-pool mutation, run `market lp preflight` first and require an existing Horizon-visible core pool.

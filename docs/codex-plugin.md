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
- `stellar-agent-defi` teaches Blend and Aquarius deployment inspection, pool/account/reward reads, policy-gated preflight, Aquarius read-only/preflight boundaries, and Mainnet DeFi signing limits.
- `stellar-agent-market-liquidity` teaches core liquidity-pool inspection, LP preflight, guarded Testnet mutation, market listeners, strategy investigation, and the adapter-required Soroban AMM boundary.

Example prompts are in `examples/codex/prompts`.

Maintenance checklist:

- When adding a CLI workflow family, decide whether it needs a new `SKILL.md` or an update to an existing skill.
- Keep `plugins/codex/plugin.yaml`, `plugins/codex/README.md`, and skill routing YAML aligned with `SKILL.md` files.
- For safety-sensitive workflows, include the required preflight command, mutation boundary, Mainnet limitation, and receipt expectations in the relevant skill.
- Run `pnpm release:safety` before release prep; it checks that bundled Codex guidance still covers the current workflow families.

Safety expectations:

- Prefer Testnet.
- Use `--json`.
- Never print secrets.
- Never enable Mainnet without an explicit user request.
- Never weaken policy files.

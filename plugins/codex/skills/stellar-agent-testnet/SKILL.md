# Stellar Agent Testnet

Use this skill when asked to run Testnet workflows with `stellar-agent`, including wallets, smoke tests, issued assets, trustlines, claimable balances, receipts, and Stellar CLI contract wrappers.

Workflow:

1. Run `stellar-agent testnet doctor --json`.
2. If local state is missing, run `stellar-agent testnet init --json`.
3. To create a transaction-ready named wallet, use `stellar-agent wallet create-testnet <name> --fund --json` or fund an existing wallet with `stellar-agent testnet fund --account <name> --json`.
4. Use dry-run commands first when the user asks for offline validation:
   - `stellar-agent testnet smoke-test --dry-run --json`
   - `stellar-agent testnet scenario issued-asset-payment --dry-run --json`
5. Use live Testnet commands when the user asks for real Testnet transactions:
   - `stellar-agent testnet smoke-test --json`
   - `stellar-agent testnet scenario issued-asset-payment --json`
   - `stellar-agent testnet scenario contract-asset-smoke --json`
6. For broad live verification in the repo, run `LIVE_STELLAR_TESTNET=1 pnpm verify:live:testnet`.

Common Testnet operations:

- Inspect balances with `stellar-agent wallet balance --account <alias> --json`.
- Add, list, and remove trustlines with `stellar-agent wallet trustline add|list|remove ... --json`.
- Create, list, and claim claimable balances with `stellar-agent claimable create|list|claim ... --json`.
- Use `stellar-agent ledger tx`, `stellar-agent ledger payments`, `stellar-agent ledger effects`, and receipt export commands to inspect submitted transactions.

Smart contract operations:

- Run `stellar-agent contract doctor --json` before contract commands.
- Use `stellar-agent testnet scenario contract-asset-smoke --json` for an end-to-end asset-contract deploy/read/info/invoke/extend smoke path.
- Use `stellar-agent contract asset-deploy --source <alias> --asset <asset> --json` for Stellar Asset Contracts.
- Use `stellar-agent contract upload`, `deploy`, `invoke`, `read`, `info`, `fetch`, `extend`, and `restore` for Stellar CLI-backed workflows.
- In isolated agent environments, pass `--stellar-config-dir <dir>` and `--stellar-no-cache` when needed to avoid relying on a user's global Stellar CLI state.
- Treat `contract fetch` as regular Wasm-contract only; Stellar Asset Contracts do not expose downloadable Wasm binaries.

Safety:

- Prefer Testnet.
- Never print secret keys.
- Never enable Mainnet without explicit user request.
- Do not weaken policy files.
- Do not submit live transactions unless the user asked for live Testnet behavior or approved the action.
- Summarize receipt metadata and transaction hashes without exposing secrets.

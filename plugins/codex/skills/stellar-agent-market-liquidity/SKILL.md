# Stellar Agent Market Liquidity

Use this skill when asked to investigate Stellar markets, inspect core liquidity pools, set market alerts, evaluate LP strategy proposals, or prepare guarded Testnet liquidity-pool actions with `stellar-agent`.

Rules:

1. Use `--json`.
2. Prefer read-only market inspection before any preflight or mutation.
3. Run `stellar-agent market lp preflight` before any liquidity-pool deposit or withdrawal.
4. Treat listener events as alerts, not execution approval.
5. Treat strategy output as a proposal, not a profitability guarantee.
6. Never weaken policy files to execute a strategy.
7. Never submit Mainnet liquidity actions through local auto-signing.
8. Never treat a generic Soroban contract id as a safe AMM without a protocol-specific adapter.

Core pool inspection:

- List existing core Stellar liquidity pools with `stellar-agent market pools list --asset-a <asset> --asset-b <asset> --json`.
- Inspect one pool with `stellar-agent market pool inspect --pool <pool-id> --json`.
- Review recent pool trades with `stellar-agent market pool trades --pool <pool-id> --json`.
- Inspect a wallet's pool-share position with `stellar-agent market pool position --account <alias-or-G...> --pool <pool-id> --json`.

LP preflight and mutation:

- Use `stellar-agent market lp preflight --pool <pool-id> --max-a <amount> --max-b <amount> --min-price <price> --max-price <price> --json` before deposits.
- Use `stellar-agent market lp preflight --pool <pool-id> --action withdraw --shares <amount> --min-a <amount> --min-b <amount> --json` before withdrawals.
- Create a Testnet pool-share trustline with `stellar-agent market lp trustline add --pool <pool-id> --account <alias> --fee-strategy medium --json`.
- Treat `nominalExposure.value` as a policy proxy (`max-a + max-b`), not as mark-to-market value or profit/loss.
- Submit Testnet deposits or withdrawals only after preflight reports an allowed policy decision and the user asked for live Testnet mutation.
- This release expects LP mutation to target an existing Horizon-visible core pool. Do not promise bootstrapping of a brand-new core pool from only reserve assets.

Market listeners:

- Use `stellar-agent market listen price --pool <pool-id> --above <price> --json` or `--below <price>` for finite price alerts.
- Use `stellar-agent market listen position --pool <pool-id> --account <alias-or-G...> --shares-below <amount> --json` for pool-share position alerts.
- Use `stellar-agent market listen config --file <alerts.yaml> --json` for repeatable price alert files with `alerts[].pool`, `alerts[].above` or `alerts[].below`, and `action: log`.
- Treat config alerts as log events only. They do not approve, prepare, or submit liquidity actions.
- After an alert triggers, re-run preflight before any action.

Strategy investigation:

- Explain local strategy files with `stellar-agent strategy explain <file> --json`.
- Simulate local strategy files with `stellar-agent strategy simulate <file> --json`.
- Investigate liquidity with `stellar-agent strategy investigate liquidity --pair <assetA/assetB> --json` or `--pool <pool-id> --json`.

Soroban boundary:

- Use `stellar-agent market soroban pool inspect --id <contract-id> --json` only for read-only interface investigation.
- Use `stellar-agent market soroban pool preflight --id <contract-id> --action deposit --json` to report the adapter-required boundary.
- Soroban AMM mutation requires a future protocol-specific adapter with documented interfaces, policy controls, simulation, signing, and receipts.

Safety:

- Liquidity fees are not guaranteed profit.
- LP positions can underperform simply holding the reserve assets.
- Testnet liquidity does not prove Mainnet profitability.
- Mainnet liquidity mutation requires external signing and explicit real-funds acknowledgement.
- Summarize pool ids, reserve assets, policy decisions, and receipts without exposing secrets.

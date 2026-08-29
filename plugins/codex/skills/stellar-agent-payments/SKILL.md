# Stellar Agent Payments

Use this skill when asked to quote, explain, or send payments with `stellar-agent`, including direct payments, issued assets, signed-XDR approval flows, WalletConnect/LOBSTR signing, risk-budgeted Mainnet agent-wallet workflows, local x402, and local MPP demos.

Rules:

1. Use `--json`.
2. Run `stellar-agent policy explain` or `stellar-agent pay quote` before payment commands.
3. Treat `requires_approval` as a stop unless the user explicitly approves.
4. Never weaken policy files.
5. Never bypass the CLI.
6. Prefer `pay quote` before `pay send`.
7. Never print or log secrets.
8. Never use `--allow-real-funds` as a policy bypass.
9. Mainnet agent-wallet spend is bounded, not safe; generic Mainnet auto-signing remains blocked.
10. After any submitted payment or signed-XDR submission, inspect `stellar-agent receipts latest --json` and report the receipt path and transaction hash without printing secrets.
11. Supply a stable `--idempotency-key` for durable agent jobs. Persist the returned intent id.
12. If JSON reports `changedOnChain: "unknown"` or `safeToRetry: false`, do not resubmit. Run `stellar-agent intent reconcile <id> --json` until the outcome is terminal.

Direct payments:

- Quote XLM or issued-asset payments with `stellar-agent pay quote --to <G...> --amount <amount> --asset <asset> --fee-strategy medium --json`.
- Submit approved Testnet payments with `stellar-agent pay send ... --json`.
- Inspect resumable state with `stellar-agent intent list --json` and verify local audit integrity with `stellar-agent receipts verify-chain --json`.
- For bundled Testnet payments, run `stellar-agent pay batch --file <payments.json> --dry-run --json` first and submit only if every policy decision is `allowed`.
- Use `--fee-strategy high` or `--fee-strategy p95` only when the user wants a higher fee bid for faster acceptance.
- For issued assets, confirm the recipient has a trustline before submitting, or use `stellar-agent testnet scenario issued-asset-payment --json` for an end-to-end Testnet scenario.

Approval and signing:

- If policy requires approval, stop after showing the approval summary.
- Submit with `--approval-id <id>` only after explicit authorization for the exact destination, amount, asset, profile, and memo/domain when present.
- Use `stellar-agent approval open --port <port> --token <session-token> --json` to reconstruct the browser `copyUrl` for a running approval bridge.
- Use `stellar-agent approval create-transaction --xdr <base64> --summary <text> --network testnet --json` for prebuilt XDR approval requests.
- Use the Freighter bridge only for explicit user-approved signing workflows.
- Use WalletConnect/LOBSTR only for explicit user-approved external signing workflows.
- For WalletConnect, create or load a transaction-XDR approval request, then run `stellar-agent approval sign-walletconnect <approval-id> --wallet lobstr --project-id <project-id> --json`. The project id can come from `WALLETCONNECT_PROJECT_ID`.
- WalletConnect signing records signed XDR with `stellar_signXDR`; it must not use wallet-side submission. Submit only afterward with `stellar-agent tx submit-approval <approval-id> --json`.
- For Mainnet WalletConnect signing, require Mainnet enablement and include `--allow-real-funds --i-understand-real-funds`; for Mainnet submission, include those flags again on `tx submit-approval`.
- For Mainnet payment-signature workflows, use only externally signed XDR paths with `--allow-real-funds --i-understand-real-funds`.

Risk-budgeted Mainnet agent wallet:

- Use this only when the user explicitly asks for Mainnet.
- First run `stellar-agent mainnet enable --i-understand-real-funds --json`.
- For a new agent wallet, tell the user to create or choose a dedicated Mainnet wallet outside `stellar-agent` and provide only the public `G...` address. Do not ask for, paste, print, or store its secret key.
- Have the user fund that wallet from a human-controlled wallet, Freighter, hardware wallet, exchange, or other external custody flow. `stellar-agent` does not Friendbot-fund Mainnet and must not simulate Mainnet funding.
- Fund only enough for the intended risk budget, fees, and account minimums. Keep the funded balance below the configured `--max-balance`.
- Create the dedicated watch-only agent-wallet record with strict caps and an explicit destination allowlist:
  `stellar-agent mainnet agent-wallet create --address <G...> --max-balance <amount> --daily-limit <amount> --per-tx-limit <amount> --asset XLM --allow-destination <G...> --json`.
- After external funding, inspect `stellar-agent mainnet agent-wallet status --json`. Stop if the wallet is unfunded, unreadable, over the max balance, or reports non-ok integrity.
- Arm only with explicit acknowledgement:
  `stellar-agent mainnet agent-wallet arm --i-understand-real-funds --json`.
- Before requesting a Mainnet payment signature, inspect status with `stellar-agent mainnet agent-wallet status --json` and stop if integrity is not ok.
- Request payment signing with:
  `stellar-agent --profile mainnet tx request-payment-signature --from mainnet-agent --to <G...> --amount <amount> --allow-real-funds --i-understand-real-funds --json`.
- Disarm after the workflow with `stellar-agent mainnet agent-wallet disarm --json`.
- For agent-wallet autosigning, require an explicit user request, then run `stellar-agent mainnet agent-wallet autosign enable --secret-key-env <ENV_NAME> --i-understand-agent-wallet-autosign --json`, re-arm the wallet, and submit only with `stellar-agent --profile mainnet pay send --from mainnet-agent --to <G...> --amount <amount> --allow-real-funds --i-understand-real-funds --i-understand-agent-wallet-autosign --json`.
- Autosign submission must have policy status `allowed`; default Mainnet `requires_approval` blocks it. Do not add `approval.allowMainnetAgentWalletAutosign: true` unless the user explicitly approves that policy exception.
- Never print, request in chat, or store the environment variable value. Stop if the secret-key env var is absent or does not match the configured public key.
- If config, policy, receipts, balance, destination, asset, or spend limits fail closed, stop and report the matched error. Do not loosen caps or allowlists without explicit user instruction.

HTTP payment demos:

- `stellar-agent demo x402 --out <dir> --json` creates a local x402 paid API server bundle; it does not submit a payment.
- `stellar-agent demo approval-flow --json` creates a local Testnet approval request; treat the output as a request to review, not approval to submit.
- `stellar-agent pay x402 <localhost-url> --allow-localhost-demo --json` pays a compatible local x402 demo resource.
- `stellar-agent pay mpp <localhost-url> --allow-localhost-demo --json` pays a compatible one-time MPP demo resource.
- `stellar-agent pay mpp-session <localhost-url> --requests <n> --allow-localhost-demo --json` pays a local MPP session budget once, then performs authorized requests.
- CLI x402 and MPP flows remain local Testnet demos. Production code may use the package-level versioned facilitator adapter and durable MPP budget store only when it also pins network/domain/challenge bindings, independently reconciles settlement, and retains ordinary policy, approval, receipt, and Mainnet controls.

# Stellar Agent Payments

Use this skill when asked to quote, explain, or send payments with `stellar-agent`, including direct payments, issued assets, signed-XDR approval flows, local x402, and local MPP demos.

Rules:

1. Use `--json`.
2. Run `stellar-agent policy explain` or `stellar-agent pay quote` before payment commands.
3. Treat `requires_approval` as a stop unless the user explicitly approves.
4. Never weaken policy files.
5. Never bypass the CLI.
6. Prefer `pay quote` before `pay send`.
7. Never print or log secrets.

Direct payments:

- Quote XLM or issued-asset payments with `stellar-agent pay quote --to <G...> --amount <amount> --asset <asset> --fee-strategy medium --json`.
- Submit approved Testnet payments with `stellar-agent pay send ... --json`.
- For bundled Testnet payments, run `stellar-agent pay batch --file <payments.json> --dry-run --json` first and submit only if every policy decision is `allowed`.
- Use `--fee-strategy high` or `--fee-strategy p95` only when the user wants a higher fee bid for faster acceptance.
- For issued assets, confirm the recipient has a trustline before submitting, or use `stellar-agent testnet scenario issued-asset-payment --json` for an end-to-end Testnet scenario.

Approval and signing:

- If policy requires approval, stop after showing the approval summary.
- Use `stellar-agent approval create-transaction --xdr <base64> --summary <text> --network testnet --json` for prebuilt XDR approval requests.
- Use the Freighter bridge only for explicit user-approved signing workflows.

HTTP payment demos:

- `stellar-agent pay x402 <localhost-url> --allow-localhost-demo --json` pays a compatible local x402 demo resource.
- `stellar-agent pay mpp <localhost-url> --allow-localhost-demo --json` pays a compatible one-time MPP demo resource.
- `stellar-agent pay mpp-session <localhost-url> --requests <n> --allow-localhost-demo --json` pays a local MPP session budget once, then performs authorized requests.
- The x402 and MPP flows in this build are local Testnet demos, not production facilitator integrations.

# Agent Integration

Agents should use JSON mode:

```bash
stellar-agent testnet doctor --json
stellar-agent pay quote --to G... --amount 1 --asset XLM --json
stellar-agent wallet trustline add --account merchant --asset USD:G... --json
stellar-agent testnet scenario issued-asset-payment --dry-run --json
stellar-agent wallet import-public --name treasury --network mainnet --address G... --json
stellar-agent claimable list --account merchant --json
stellar-agent testnet scenario x402-payment --json
stellar-agent pay x402 http://127.0.0.1:PORT/paid-report --allow-localhost-demo --json
stellar-agent pay mpp http://127.0.0.1:PORT/mpp-report --allow-localhost-demo --json
stellar-agent pay mpp-session http://127.0.0.1:PORT/mpp-session --requests 2 --allow-localhost-demo --json
stellar-agent tx submit-approval appr_... --json
stellar-agent testnet scenario contract-asset-smoke --dry-run --json
stellar-agent contract deploy --source agent --wasm ./contract.wasm --json
stellar-agent contract asset-deploy --source agent --asset native --json
stellar-agent contract info --kind interface --id C... --json
```

The standard success envelope is:

```json
{ "ok": true, "data": {} }
```

The standard error envelope is:

```json
{ "ok": false, "error": { "code": "POLICY_DENIED", "message": "..." } }
```

Exit codes are stable: `0` success, `2` usage, `3` config or policy validation, `4` policy denied, `5` approval required or denied, `6` network unavailable, `7` transaction failed or timed out, and `8` not implemented.

Example agent prompt:

> Run `stellar-agent pay quote --json` before any payment, stop if approval is required, and never print secrets.

Mainnet agent rule:

- Treat `MAINNET_NOT_ENABLED`, `APPROVAL_REQUIRED`, and `POLICY_DENIED` as stop conditions.
- Do not add `--allow-real-funds` or `--i-understand-real-funds` unless the user explicitly asks for that exact Mainnet action.
- Do not ask for or pass Mainnet secret keys. Use watch-only public wallets, browser-wallet approvals, Stellar CLI identities, or signed XDR.
- For Mainnet signed-XDR submission, include the real-funds flags only after confirming the signed XDR came from a human-controlled Mainnet wallet.

Receipts are JSON files under `~/.stellar-agent/receipts`.

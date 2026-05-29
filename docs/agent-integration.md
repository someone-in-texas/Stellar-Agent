# Agent Integration

Agents should use JSON mode:

```bash
stellar-agent testnet doctor --json
stellar-agent pay quote --to G... --amount 1 --asset XLM --json
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

Receipts are JSON files under `~/.stellar-agent/receipts`.

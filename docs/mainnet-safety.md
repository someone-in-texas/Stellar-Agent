# Mainnet Safety

Mainnet uses real funds.

Defaults:

- Mainnet is disabled.
- Mainnet auto-approval is disabled.
- Mainnet local auto-signing is blocked.
- Mainnet policies require explicit approval.
- JSON output includes `realFunds: true` for Mainnet status.

Enablement requires:

```bash
stellar-agent mainnet enable --i-understand-real-funds
```

Recommended signing model:

- Use Freighter or another human approval flow.
- Show transaction explanation before signing.
- Keep Mainnet secret keys out of local plaintext files.
- Use a Stellar CLI identity or signed XDR for guarded Mainnet operations; do not pass raw Mainnet secret keys to `stellar-agent`.

## Local Approval Bridge

The local approval bridge stores auditable request files under the configured `approvalsDir` and can serve a localhost approval UI:

```bash
stellar-agent approval create-payment --to G... --amount 6 --json
stellar-agent approval create-transaction --xdr AAAA... --summary "Sign contract transaction" --network testnet --json
stellar-agent approval list --json
stellar-agent approval decide appr_... --approve --json
stellar-agent approval serve
```

The server prints a per-session API token. Browser requests from the served UI include this token automatically. Non-browser API clients must send it as `Authorization: Bearer <token>`. The bridge also rejects cross-origin API writes and oversized request bodies.

For Testnet payments that policy marks `requires_approval`, rerun the payment with a matching approved request:

```bash
stellar-agent pay send --to G... --amount 6 --approval-id appr_... --json
```

The bridge does not handle raw secret keys. Browser-extension signing through Freighter can post signed transaction XDR back to the bridge. Testnet submission is available by default; Mainnet submission is available only through the guarded signed-XDR rules below.

When `stellar-agent approval serve` is opened in a browser with Freighter installed, transaction-XDR approval requests include a `Sign With Freighter` action. The UI calls Freighter's `signTransaction` API and records the returned signed XDR plus signer address in the approval request. The bridge verifies that the signed envelope has at least one signature and that its transaction body exactly matches the original approval XDR before storing it.

## Signed XDR Submission

Signed transaction XDR can be submitted on Testnet after a browser wallet or other signer has already signed it:

```bash
stellar-agent tx build-payment --from treasury --to G... --amount 1 --json
stellar-agent tx request-payment-signature --from treasury --to G... --amount 1 --json
stellar-agent tx submit-xdr --xdr AAAA... --json
stellar-agent tx submit-approval appr_... --json
```

`tx build-payment` creates unsigned payment XDR for a local, watch-only, or raw public-key source account. `tx request-payment-signature` builds that XDR and creates a local transaction approval request for Freighter signing. `tx submit-approval` loads the signed XDR recorded by the local approval bridge and submits it to Horizon. It requires a `transaction_xdr` approval with status `signed` whose signed envelope matches the requested transaction.

Mainnet signed-XDR workflows are allowed only when all of these are true:

- Mainnet is enabled with `stellar-agent mainnet enable --i-understand-real-funds`.
- The active profile is Mainnet.
- The command includes `--allow-real-funds --i-understand-real-funds`.
- The XDR is already signed by a human-controlled Mainnet wallet or external signer.
- Local policy evaluation did not deny the payment request when the XDR was built by `stellar-agent`.

Example guarded Mainnet payment-signature request:

```bash
stellar-agent wallet import-public --name treasury --network mainnet --address G...
stellar-agent --profile mainnet tx request-payment-signature \
  --from treasury \
  --to G... \
  --amount 1 \
  --allow-real-funds \
  --i-understand-real-funds \
  --json
stellar-agent approval serve
stellar-agent --profile mainnet tx submit-approval appr_... \
  --allow-real-funds \
  --i-understand-real-funds \
  --json
```

Example guarded Mainnet signed-XDR submission when another wallet has already signed:

```bash
stellar-agent --profile mainnet tx submit-xdr \
  --xdr AAAA... \
  --allow-real-funds \
  --i-understand-real-funds \
  --json
```

These commands do not import or store Mainnet secret keys and do not auto-sign.

## Mainnet Contracts

Contract commands that can submit transactions, such as `contract invoke`, `contract deploy`, `contract upload`, `contract asset-deploy`, `contract extend`, and `contract restore`, are guarded when `--network mainnet`, `--network public`, or `--network pubnet` is selected.

Guarded Mainnet contract operations require all of:

- `stellar-agent mainnet enable --i-understand-real-funds`.
- `--allow-real-funds`.
- `--i-understand-real-funds`.
- A Stellar CLI identity, browser-wallet flow, raw public key, or watch-only Mainnet wallet reference.

`stellar-agent` refuses raw secret keys and local generated Testnet wallet secrets for Mainnet contract operations. It can pass a Stellar CLI identity name through to the installed `stellar` CLI, leaving Mainnet key custody outside this project.

Watch-only Mainnet public wallets can be imported for read-only balance and ledger inspection:

```bash
stellar-agent wallet import-public --name treasury --network mainnet --address G...
stellar-agent wallet balance --account treasury --json
```

This stores only the public key and cannot sign transactions.

Readiness checklist:

- Policy requires approval for all Mainnet payments.
- Receipts are enabled.
- Logs are redacted.
- The user understands real funds are involved.

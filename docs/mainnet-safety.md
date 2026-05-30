# Mainnet Safety

Mainnet uses real funds.

Defaults:

- Mainnet is disabled.
- Mainnet auto-approval is disabled.
- Mainnet payment submission is blocked in v0.
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

## Local Approval Bridge

The local approval bridge stores auditable request files under the configured `approvalsDir` and can serve a localhost approval UI:

```bash
stellar-agent approval create-payment --to G... --amount 6 --json
stellar-agent approval create-transaction --xdr AAAA... --summary "Sign contract transaction" --network testnet --json
stellar-agent approval list --json
stellar-agent approval decide appr_... --approve --json
stellar-agent approval serve
```

For Testnet payments that policy marks `requires_approval`, rerun the payment with a matching approved request:

```bash
stellar-agent pay send --to G... --amount 6 --approval-id appr_... --json
```

The bridge does not handle raw secret keys. Browser-extension signing through Freighter can post signed transaction XDR back to the bridge, but Mainnet payment submission remains blocked in this build.

When `stellar-agent approval serve` is opened in a browser with Freighter installed, transaction-XDR approval requests include a `Sign With Freighter` action. The UI calls Freighter's `signTransaction` API and records the returned signed XDR plus signer address in the approval request. The bridge verifies that the signed envelope has at least one signature and that its transaction body exactly matches the original approval XDR before storing it.

## Signed XDR Submission

Signed transaction XDR can be submitted on Testnet after a browser wallet or other signer has already signed it:

```bash
stellar-agent tx build-payment --from treasury --to G... --amount 1 --json
stellar-agent tx request-payment-signature --from treasury --to G... --amount 1 --json
stellar-agent tx submit-xdr --xdr AAAA... --json
stellar-agent tx submit-approval appr_... --json
```

`tx build-payment` creates unsigned payment XDR for a local, watch-only, or raw public-key source account. `tx request-payment-signature` builds that XDR and creates a local transaction approval request for Freighter signing. `tx submit-approval` loads the signed XDR recorded by the local approval bridge and submits it to Testnet Horizon. It requires a `transaction_xdr` approval with status `signed` whose signed envelope matches the requested transaction. Mainnet signed-XDR submission is blocked in this build.

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

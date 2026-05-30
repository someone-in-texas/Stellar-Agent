# @stellar-agent/freighter-bridge

Local approval bridge primitives for `stellar-agent`.

This package stores auditable approval requests and serves a localhost HTTP API/UI for human approval. It never stores raw secret keys.

Implemented:

- payment approval request creation
- transaction XDR approval request creation
- approve/deny/signed decision recording
- signed-XDR substitution checks for transaction approval requests
- request hash matching for payment approvals
- localhost HTTP endpoints under `/api/requests`
- a small static approval UI at `/` with optional Freighter `signTransaction` support

CLI entry points:

```bash
stellar-agent approval create-payment --to G... --amount 6 --json
stellar-agent approval create-transaction --xdr AAAA... --summary "Sign contract transaction" --network testnet --json
stellar-agent tx request-payment-signature --from treasury --to G... --amount 1 --json
stellar-agent approval decide appr_... --approve --json
stellar-agent approval serve
stellar-agent pay send --to G... --amount 6 --approval-id appr_... --json
stellar-agent tx submit-approval appr_... --json
```

The UI uses Freighter's browser API when available. It posts `signedTransactionXdr` and `signerPublicKey` back to the bridge without exposing secrets to the CLI. The bridge accepts signed transaction XDR only when it has at least one signature and its transaction body matches the original approval request. Signed transaction approvals can then be submitted to Testnet with `tx submit-approval`; Mainnet submission remains blocked.

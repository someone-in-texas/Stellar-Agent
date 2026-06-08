# @stellar-agent/freighter-bridge

Local approval request storage and Freighter-compatible signing bridge for Stellar Agent.

This package stores auditable approval requests and serves a localhost HTTP API/UI for human approval. It never stores raw secret keys.

## Install

```bash
npm install @stellar-agent/freighter-bridge
```

## CLI Entry Points

```bash
stellar-agent approval create-payment --to G... --amount 6 --json
stellar-agent approval create-transaction --xdr AAAA... --summary "Sign contract transaction" --network testnet --json
stellar-agent tx request-payment-signature --from treasury --to G... --amount 1 --json
stellar-agent approval decide appr_... --approve --json
stellar-agent approval serve
stellar-agent pay send --to G... --amount 6 --approval-id appr_... --json
stellar-agent tx submit-approval appr_... --json
```

## Implemented

- Payment approval request creation.
- Transaction XDR approval request creation.
- Approve, deny, and signed decision recording.
- Signed-XDR substitution checks for transaction approval requests.
- Request hash matching for payment approvals.
- Localhost HTTP endpoints under `/api/requests`.
- A small static approval UI at `/` with optional Freighter `signTransaction` support.
- Loopback-only approval bridge hosting by default, with explicit opt-in required for remote binds.

## Safety

The UI uses Freighter's browser API when available. It reads the bridge token from the printed `uiUrl` fragment, not from unauthenticated HTML, and posts `signedTransactionXdr` and `signerPublicKey` back to the bridge without exposing secrets to the CLI. The bridge accepts signed transaction XDR only when it has at least one signature and its transaction body matches the original approval request. Signed transaction approvals can then be submitted to Testnet with `tx submit-approval`. Mainnet submission is available only with Mainnet enabled, an active Mainnet profile, and `--allow-real-funds --i-understand-real-funds`; the CLI still never imports or stores Mainnet secret keys.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Mainnet safety: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/mainnet-safety.md
- npm CLI package: https://www.npmjs.com/package/@stellar-agent/cli

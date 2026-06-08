# Freighter Manual Signing Example

Manual test only. This example requires a browser with the Freighter extension installed, a funded Freighter Testnet account, and a destination Testnet account. It is not part of the default automated test suite.

Use this to verify the full local approval bridge path that automated tests cannot exercise: browser loading, Freighter connection, user approval, `signTransaction`, and signed-XDR recording.

## Prerequisites

- Build the repo: `pnpm build`
- Install and unlock Freighter in your browser.
- Switch Freighter to Testnet.
- Fund the Freighter Testnet account.
- Choose a destination Testnet public key.

Set these values in your shell:

```bash
export STELLAR_AGENT_HOME="$PWD/examples/freighter-manual/.stellar-agent"
export FREIGHTER_PUBLIC_KEY="G..."
export DESTINATION_PUBLIC_KEY="G..."
```

## Create A Transaction Approval

Create an unsigned Testnet payment XDR and store it as a local approval request:

```bash
stellar-agent --json tx request-payment-signature \
  --from "$FREIGHTER_PUBLIC_KEY" \
  --to "$DESTINATION_PUBLIC_KEY" \
  --amount 0.0000001 \
  --summary "Manual Freighter Testnet signing check"
```

Copy the `data.approval.id` value from the JSON output:

```bash
export APPROVAL_ID="appr_..."
```

## Sign In The Browser

Start the local approval bridge:

```bash
stellar-agent approval serve --json
```

Open the returned `uiUrl` in the browser that has Freighter installed. The approval UI should show the pending transaction request and a `Sign With Freighter` action. Connect Freighter if prompted, review the transaction, and approve the `signTransaction` request.

The approval request should now be `signed`:

```bash
stellar-agent --json approval show "$APPROVAL_ID"
```

Expected fields:

```json
{
  "ok": true,
  "data": {
    "id": "appr_...",
    "status": "signed",
    "decision": {
      "approved": true,
      "signerPublicKey": "G...",
      "signedTransactionXdr": "AAAA..."
    }
  }
}
```

## Optional Testnet Submission

Submit only after you have verified the signed request is what you intended:

```bash
stellar-agent --json tx submit-approval "$APPROVAL_ID"
stellar-agent --json receipts latest
```

## What This Proves

- The local approval bridge serves the browser UI.
- The UI can find Freighter's browser API.
- Freighter signs the transaction XDR on Testnet.
- `stellar-agent` records signed XDR without seeing a secret key.
- `tx submit-approval` remains the separate submission and receipt path.

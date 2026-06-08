# WalletConnect Manual Signing Example

Manual test only. This example requires a WalletConnect project id, relay/network access, and a LOBSTR or compatible Stellar wallet that supports WalletConnect on Testnet. It is not part of the default automated test suite.

Use this to verify the full WalletConnect path that automated tests cannot exercise: real SDK client initialization, QR/pairing approval, persisted session lookup, wallet-side `stellar_signXDR`, and signed-XDR recording.

## Prerequisites

- Build the repo: `pnpm build`
- Create or obtain a WalletConnect project id.
- Install and unlock LOBSTR or another compatible Stellar WalletConnect wallet.
- Use a funded Testnet account in that wallet.
- Choose a destination Testnet public key.

Set these values in your shell:

```bash
export STELLAR_AGENT_HOME="$PWD/examples/walletconnect-manual/.stellar-agent"
export WALLETCONNECT_PROJECT_ID="..."
export WALLETCONNECT_SOURCE_PUBLIC_KEY="G..."
export DESTINATION_PUBLIC_KEY="G..."
```

## Pair The Wallet

Start a WalletConnect pairing request:

```bash
stellar-agent --json wallet walletconnect pair \
  --wallet lobstr \
  --project-id "$WALLETCONNECT_PROJECT_ID"
```

Scan or paste the printed WalletConnect URI with your wallet, then approve the session. Confirm the session persisted locally:

```bash
stellar-agent --json wallet walletconnect status \
  --wallet lobstr \
  --project-id "$WALLETCONNECT_PROJECT_ID"
```

Expected fields:

```json
{
  "ok": true,
  "data": {
    "wallet": "lobstr",
    "sessions": [
      {
        "topic": "...",
        "accounts": [
          {
            "chain": "testnet",
            "address": "G..."
          }
        ]
      }
    ],
    "custody": "external_wallet"
  }
}
```

## Create A Transaction Approval

Create an unsigned Testnet payment XDR and store it as a local approval request:

```bash
stellar-agent --json tx request-payment-signature \
  --from "$WALLETCONNECT_SOURCE_PUBLIC_KEY" \
  --to "$DESTINATION_PUBLIC_KEY" \
  --amount 0.0000001 \
  --summary "Manual WalletConnect Testnet signing check"
```

Copy the `data.approval.id` value from the JSON output:

```bash
export APPROVAL_ID="appr_..."
```

## Sign With WalletConnect

Ask the paired wallet to sign the approval XDR with `stellar_signXDR`:

```bash
stellar-agent --json approval sign-walletconnect "$APPROVAL_ID" \
  --wallet lobstr \
  --project-id "$WALLETCONNECT_PROJECT_ID"
```

Approve the signing prompt in the wallet. The command records the signed XDR on the approval request but does not submit it.

Verify the approval request:

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

Disconnect the WalletConnect session when done:

```bash
stellar-agent --json wallet walletconnect disconnect \
  --topic "<topic from status>" \
  --wallet lobstr \
  --project-id "$WALLETCONNECT_PROJECT_ID"
```

## What This Proves

- The real WalletConnect SignClient initializes with a project id.
- Pairing produces a wallet-approved session.
- Session metadata persists across CLI invocations.
- The wallet signs with `stellar_signXDR`, not wallet-side submission.
- `stellar-agent` records signed XDR without seeing a secret key.
- `tx submit-approval` remains the separate submission and receipt path.

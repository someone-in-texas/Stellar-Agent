# Local Approval UI

The local approval UI is currently served by `@stellar-agent/freighter-bridge` at `/` when running:

```bash
stellar-agent approval serve
```

The served UI can list, approve, and deny local approval requests through the bridge API. For transaction-XDR approval requests, it can call Freighter's browser `signTransaction` API and store the signed XDR result back in the approval request. The bridge rejects unsigned results or signed envelopes whose transaction body differs from the original request.

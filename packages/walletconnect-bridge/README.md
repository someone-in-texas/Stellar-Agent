# @stellar-agent/walletconnect-bridge

WalletConnect external signing adapter for Stellar Agent Bridge approval workflows.

This package connects `stellar-agent` approval requests to Stellar wallets that support WalletConnect, including LOBSTR. It does not store private keys and it does not submit transactions through WalletConnect.

## CLI Entry Points

```bash
stellar-agent wallet walletconnect pair --wallet lobstr --project-id <walletconnect-project-id> --json
stellar-agent wallet walletconnect status --project-id <walletconnect-project-id> --json
stellar-agent wallet walletconnect disconnect --topic <topic> --project-id <walletconnect-project-id> --json
stellar-agent approval sign-walletconnect appr_... --wallet lobstr --project-id <walletconnect-project-id> --json
stellar-agent tx submit-approval appr_... --json
```

`approval sign-walletconnect` signs the approval XDR with `stellar_signXDR` and records the signed XDR on the local approval request. Submission still happens through `tx submit-approval`, preserving policy checks, Mainnet acknowledgements, and receipt logging.

## Safety

- Uses `stellar_signXDR`; does not use `stellar_signAndSubmitXDR`.
- Requires a WalletConnect project id from `--project-id` or `WALLETCONNECT_PROJECT_ID`.
- Keeps LOBSTR and other WalletConnect wallets as external signers, not custody providers.
- Never stores or prints secret keys.
- Refuses `local` network signing because WalletConnect Stellar chains are `stellar:testnet` and `stellar:pubnet`.
- Validates WalletConnect account chains against the active approval network.
- Lets `@stellar-agent/freighter-bridge` verify that signed XDR matches the original approval XDR before recording it.

## Links

- WalletConnect Stellar RPC: https://docs.reown.com/advanced/multichain/rpc-reference/stellar-rpc
- LOBSTR WalletConnect support: https://lobstr.freshdesk.com/support/solutions/articles/151000001589-walletconnect-how-to-log-in-and-use-your-stellar-wallet-from-lobstr-with-other-services
- Mainnet safety: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/mainnet-safety.md

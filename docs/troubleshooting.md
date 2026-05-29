# Troubleshooting

## Friendbot Unavailable

Check network access and retry `stellar-agent testnet friendbot --account agent`.

## RPC Or Horizon Unavailable

Run `stellar-agent testnet doctor --live` and confirm configured URLs.

## Testnet Reset

Use `stellar-agent testnet reset --soft` to plan a safe reset. Use `--wallets --yes` only when you intend to delete Testnet wallets.

## Invalid Wallet

Recreate Testnet wallet state with `stellar-agent testnet init --no-fund` or inspect files under `~/.stellar-agent/wallets`.

## Mainnet Disabled

Run `stellar-agent mainnet status`. Enabling requires `stellar-agent mainnet enable --i-understand-real-funds`.

## Policy Denied

Run `stellar-agent policy explain --request ./payment-request.json`.

## Approval Denied

No transaction is signed or submitted. Inspect event logs under `~/.stellar-agent/logs`.

## Transaction Timeout

Check Horizon status, wallet funding, destination address, and transaction hash if one was returned.

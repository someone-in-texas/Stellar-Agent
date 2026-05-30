# Troubleshooting

## Friendbot Unavailable

Check network access and retry `stellar-agent testnet friendbot --account agent`.

## RPC Or Horizon Unavailable

Run `stellar-agent testnet doctor --live` and confirm configured URLs.

## Testnet Reset

Use `stellar-agent testnet reset --soft` to plan a safe reset. Use `--wallets --yes` only when you intend to delete Testnet wallets.

## Invalid Wallet

Recreate Testnet wallet state with `stellar-agent testnet init --no-fund` or inspect files under `~/.stellar-agent/wallets`.

Watch-only wallet files use schema `stellar-agent.publicWallet.v1` and store only public keys. Signing commands require generated Testnet wallets with local Testnet secret keys.

## Mainnet Disabled

Run `stellar-agent mainnet status`. Enabling requires `stellar-agent mainnet enable --i-understand-real-funds`.

## Policy Denied

Run `stellar-agent policy explain --request ./payment-request.json`.

## Approval Denied

No transaction is signed or submitted. Inspect event logs under `~/.stellar-agent/logs`.

## Transaction Timeout

Check Horizon status, wallet funding, destination address, and transaction hash if one was returned.

## Stellar CLI Unavailable

`stellar-agent contract invoke` requires the official Stellar CLI. Install it from the Stellar docs or pass `--stellar-binary /path/to/stellar`.

## Trustline Failed

Confirm the asset uses `CODE:G...ISSUER` format, the wallet has enough XLM reserve, and the issuer account exists.

## Claimable Balance Claim Failed

Confirm the balance id is correct, the local wallet is listed as a claimant, and any time predicate has been satisfied.

## x402 Policy Denied

Default policy disables x402. For the local demo, run `stellar-agent testnet scenario x402-payment` or pass `--allow-localhost-demo` to `pay x402` for localhost URLs. For non-localhost URLs, update policy intentionally with `x402.enabled`, `allowDomains`, and `maxPricePerRequest`.

## MPP Policy Denied

The local MPP demo uses the same HTTP-payment policy controls as the local x402 demo in this build. Pass `--allow-localhost-demo` for localhost demos, or update policy intentionally for other domains.

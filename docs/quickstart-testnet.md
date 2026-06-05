# Testnet Quickstart

Stellar Testnet is a public testing network. It uses valueless XLM funded by Friendbot.

## Initialize

```bash
stellar-agent testnet init
```

This creates `~/.stellar-agent` with Testnet-only wallets, policies, receipts, ledgers, logs, approvals, and scenario folders.

## Wallets

Generated wallet files are Testnet-only and may store local secret keys for convenience. Never reuse Testnet keys on Mainnet.

Create any named Testnet wallet:

```bash
stellar-agent wallet create-testnet issuer
stellar-agent wallet create-testnet merchant
stellar-agent wallet create-testnet funded-agent --fund
```

Use `--fund` to create and Friendbot-fund a wallet in one step. You can also fund an existing local wallet or public key later:

```bash
stellar-agent testnet fund --account funded-agent
stellar-agent testnet fund --address G...
```

Import a watch-only public wallet for read-only inspection:

```bash
stellar-agent wallet import-public --name treasury --network mainnet --address G...
stellar-agent wallet address --account treasury
```

## Trustlines

Issued assets require a trustline before an account can receive them:

```bash
stellar-agent wallet trustline list --account merchant
stellar-agent wallet trustline add --account merchant --asset USD:G...ISSUER
stellar-agent pay send --from issuer --to G...MERCHANT --amount 1 --asset USD:G...ISSUER
stellar-agent wallet trustline remove --account merchant --asset USD:G...ISSUER
```

Remove a trustline only after the asset balance is zero.

## Faster Payments

Payment commands use Horizon fee stats by default so Testnet transactions bid a current fee instead of always using the static base fee. Use `--fee-strategy medium` for the default, `base` for the minimum safe fallback, `high` or `p95` when you prefer faster acceptance under congestion, and `--no-cache` when you want to bypass in-process fee-stat caching.

Quote before submitting:

```bash
stellar-agent pay quote --to G...MERCHANT --amount 1 --asset XLM --fee-strategy medium --json
```

Bundle multiple Testnet payments from the same local wallet into one transaction:

```json
[
  { "destination": "G...MERCHANT", "amount": "1", "asset": "XLM" },
  { "destination": "G...AUDITOR", "amount": "0.5", "asset": "XLM" }
]
```

```bash
stellar-agent pay batch --file ./payments.json --from agent --memo "batch-demo" --json
```

`pay batch` evaluates policy for every payment and advances the in-memory spend totals while checking the bundle, so daily and monthly limits apply to the aggregate transaction. Mainnet batch auto-signing remains blocked.

## Issued Asset Scenario

Run the end-to-end issued-asset path with one command:

```bash
stellar-agent testnet scenario issued-asset-payment --json
```

The scenario creates local issuer and recipient wallets if needed, funds them with Friendbot, creates a unique issued asset, adds the recipient trustline, sends the issued asset, writes receipts for the trustline and payment transactions, and returns the recipient balance. Use `--dry-run` to plan the workflow without funding or submitting transactions.

## Reset

```bash
stellar-agent testnet reset --soft
stellar-agent testnet reset --wallets --yes
```

Soft reset preserves wallets and policies. Wallet reset requires explicit `--yes`.

## Inspect

```bash
stellar-agent wallet balance --account agent
stellar-agent ledger latest
stellar-agent ledger payments --account agent
stellar-agent ledger effects --account merchant
stellar-agent claimable list --account merchant
stellar-agent receipts latest
stellar-agent ledger export --output ./ledger-report.json
stellar-agent cache inspect --json
```

## Signed XDR

After a transaction has been signed by Freighter or another signer, submit it to Testnet Horizon:

```bash
stellar-agent tx submit-xdr --xdr AAAA...
stellar-agent tx submit-approval appr_...
```

## Live Verification

The broad live verifier is opt-in because it creates Testnet accounts and submits multiple Testnet transactions:

```bash
LIVE_STELLAR_TESTNET=1 pnpm verify:live:testnet
```

It uses an isolated temp workspace and exercises wallet creation, Friendbot funding, XLM payment, bundled Testnet payments, ledger lookups, receipt verification, report export, issued-asset payment after trustline setup, Blend deployment discovery, Blend trustline guidance, Blend Testnet supply and batch transactions, signed-XDR approval submission, trustline add/remove, XLM and issued-asset claimable balance create/claim, approval-gated payment, local x402, local one-time MPP, local MPP session budget, and Stellar CLI contract asset deployment/read/info/invocation/TTL extension when `stellar` is installed.

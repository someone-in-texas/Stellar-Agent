# Testnet Quickstart

Stellar Testnet is a public testing network. It uses valueless XLM funded by Friendbot.

## Initialize

```bash
stellar-agent testnet init
```

This creates `~/.stellar-agent` with Testnet-only wallets, policies, receipts, ledgers, logs, approvals, and scenario folders.

## Wallets

Generated wallet files are Testnet-only and may store local secret keys for convenience. Never reuse Testnet keys on Mainnet.

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
stellar-agent receipts latest
stellar-agent ledger export
```

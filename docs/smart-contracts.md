# Smart Contracts

`stellar-agent` delegates Soroban contract execution to the Stellar CLI. This keeps contract support close to the official toolchain while the project focuses on wallet, policy, receipt, and agent safety.

## Stellar CLI

Install the Stellar CLI first:

```bash
curl -fsSL https://github.com/stellar/stellar-cli/raw/main/install.sh | sh
```

Other supported installation paths include Homebrew, winget, cargo, and the official GitHub Action.

## Invoke

Check readiness first:

```bash
stellar-agent contract doctor --json
```

Agent and sandbox environments can keep Stellar CLI config/cache in a temp directory:

```bash
stellar-agent contract asset-deploy \
  --source agent \
  --asset USDC:G... \
  --stellar-config-dir /private/tmp/stellar-agent-stellar \
  --stellar-no-cache \
  --json
```

For an end-to-end Testnet asset-contract smoke path, use the canned scenario:

```bash
stellar-agent testnet scenario contract-asset-smoke --json
```

The scenario checks Stellar CLI readiness, optionally Friendbot-funds a local source wallet, deploys the native asset contract, verifies the deterministic asset id, reads the contract instance, reads the interface, invokes `symbol`, extends the instance TTL, and writes operation receipts for submitting contract transactions when transaction hashes are reported.

```bash
stellar-agent contract invoke \
  --id C... \
  --source agent \
  --fn hello \
  --arg to=world \
  --json
```

`--source` can be a local Testnet wallet name, a Stellar CLI identity name, a raw public key, or a Testnet secret key. When a local wallet name is used, the CLI passes the Testnet secret key to Stellar CLI for signing and redacts it from output.

Arguments use repeated `--arg key=value` flags. Complex values should be quoted for the shell:

```bash
stellar-agent contract invoke --id C... --source agent --fn configure --arg 'config={"limit":"1000"}'
```

When Stellar CLI reports a Testnet transaction hash, submitting contract commands include `transactionHash` and `receiptPath` in JSON output. This applies to `contract upload`, `contract deploy`, `contract asset-deploy`, `contract invoke`, `contract extend`, and `contract restore` when the command submits a transaction.

## Deploy

Upload Wasm bytecode without creating a contract instance:

```bash
stellar-agent contract upload \
  --source agent \
  --wasm ./target/wasm32-unknown-unknown/release/hello.wasm \
  --json
```

Deploy a Wasm contract with the installed Stellar CLI:

```bash
stellar-agent contract deploy \
  --source agent \
  --wasm ./target/wasm32-unknown-unknown/release/hello.wasm \
  --alias hello \
  --json
```

If the Wasm is already uploaded, deploy by hash:

```bash
stellar-agent contract deploy --source agent --wasm-hash <hash> --json
```

Constructor arguments use repeated `--arg key=value` flags after the deploy command's options.

## Fetch

Fetch regular contract Wasm bytecode by contract id or Wasm hash:

```bash
stellar-agent contract fetch --id C... --out-file ./contract.wasm --json
stellar-agent contract fetch --wasm-hash <hash> --out-file ./contract.wasm --json
```

Built-in Stellar Asset Contracts do not have downloadable Wasm binaries, so `contract fetch` is for regular Wasm contracts.

## Extend And Restore

Extend the TTL for a contract instance:

```bash
stellar-agent contract extend \
  --source agent \
  --id C... \
  --ledgers-to-extend 535679 \
  --json
```

Extend a persistent storage entry by symbol key:

```bash
stellar-agent contract extend \
  --source agent \
  --id C... \
  --key counter \
  --durability persistent \
  --ledgers-to-extend 535679 \
  --json
```

Extend Wasm code TTL by hash:

```bash
stellar-agent contract extend \
  --source agent \
  --wasm-hash <hash> \
  --ledgers-to-extend 535679 \
  --json
```

Restore an archived contract instance, storage entry, or Wasm code:

```bash
stellar-agent contract restore --source agent --id C... --json
stellar-agent contract restore --source agent --id C... --key counter --json
stellar-agent contract restore --source agent --wasm-hash <hash> --json
```

For `extend` and `restore`, choose one target:

- contract instance: `--id C...`
- contract storage entry: `--id C...` with `--key <symbol>` or `--key-xdr <base64>`
- Wasm code: `--wasm <path>` or `--wasm-hash <hash>`

## Asset Contracts

Deploy a Stellar Asset Contract for native XLM or an issued asset:

```bash
stellar-agent contract asset-deploy --source agent --asset native --json
stellar-agent contract asset-deploy --source agent --asset USDC:G... --alias usdc-testnet --json
stellar-agent contract asset-id --asset USDC:G... --json
```

This delegates to `stellar contract asset deploy`.

`contract asset-id` delegates to `stellar contract id asset` and returns the deterministic contract id without submitting a transaction.

## Read

Read a contract instance, storage entry, or Wasm ledger entry:

```bash
stellar-agent contract read --id C... --json
stellar-agent contract read --id C... --key counter --output json --json
stellar-agent contract read --wasm-hash <hash> --output xdr --json
```

For storage entries, use `--durability persistent` or `--durability temporary` to match the target entry.

## Contract Info

Read contract interface, metadata, build info, env metadata, or hash:

```bash
stellar-agent contract info --kind interface --id C... --json
stellar-agent contract info --kind meta --wasm ./contract.wasm --json
stellar-agent contract info --kind hash --wasm ./contract.wasm --json
```

The live Testnet verifier deploys a Stellar Asset Contract, verifies the deploy receipt, checks its deterministic asset id, reads its instance data with `contract read`, extends its instance TTL, verifies the extend receipt, reads its interface with `contract info`, and invokes `symbol` through Stellar CLI when `stellar` is installed. The same path is available directly through `stellar-agent testnet scenario contract-asset-smoke --json`.

## Safety

- Testnet remains the default and recommended development network.
- Mainnet contract operations require `mainnet enable --i-understand-real-funds`, `--allow-real-funds`, and `--i-understand-real-funds`.
- Mainnet contract operations refuse raw secret keys and generated local Testnet wallet secrets.
- Use a Stellar CLI identity, browser-wallet flow, raw public key, or watch-only Mainnet wallet reference for Mainnet custody.
- Mainnet examples must include real-funds disclaimers and must not imply autonomous spending.

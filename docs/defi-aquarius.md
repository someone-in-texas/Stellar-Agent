# Aquarius DeFi

`stellar-agent defi aquarius` adds Testnet-first Aquarius AMM inspection and policy-gated preflight tooling. In this release, Aquarius commands are read-only or preflight-only: they do not sign or submit transactions.

## Deployments

Show known router, API, RPC, Horizon, asset, and documentation metadata:

```bash
stellar-agent defi aquarius deployments --network testnet --json
stellar-agent defi aquarius deployments --network mainnet --json
```

Fetch current Testnet pools from the Aquarius API:

```bash
stellar-agent defi aquarius deployments --network testnet --pools --limit 10 --json
```

The Testnet router is `CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD`. Aquarius documents this as updated in February 2026.

## Pool Inspection

Inspect a pool by contract id, pool index, token, or search term:

```bash
stellar-agent defi aquarius pool inspect --pool XLM --network testnet --json
```

Pool inspection reads Aquarius API metadata such as pool contract address, pool hash, token contracts, token strings, pool type, fee, transaction count, and reported volume.

## Account Position

Inspect account balances relevant to an Aquarius pool:

```bash
stellar-agent defi aquarius account position --account agent --pool XLM --network testnet --json
```

This command is read-only. It reports Horizon balances and any balances matching the selected pool metadata. Soroban pool-share and reward state can differ from classic Horizon balances, so treat the output as an inspection aid rather than withdrawal eligibility proof.

## LP Preflight

Preflight deposits:

```bash
stellar-agent defi aquarius lp preflight \
  --pool XLM \
  --action deposit \
  --account agent \
  --amount 0.0000001 \
  --amount 0.0000001 \
  --min-shares 0.0000001 \
  --network testnet \
  --json
```

Preflight withdrawals:

```bash
stellar-agent defi aquarius lp preflight \
  --pool XLM \
  --action withdraw \
  --account agent \
  --shares 0.0000001 \
  --min-amount 0 \
  --min-amount 0 \
  --network testnet \
  --json
```

LP preflight validates inputs, fetches pool metadata, computes a nominal exposure proxy, and evaluates `defi.aquarius` policy. It does not simulate, sign, or submit a Soroban transaction.

## Swap Quoting And Preflight

Quote a route with Aquarius optimal-path API:

```bash
stellar-agent defi aquarius swap quote \
  --from XLM \
  --to AQUA \
  --amount 0.01 \
  --network testnet \
  --json
```

Preflight the route against policy with explicit slippage bounds:

```bash
stellar-agent defi aquarius swap preflight \
  --from XLM \
  --to AQUA \
  --amount 0.01 \
  --slippage-bps 100 \
  --network testnet \
  --json
```

`swap quote` and `swap preflight` call Aquarius `find-path` or `find-path-strict-receive` APIs and return the route, pools, token path, amount, and swap-chain XDR when available. The commands do not execute the XDR.

## Rewards

Inspect reward claim readiness:

```bash
stellar-agent defi aquarius rewards inspect --pool XLM --account agent --network testnet --json
```

Aquarius rewards are claimed through the pool `claim(user)` contract method. This release reports claim metadata and safety notes only; it does not sign or submit a claim.

## Policy

The policy file includes explicit Aquarius controls:

```yaml
defi:
  aquarius:
    enabled: true
    allowedPools:
      - "*"
    allowedAssets:
      - "*"
    allowedActions:
      - deposit
      - withdraw
      - swap
    maxNominalExposure: "1000"
    requireSlippageBounds: true
```

Default Testnet policy enables Aquarius preflight for deposit, withdraw, and swap with required slippage bounds. Default Mainnet policy disables Aquarius and still requires explicit Mainnet approval if enabled.

## Examples

Run the live Testnet examples after building:

```bash
pnpm examples:defi:testnet
```

The runner executes:

- `examples/defi/blend-testnet.mjs`
- `examples/defi/aquarius-testnet.mjs`

The Aquarius example initializes an isolated Testnet config, loads deployments and pools, inspects a pool, inspects account position metadata, preflights deposit and withdrawal, quotes and preflights a swap, and inspects reward metadata.

## Safety

- Testnet remains the recommended network for Aquarius examples.
- Aquarius commands in this release are read-only or preflight-only.
- Mainnet Aquarius mutation must not auto-sign with local secret keys.
- Mainnet Aquarius mutation requires a future external signer flow, explicit real-funds flags, policy approval, simulation or equivalent preflight, and receipts.
- Aquarius API responses, routes, pool metadata, and third-party contract state are untrusted inputs for policy decisions.
- Quotes and pool snapshots can change before execution.

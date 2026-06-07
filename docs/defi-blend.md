# Blend DeFi

`stellar-agent defi blend` adds Testnet-first Blend inspection and preflight tooling. Mutating DeFi actions are guarded by explicit DeFi policy controls and, on Mainnet, by the same real-funds rules used by contract operations.

## Deployments

List known Blend deployment contracts, pools, asset contract ids, and canonical classic issuers for trustlines:

```bash
stellar-agent defi blend deployments --network testnet --json
stellar-agent defi blend deployments --network mainnet --json
```

Use `--refresh` to fetch the current maps from Blend's public `blend-utils` contract JSON and `blend-ui` environment files:

```bash
stellar-agent defi blend deployments --network testnet --refresh --json
```

The deployment output includes Stellar Asset Contract ids and, where Blend publishes the backing issuer, `classicAsset` values such as `USDC:G...`.

## Pool And Position Inspection

Inspect a known pool alias or a raw pool contract id:

```bash
stellar-agent defi blend pool inspect --pool TestnetV2 --json
```

Inspect a local wallet or raw public key position:

```bash
stellar-agent defi blend position inspect --pool TestnetV2 --account agent --json
```

These commands are read-only. They load Blend pool, reserve, oracle, and user position data through the Blend SDK and Soroban RPC.

## Preflight

Preflight requests before any mutating Blend command:

```bash
stellar-agent defi blend preflight \
  --pool TestnetV2 \
  --account agent \
  --request supply_collateral:USDC:1 \
  --json
```

Request syntax is `type:asset:amount`. Supported request types are:

- `supply`
- `withdraw`
- `supply_collateral`
- `withdraw_collateral`
- `borrow`
- `repay`

Preflight output includes decoded request types, reserve contract ids, fixed-point raw amounts, expected bToken or dToken movement when available, before/after position estimates, health factor when liabilities exist, and the local DeFi policy decision.

## Mutating Testnet Requests

Mutating commands sign only with local Testnet wallets. Mainnet mutation remains blocked unless a future external-signer flow is added.

```bash
stellar-agent defi blend supply --pool TestnetV2 --source agent --asset XLM --amount 1 --collateral --json
stellar-agent defi blend withdraw --pool TestnetV2 --source agent --asset XLM --amount 1 --collateral --json
stellar-agent defi blend repay --pool TestnetV2 --source agent --asset XLM --amount 1 --json
```

Borrowing exists as a command but is denied by the default policy:

```bash
stellar-agent defi blend borrow --pool TestnetV2 --source agent --asset USDC --amount 1 --json
```

Use `batch` for safe multi-request transactions, such as supplying collateral and borrowing in a single transaction after policy allows the borrow:

```bash
stellar-agent defi blend batch \
  --pool TestnetV2 \
  --source agent \
  --request supply_collateral:XLM:1 \
  --request borrow:USDC:0.1 \
  --json
```

Every mutating Blend command runs preflight, evaluates DeFi policy, simulates the Soroban transaction, signs only after those checks pass, submits through RPC, and writes a receipt with public Blend metadata.

## Examples

Run the Blend and Aquarius DeFi Testnet examples together:

```bash
pnpm examples:defi:testnet
```

The Blend example initializes an isolated Testnet config, loads deployments, inspects the Testnet pool, and runs a supply-collateral preflight without submitting a transaction.

## Trustlines

For non-native reserves, resolve the backing classic asset before funding or receiving the asset:

```bash
stellar-agent defi blend trustline guide --asset USDC --account agent --json
stellar-agent defi blend trustline add --asset USDC --account agent --json
```

`trustline add` is Testnet-only for local signing. Mainnet trustline creation requires an external signer.

## Policy

The policy file includes explicit Blend controls:

```yaml
defi:
  blend:
    enabled: true
    allowedPools:
      - "*"
    allowedRequestTypes:
      - supply
      - withdraw
      - supply_collateral
      - withdraw_collateral
      - repay
    maxBorrowValue: "0"
    maxProtocolExposureValue: "1000"
    minimumHealthFactor: 1.5
    requireSimulation: true
```

Default Testnet policy allows non-borrow Blend request types and denies borrowing by default. Default Mainnet policy disables Blend and still requires explicit Mainnet approval if enabled.

## Safety

- Testnet remains the recommended network for Blend examples.
- Mainnet Blend mutation must not auto-sign with local secret keys.
- Borrowing is denied by default until the policy explicitly allows it.
- Non-native reserves require a classic trustline before an account can hold the backing issued asset.
- Receipts for submitted Blend transactions include public Blend metadata such as pool, action, reserve, amount, and position/preflight summaries.
- Blend SDK code is confined to the DeFi adapter and loaded lazily by DeFi commands. Shared payment, policy, receipt, x402, MPP, and Mainnet guard code must not import protocol SDKs.

## Adding Protocol SDK Support

Additional DeFi protocol SDK support must preserve the same boundaries:

- Add the SDK only to the approved adapter package.
- Load the SDK with dynamic `import()` inside adapter functions.
- Keep CLI command registration free of static runtime adapter imports.
- Add protocol-specific policy controls before any mutation command.
- Block Mainnet local auto-signing at both CLI and adapter-library boundaries.
- Add unit tests, docs, and relevant live Testnet examples.
- Update `scripts/check-protocol-sdk-boundaries.mjs` so release safety fails if the SDK leaks into shared packages.

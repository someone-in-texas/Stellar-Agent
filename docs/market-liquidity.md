# Market Liquidity

`stellar-agent market` adds market-aware inspection, alerting, and guarded Testnet liquidity-pool actions. The feature is for investigation and policy-gated execution, not autonomous profit guarantees.

## Core Pool Inspection

Core Stellar liquidity pools are built into the Stellar protocol and are queried through Horizon:

```bash
stellar-agent market pools list --asset-a XLM --asset-b USD:G... --json
stellar-agent market pool inspect --pool 0123... --json
stellar-agent market pool trades --pool 0123... --limit 10 --json
stellar-agent market pool position --account agent --pool 0123... --json
```

Inspection commands are read-only. They report pool ids, reserve assets, reserve amounts, fee basis points, total shares, recent trades, and local pool-share positions when available.

## LP Preflight

Run preflight before any deposit or withdrawal:

```bash
stellar-agent market lp preflight \
  --pool 0123... \
  --max-a 1 \
  --max-b 2 \
  --min-price 1.5 \
  --max-price 2.5 \
  --json
```

Deposit preflight reports reserve assets, current reserve price, trustline status, explicit price bounds, estimated pool shares, risk notes, nominal exposure, and the `market.liquidity` policy decision.

`nominalExposure.value` is a policy-control proxy: for deposits it is `max-a + max-b` after Stellar amount normalization. It is not a mark-to-market, USD value, or profitability estimate because the two reserve assets can have different units and external values. Withdrawals report `0.0000000` with `not_applicable_to_withdrawal` semantics because they reduce pool-share exposure instead of adding new reserve amounts.

Withdrawal preflight uses pool shares and minimum reserve outputs:

```bash
stellar-agent market lp preflight \
  --pool 0123... \
  --action withdraw \
  --shares 0.5 \
  --min-a 0 \
  --min-b 0 \
  --json
```

Quotes and estimates are Horizon snapshots. They can change before transaction submission.

## Pool-Share Trustlines

An account must hold a pool-share trustline before depositing into a core liquidity pool:

```bash
stellar-agent market lp trustline add --pool 0123... --account agent --fee-strategy medium --json
```

You can derive the pool-share trustline from reserve assets:

```bash
stellar-agent market lp trustline add --asset-a XLM --asset-b USD:G... --account agent --fee-strategy medium --json
```

Trustline creation is Testnet-only for local signing. Mainnet trustline creation requires a future external-signer flow. In this release, LP deposit and withdrawal preflight expect an existing Horizon-visible core pool so the CLI can inspect reserve assets, current price, and risk context before submission.

## Testnet LP Mutation

Testnet deposit and withdrawal commands run preflight, evaluate policy, submit through Horizon only if policy allows, and write receipts:

```bash
stellar-agent market lp deposit \
  --pool 0123... \
  --max-a 1 \
  --max-b 2 \
  --min-price 1.5 \
  --max-price 2.5 \
  --json

stellar-agent market lp withdraw \
  --pool 0123... \
  --shares 0.5 \
  --min-a 0 \
  --min-b 0 \
  --json
```

Mainnet local auto-signing is blocked. See `docs/mainnet-safety.md#mainnet-liquidity`.

`market lp deposit` targets existing core pools. Bootstrapping a brand-new core pool from only reserve assets is future work because the first deposit lacks Horizon reserve data for the current preflight model.

## Policy

Default Testnet policy enables guarded core liquidity-pool requests:

```yaml
market:
  liquidity:
    enabled: true
    allowedPools:
      - "*"
    allowedAssets:
      - "*"
    allowedActions:
      - deposit
      - withdraw
    maxPoolExposureValue: "1000"
    requirePriceBounds: true
```

Default Mainnet policy disables liquidity mutation. Policy can constrain pool ids, reserve assets, allowed actions, nominal exposure values, and whether deposit price bounds are required.

## Market Listeners

Listeners evaluate finite alert checks and return JSON events:

```bash
stellar-agent market listen price --pool 0123... --above 2 --json
stellar-agent market listen position --pool 0123... --account agent --shares-below 1 --json
```

Listeners do not approve or submit transactions. Agents should treat a triggered event as a reason to re-run preflight, not as permission to mutate funds.

## Strategy Investigation

Strategy commands explain or simulate proposals without signing:

```bash
stellar-agent strategy explain ./strategy.yaml --json
stellar-agent strategy simulate ./strategy.yaml --json
stellar-agent strategy investigate liquidity --pair XLM/USD:G... --json
stellar-agent strategy investigate liquidity --pool 0123... --json
```

Strategy output is intentionally conservative. It records required controls and risk notes and reports `submitted: false`.

## Soroban Pool Boundary

Soroban liquidity pools are contract-specific. Generic contract ids are not enough to safely infer pool semantics, pricing, deposits, withdrawals, or receipt metadata.

Read-only interface inspection is available:

```bash
stellar-agent market soroban pool inspect --id C... --json
```

Mutation preflight reports an adapter boundary:

```bash
stellar-agent market soroban pool preflight --id C... --action deposit --json
```

Soroban AMM mutation requires a future protocol-specific adapter with documented interfaces, policy controls, simulation, external Mainnet signing, and receipts.

## Safety Notes

- Liquidity fees are not guaranteed profit.
- LP positions can underperform simply holding reserve assets.
- Testnet liquidity does not prove Mainnet profitability.
- Issued-asset pools carry issuer and trustline risk.
- Agents must not weaken policy files to execute a strategy.
- Mainnet mutation requires external signing and explicit real-funds acknowledgement.

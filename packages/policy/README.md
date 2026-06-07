# @stellar-agent/policy

Deterministic policy parsing and decision logic for Stellar Agent workflows.

This package evaluates payment requests, Blend DeFi requests, Aquarius AMM preflight requests, and core Stellar liquidity-pool requests against explicit policy controls.

## Install

```bash
npm install @stellar-agent/policy
```

## Example

```js
import { defaultPolicyForNetwork, evaluatePaymentRequest } from "@stellar-agent/policy";

const policy = defaultPolicyForNetwork("testnet");
const decision = evaluatePaymentRequest(policy, {
  network: "testnet",
  destination: "G...",
  amount: "1",
  asset: "XLM",
  spendHistory: { dailyTotal: "0", monthlyTotal: "0", knownRecipients: [], knownDomains: [] }
});
```

## Policy Areas

- Payment limits, allowed assets, recipients, and domains.
- Blend pool, request-type, borrow, exposure, health-factor, and simulation rules.
- Aquarius pool, asset, action, exposure, and slippage-bound rules.
- Core liquidity-pool asset, action, exposure, and price-bound rules.

## Safety

Policy evaluation is prompt-independent and should run before signing or submission. Mainnet decisions are approval-gated by default.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Threat model: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/threat-model.md
- Mainnet safety: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/mainnet-safety.md

# @stellar-agent/defi

Protocol-specific DeFi adapters for Stellar Agent inspection, preflight, and guarded Testnet workflows.

This package includes Blend lending helpers and Aquarius AMM helpers. Blend supports deployment discovery, pool and position inspection, preflight, and guarded Testnet mutation helpers. Aquarius supports deployment discovery, pool inspection, account-position reads, LP preflight, swap quote/preflight, and rewards inspection; Aquarius commands in this release are read-only or preflight-only.

## Install

```bash
npm install @stellar-agent/defi
```

## Example

```js
import { aquariusDeployment, preflightAquariusSwap } from "@stellar-agent/defi";

const deployment = aquariusDeployment("testnet");
const preflight = await preflightAquariusSwap({
  network: "testnet",
  inputAsset: "XLM",
  outputAsset: "AQUA",
  amount: "0.01",
  mode: "strict_send",
  slippageBps: 100
});
```

## Safety

- Mainnet DeFi mutation must not use local generated wallet secrets.
- Blend mutation should run preflight, policy, simulation, and receipt logging.
- Aquarius API responses, routes, pool metadata, and swap-chain XDR are untrusted policy inputs.
- Third-party protocol SDKs stay isolated to this adapter package and are loaded lazily.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Blend docs: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/defi-blend.md
- Aquarius docs: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/defi-aquarius.md
- Threat model: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/threat-model.md

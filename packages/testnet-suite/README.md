# @stellar-agent/testnet-suite

Reusable Testnet workspace, wallet, Friendbot, policy, receipt, and smoke-test workflows for Stellar Agent.

This package powers CLI commands such as Testnet initialization, smoke tests, issued-asset scenarios, contract-asset smoke scenarios, wallet imports, trustline inspection, and public wallet views.

## Install

```bash
npm install @stellar-agent/testnet-suite
```

## Example

```js
import { createTestnetHarness, initTestnetWorkspace } from "@stellar-agent/testnet-suite";

const harness = createTestnetHarness();
const initialized = await initTestnetWorkspace(harness.config, { fundAgent: true });
```

## Safety

- Generated wallets are Testnet-only.
- Testnet XLM has no real value.
- Mainnet watch-only wallet imports store public keys only.
- Scenario helpers should preserve receipt logging and policy checks when they submit transactions.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Testnet quickstart: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/quickstart-testnet.md
- npm CLI package: https://www.npmjs.com/package/@stellar-agent/cli

# @stellar-agent/mpp-client

Local MPP Testnet demos plus durable cross-process session-budget accounting.

This package implements concrete local flows:

- one-time `402 -> policy -> Testnet payment -> retry with proof`
- session-budget `402 -> policy -> Testnet budget payment -> repeated proof requests`

`reserveMppSessionDebit` provides atomic persistent debits for production adapter sessions without selecting or endorsing a facilitator.

## Install

```bash
npm install @stellar-agent/mpp-client
```

## CLI Entry Points

```bash
stellar-agent testnet scenario mpp-payment --json
stellar-agent pay mpp http://127.0.0.1:PORT/mpp-report --allow-localhost-demo --json
```

## Safety

- CLI wire protocols are local Testnet demos.
- Production adapters must bind durable state to the exact network, facilitator origin, recipient, asset, and approved budget, and independently reconcile settlement.
- Payment policy and receipts are handled by the CLI flow before and after Testnet payment submission.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Testnet quickstart: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/quickstart-testnet.md
- npm CLI package: https://www.npmjs.com/package/@stellar-agent/cli

# @stellar-agent/mpp-client

Local MPP one-time charge and session-budget client support for the Testnet demo.

This package implements concrete local flows:

- one-time `402 -> policy -> Testnet payment -> retry with proof`
- session-budget `402 -> policy -> Testnet budget payment -> repeated proof requests`

Production facilitator flows are not implemented yet.

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

- This package is for local Testnet demos.
- Production facilitator-backed MPP support is intentionally out of scope for this release.
- Payment policy and receipts are handled by the CLI flow before and after Testnet payment submission.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Testnet quickstart: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/quickstart-testnet.md
- npm CLI package: https://www.npmjs.com/package/@stellar-agent/cli

# @stellar-agent/x402-client

Local x402-style client support for the Testnet demo.

This package implements a concrete local `402 -> policy -> Testnet payment -> retry with proof` flow. It is not a full facilitator-backed Soroban auth-entry x402 implementation yet.

## Install

```bash
npm install @stellar-agent/x402-client
```

## CLI Entry Points

```bash
stellar-agent testnet scenario x402-payment --json
stellar-agent pay x402 http://127.0.0.1:PORT/paid-report --allow-localhost-demo --json
```

## Safety

- This package is for local Testnet demos.
- Production facilitator-backed x402 support is intentionally out of scope for `0.4.x`.
- Payment policy and receipts are handled by the CLI flow before and after Testnet payment submission.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Testnet quickstart: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/quickstart-testnet.md
- npm CLI package: https://www.npmjs.com/package/@stellar-agent/cli

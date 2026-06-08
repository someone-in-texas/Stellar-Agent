# TypeScript SDK Examples

Short TypeScript examples for developers who want to import Stellar Agent packages directly instead of shelling out to the CLI.

Examples:

- `src/aquarius-quote-preflight.ts` quotes and preflights an Aquarius swap with explicit slippage bounds.
- `src/market-lp-preflight.ts` preflights a core Stellar liquidity-pool deposit.
- `src/approval-request-handling.ts` creates, lists, reads, and decides a local approval request.

Typecheck them with:

```bash
pnpm --filter stellar-agent-example-sdk-typescript typecheck
```

These examples are Testnet-oriented and do not sign or submit transactions.

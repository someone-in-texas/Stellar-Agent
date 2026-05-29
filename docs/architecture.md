# Architecture

The project is CLI first. Shared packages implement safety-critical logic and the CLI orchestrates them.

Allowed dependency direction:

```text
cli -> testnet-suite -> stellar -> core
cli -> policy -> core
cli -> ledger-logger -> core
```

Adapters such as Freighter, x402, MPP, MCP, and Codex plugin packaging should call shared library code or CLI flows instead of duplicating payment logic.

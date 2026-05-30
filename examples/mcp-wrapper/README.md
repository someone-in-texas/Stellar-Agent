# MCP Wrapper Example

MCP support is implemented by `@stellar-agent/mcp-server`.

Local checkout:

```bash
pnpm build
STELLAR_AGENT_CLI=packages/cli/dist/index.js node packages/mcp-server/dist/server.js
```

Installed package:

```bash
stellar-agent-mcp
```

The server is stdio-based and exposes tools that delegate to `stellar-agent --json`, including Testnet wallet setup, trustlines, payments, claimable balances, and Stellar CLI-backed contract calls.

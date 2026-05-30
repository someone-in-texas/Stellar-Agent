# @stellar-agent/mcp-server

MCP stdio server for `stellar-agent`.

The server exposes agent-safe tools for the existing CLI workflows instead of duplicating payment logic. Tools include Testnet init/doctor/Friendbot funding, issued-asset and contract-asset smoke scenarios, wallet creation and balances, trustline add/remove, payment quote/send, local x402 and MPP HTTP payments, claimable balance create/list/claim, and Stellar CLI-backed contract operations including asset deploy, info, read, fetch, invoke, upload, deploy, extend, and restore.

Build and run from a checkout:

```bash
pnpm build
STELLAR_AGENT_CLI=packages/cli/dist/index.js node packages/mcp-server/dist/server.js
```

When installed globally, `stellar-agent-mcp` uses the `stellar-agent` binary by default. Set `STELLAR_AGENT_CLI=/path/to/stellar-agent` or `STELLAR_AGENT_CLI=/path/to/packages/cli/dist/index.js` to override it.

Every tool calls `stellar-agent --json` and returns the parsed JSON output plus the CLI exit code.

# @stellar-agent/mcp-server

MCP stdio server for `stellar-agent`.

The server exposes agent-safe tools for the existing CLI workflows instead of duplicating payment logic. Tools include Testnet init/doctor/Friendbot funding, issued-asset and contract-asset smoke scenarios, wallet creation and balances, trustline add/remove, fee-aware payment quote/send, guarded Testnet batch payments, local x402 and MPP HTTP payments, claimable balance create/list/claim, core Stellar liquidity-pool list/inspect/trade/position/preflight/listener workflows, strategy liquidity investigation, and Stellar CLI-backed contract operations including asset deploy, info, read, fetch, invoke, upload, deploy, extend, and restore.

## Install

```bash
npm install @stellar-agent/mcp-server
```

## Run

Build and run from a checkout:

```bash
pnpm build
STELLAR_AGENT_CLI=packages/cli/dist/index.js node packages/mcp-server/dist/server.js
```

When installed globally, `stellar-agent-mcp` uses the `stellar-agent` binary by default. Set `STELLAR_AGENT_CLI=/path/to/stellar-agent` or `STELLAR_AGENT_CLI=/path/to/packages/cli/dist/index.js` to override it.

Every tool calls `stellar-agent --json` and returns the parsed JSON output plus the CLI exit code.

The stdio transport parses `Content-Length` as UTF-8 bytes and accepts messages up to 4 MiB. Spawned CLI calls are terminated after five minutes or when combined stdout and stderr exceed 1 MiB, preventing a stalled or noisy command from holding the MCP server indefinitely.

## Safety

The MCP server delegates to the CLI so policy checks, Mainnet guards, redaction, and receipt behavior stay centralized. Tools should stop on `requires_approval` unless the user explicitly approves the guarded flow.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Agent integration docs: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/agent-integration.md
- Codex plugin docs: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/codex-plugin.md

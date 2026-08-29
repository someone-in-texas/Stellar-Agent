# npm Packages

Most users should install the CLI package:

```bash
npm install -g @stellar-agent/cli
stellar-agent testnet doctor --json
```

You can also run the CLI without a global install:

```bash
npx @stellar-agent/cli testnet doctor --json
```

The other scoped packages are public so applications and agent runtimes can embed specific pieces of the toolkit without shelling out to the CLI.

| Package                                                                                                    | Install                                           | Use When                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`@stellar-agent/cli`](https://www.npmjs.com/package/@stellar-agent/cli)                                   | `npm install -g @stellar-agent/cli`               | You want the `stellar-agent` command.                                                     |
| [`@stellar-agent/core`](https://www.npmjs.com/package/@stellar-agent/core)                                 | `npm install @stellar-agent/core`                 | You need shared config, amount parsing, envelopes, errors, or redaction helpers.          |
| [`@stellar-agent/policy`](https://www.npmjs.com/package/@stellar-agent/policy)                             | `npm install @stellar-agent/policy`               | You need deterministic policy evaluation in an app.                                       |
| [`@stellar-agent/stellar`](https://www.npmjs.com/package/@stellar-agent/stellar)                           | `npm install @stellar-agent/stellar`              | You need Stellar SDK or Stellar CLI adapters.                                             |
| [`@stellar-agent/defi`](https://www.npmjs.com/package/@stellar-agent/defi)                                 | `npm install @stellar-agent/defi`                 | You need Blend or Aquarius inspection and preflight helpers.                              |
| [`@stellar-agent/ledger-logger`](https://www.npmjs.com/package/@stellar-agent/ledger-logger)               | `npm install @stellar-agent/ledger-logger`        | You need receipts, event logs, or spend-history helpers.                                  |
| [`@stellar-agent/freighter-bridge`](https://www.npmjs.com/package/@stellar-agent/freighter-bridge)         | `npm install @stellar-agent/freighter-bridge`     | You need local approval request or Freighter bridge primitives.                           |
| [`@stellar-agent/walletconnect-bridge`](https://www.npmjs.com/package/@stellar-agent/walletconnect-bridge) | `npm install @stellar-agent/walletconnect-bridge` | You need WalletConnect external-signing helpers for LOBSTR or compatible Stellar wallets. |
| [`@stellar-agent/mcp-server`](https://www.npmjs.com/package/@stellar-agent/mcp-server)                     | `npm install @stellar-agent/mcp-server`           | You want an MCP stdio server that delegates to the CLI.                                   |
| [`@stellar-agent/testnet-suite`](https://www.npmjs.com/package/@stellar-agent/testnet-suite)               | `npm install @stellar-agent/testnet-suite`        | You need reusable Testnet workspace and scenario helpers.                                 |
| [`@stellar-agent/x402-client`](https://www.npmjs.com/package/@stellar-agent/x402-client)                   | `npm install @stellar-agent/x402-client`          | You need local Testnet x402-style demo helpers.                                           |
| [`@stellar-agent/mpp-client`](https://www.npmjs.com/package/@stellar-agent/mpp-client)                     | `npm install @stellar-agent/mpp-client`           | You need local Testnet MPP demo helpers.                                                  |
| [`@stellar-agent/codex-plugin`](https://www.npmjs.com/package/@stellar-agent/codex-plugin)                 | `npm install @stellar-agent/codex-plugin`         | You need Codex plugin validation and manifest tooling.                                    |

Typed direct-import examples are available in [`examples/sdk-typescript`](../examples/sdk-typescript), including Aquarius quote/preflight, core market LP preflight, and local approval request handling.

The 0.6.0 packages target `@stellar/stellar-sdk` 17.0.1 and require Node.js 22.12 or newer. Direct consumers that manipulate XDR or byte values should read the [SDK 17 migration guide](stellar-sdk-17-migration.md).

## Package README Preview

npm renders the `README.md` included in each package tarball. To preview what npm will receive before publishing:

```bash
pnpm release:pack
tar -xOf .release/artifacts/npm/stellar-agent-cli-0.6.0.tgz package/README.md
pnpm release:verify-readmes
```

README changes require a new package version before they appear on npmjs.com.

## Safety Defaults

- Testnet remains the default.
- Generic Mainnet local auto-signing remains blocked; only the explicitly enabled risk-budgeted agent-wallet payment path may autosign.
- Secret keys are redacted from CLI output, logs, and receipts.
- Policy checks run before submitted payment and protocol workflows.

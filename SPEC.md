# SPEC.md - Stellar Agent Bridge

## Project summary

`stellar-agent-bridge` is an open-source, CLI-first toolkit for safe agentic payments on Stellar.

The project provides:

- A native TypeScript CLI for Stellar Testnet and guarded Mainnet workflows.
- A full Testnet suite that can create wallets, fund them with Friendbot, run test transactions, inspect ledger data, and export auditable receipts.
- A policy engine for spend limits, approval rules, network restrictions, privacy redaction, and transaction explainability.
- A local Freighter approval bridge for human-in-the-loop signing.
- Agent-friendly JSON output for Codex, OpenClaw, shell scripts, MCP wrappers, and other agent frameworks.
- Optional Codex plugin/skill packaging.
- Optional MCP and ChatGPT app wrappers built on top of the same core logic.
- Strong documentation, smoke tests, unit tests, and open-source contribution guidance.

The product goal is:

> Install to first agentic Stellar Testnet payment in 10 minutes.

The security goal is:

> Agents can request payments, but users stay in control of signing, spend limits, approval rules, and ledger visibility.

The design principle is:

> CLI first. Core library underneath. Adapters on top.

---

## Background and rationale

AI agents increasingly need to interact with paid APIs, data sources, compute services, and digital resources. Traditional API keys, monthly subscriptions, and account-specific billing are poorly suited for autonomous, per-request workflows.

Stellar is a strong candidate for agentic payments because it supports fast settlement, low transaction costs, native assets, issued assets, Soroban smart contracts, and HTTP-native payment patterns such as x402 and MPP.

However, the developer experience needs a safer bridge between:

- Agent frameworks.
- Wallets.
- Payment protocols.
- Human approval.
- Testnet experimentation.
- Mainnet readiness.

This project should make Stellar feel like a practical local capability for agents:

```bash
stellar-agent testnet init
stellar-agent testnet smoke-test
stellar-agent pay x402 https://example.com/paid-report --json
```

The agent should not need to understand private keys, transaction XDR, ledger polling, Friendbot funding, or policy enforcement. The CLI should handle those concerns in a transparent, auditable way.

---

## Non-goals for the first release

Do not build these in the initial release unless all higher-priority items are complete:

- A hosted custodial wallet.
- A marketplace.
- A production-grade payment facilitator.
- A generalized crypto wallet.
- A mobile app.
- A full ChatGPT app with Mainnet signing.
- A replacement for Freighter.
- A complex database-backed service.
- A custom blockchain indexer.
- Real-money autonomous spending without human approval.

The first release should be a safe, useful, auditable local bridge.

---

## Release scope

The first implementation should be intentionally narrow, but complete enough to prove the core workflow with tests.

### v0 target

The v0 target is:

- Monorepo scaffold.
- Core types, errors, JSON result helpers, and redaction helpers.
- Policy schema, evaluator, explanations, and fixtures.
- File-based config and local state.
- Testnet wallet creation, Friendbot funding, balance lookup, and basic XLM payment.
- Receipt and JSONL event logging.
- CLI help, JSON output, exit codes, and smoke tests.
- Placeholder x402 and MPP commands with stable not-implemented behavior.
- Initial documentation, AGENTS.md, and security guidance.

### v0 placeholders

The following folders or commands may exist in v0 as explicit placeholders with README files, tests, and stable not-implemented output:

- `packages/x402-client`
- `packages/mpp-client`
- `packages/freighter-bridge`
- `packages/mcp-server`
- `packages/codex-plugin`
- `examples/freighter-manual`
- `examples/paid-api-demo`
- `plugins/codex`

Placeholders must be honest. They should explain the intended role, link to relevant docs, and avoid hidden payment, signing, or network side effects.

### Later milestones

After v0, implementation should proceed in this order unless maintainers decide otherwise:

1. Freighter Testnet approval bridge.
2. Codex plugin packaging.
3. Local x402 Testnet demo.
4. MPP one-time Testnet demo.
5. Guarded Mainnet readiness.
6. Optional MCP and ChatGPT app adapters.

---

## Target users

### 1. Developers

Developers want to clone the repo, run the CLI, inspect the code, and test agentic Stellar payments safely.

They should be able to:

```bash
pnpm install
pnpm build
pnpm test
pnpm cli -- testnet init
pnpm cli -- testnet smoke-test
```

### 2. Agent framework users

Users of Codex, OpenClaw, Claude Code, Cursor, shell agents, and future tools want a command-line payment bridge with predictable JSON output.

They should be able to tell an agent:

> Run the Stellar Testnet x402 demo and add the receipt summary to the README.

### 3. Security reviewers

Security reviewers want:

- Clear threat model.
- No secret key leakage.
- No Mainnet auto-spend by default.
- Policy-first design.
- Unit tests for spend policy decisions.
- Reproducible Testnet scenarios.
- Ledger receipts.
- Clear error behavior.

### 4. Stellar ecosystem contributors

Stellar developers want an easy demonstration of:

- Testnet onboarding.
- Friendbot funding.
- Payment sending.
- x402/MPP compatibility.
- RPC/Horizon ledger inspection.
- Freighter signing.
- Agent integrations.

---

## Technical stack

### Primary language

Use TypeScript.

### Runtime

Use Node.js 22 LTS or newer.

### Package manager

Use pnpm.

### Monorepo

Use pnpm workspaces. Turborepo is optional but recommended if it improves developer ergonomics.

### CLI framework

Use Commander.js unless there is a compelling reason not to.

Requirements:

- Every command must have useful `--help`.
- Every command that returns meaningful data must support `--json`.
- Commands must use clear exit codes.
- Commands must avoid printing secrets.
- Commands must support `--profile`.
- Commands must support `--config`.
- Commands must support `--no-color`.

### Validation

Use Zod for:

- Config validation.
- Policy validation.
- CLI argument validation where helpful.
- JSON output schema validation in tests.

### Testing

Use Vitest.

Test categories:

- Unit tests.
- Integration tests with mocked network clients.
- Opt-in live Testnet smoke tests.
- CLI snapshot/help tests.
- Security regression tests.

### Stellar dependencies

Use the official JavaScript SDK package:

```bash
pnpm add @stellar/stellar-sdk
```

Use `@stellar/freighter-api` for the local Freighter approval bridge.

MPP and x402 packages should be added only when implementing those phases, but the repo should leave package boundaries ready for them.

Expected packages:

```bash
pnpm add @stellar/stellar-sdk @stellar/freighter-api
```

Later:

```bash
pnpm add @stellar/mpp mppx
```

### HTTP server

Use Fastify for local services:

- Freighter approval bridge server.
- Demo paid API.
- Optional MCP server.
- Optional ChatGPT app server.

### Local UI

Use Vite + React for:

- Freighter approval UI.
- Future ChatGPT app widget.
- Optional local dashboard.

### Documentation site

Do not build a full docs site initially. Use Markdown files first.

Possible future docs system:

- VitePress, Docusaurus, or Starlight.

---

## Repository structure

Create the repo with this structure:

```text
stellar-agent-bridge/
  .changeset/
  .devcontainer/
    devcontainer.json
  .github/
    workflows/
      ci.yml
      smoke-test.yml
      release.yml
  docs/
    quickstart.md
    quickstart-testnet.md
    agent-integration.md
    codex-plugin.md
    openclaw.md
    mainnet-safety.md
    threat-model.md
    security.md
    ledger-logging.md
    x402-and-mpp.md
    troubleshooting.md
    architecture.md
  examples/
    freighter-manual/
    paid-api-demo/
    walletconnect-manual/
    shell/
    codex/
    openclaw/
    mcp-wrapper/
    express-paid-api/
  packages/
    cli/
    core/
    policy/
    stellar/
    testnet-suite/
    ledger-logger/
    x402-client/
    mpp-client/
    freighter-bridge/
    mcp-server/
    codex-plugin/
  plugins/
    codex/
      plugin.yaml
      README.md
      skills/
        stellar-agent-testnet/
          SKILL.md
          agents/
            openai.yaml
        stellar-agent-payments/
          SKILL.md
          agents/
            openai.yaml
  scripts/
    check-help.ts
    smoke-test-local.ts
    smoke-test-testnet.ts
  .editorconfig
  .env.example
  .gitignore
  .npmrc
  AGENTS.md
  CHANGELOG.md
  CODE_OF_CONDUCT.md
  CONTRIBUTING.md
  LICENSE
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  README.md
  SECURITY.md
  SPEC.md
  tsconfig.base.json
```

If some package folders are placeholders in the first pass, include a README in each explaining the intended role.

---

## Workspace architecture contract

Package boundaries should make safety-critical behavior easy to test without invoking the CLI.

Use ESM throughout the workspace. Package names should use the `@stellar-agent/*` namespace unless maintainers choose a different npm scope before publishing.

Suggested package names:

- `@stellar-agent/core`
- `@stellar-agent/policy`
- `@stellar-agent/stellar`
- `@stellar-agent/testnet-suite`
- `@stellar-agent/ledger-logger`
- `@stellar-agent/cli`
- `@stellar-agent/freighter-bridge`
- `@stellar-agent/x402-client`
- `@stellar-agent/mpp-client`
- `@stellar-agent/mcp-server`
- `@stellar-agent/codex-plugin`

Allowed dependency direction:

```text
cli -> testnet-suite -> stellar -> core
cli -> policy -> core
cli -> ledger-logger -> core
freighter-bridge -> core
x402-client -> policy/core/stellar/ledger-logger
mpp-client -> policy/core/stellar/ledger-logger
mcp-server -> core/policy/stellar/testnet-suite/ledger-logger
codex-plugin -> core
```

Rules:

- `core` must not depend on any local package.
- `policy` must not depend on `stellar` or `cli`.
- `stellar` must not depend on `cli`.
- `ledger-logger` must not depend on `cli`.
- `cli` should contain thin orchestration only.
- Adapters must call shared library code or CLI flows instead of duplicating payment logic.
- Each package should build independently.
- TypeScript project references, Turborepo, or another build orchestrator may be used if the commands remain simple.

The initial implementation should include a lightweight dependency-boundary check, even if it starts as a simple script that fails on forbidden workspace imports.

---

## Package responsibilities

### `packages/core`

Shared primitives used by all other packages.

Responsibilities:

- Amount parsing.
- Asset representation.
- Network profile representation.
- Command result types.
- Error classes.
- JSON output helpers.
- Redaction helpers.
- Common schemas.
- Receipt types.
- Approval request types.
- Shared logging types.

Do not put CLI-specific code here.

### `packages/policy`

Policy engine.

Responsibilities:

- Load policy YAML.
- Validate policy with Zod.
- Evaluate payment requests.
- Evaluate transaction requests.
- Explain allow/deny/approval decisions.
- Redact sensitive data from policy explanations.
- Provide machine-readable and human-readable decision output.

Must include thorough tests.

### `packages/stellar`

Stellar network integration.

Responsibilities:

- Network profile resolution.
- RPC client factory.
- Horizon client factory if needed.
- Friendbot client.
- Testnet account creation.
- Balance lookup.
- Basic XLM payment building.
- Payment submission.
- Submit-and-poll lifecycle.
- Ledger lookup.
- Transaction lookup.
- Account lookup.
- Error normalization.

Do not store secrets here.

### `packages/testnet-suite`

Reusable Testnet harness.

Responsibilities:

- Create agent/merchant/auditor test wallets.
- Fund accounts with Friendbot.
- Reset local Testnet state.
- Run canned scenarios.
- Export scenario reports.
- Provide `createTestnetHarness()` for other packages.

### `packages/ledger-logger`

Receipt and ledger logging.

Responsibilities:

- Write JSON receipts.
- Write JSONL event logs.
- Export reports.
- Redact sensitive fields.
- Verify receipt integrity.
- Provide stable schema versions.

### `packages/cli`

The native command-line interface.

Responsibilities:

- CLI command registration.
- Help text.
- User-friendly terminal output.
- JSON output mode.
- Exit codes.
- Config path resolution.
- Calls into core/policy/stellar/testnet-suite packages.

CLI should contain thin orchestration only.

### `packages/freighter-bridge`

Local browser wallet bridge.

Responsibilities:

- Start localhost approval server.
- Serve approval UI directly or document manual browser-wallet flows under `examples/freighter-manual`.
- Integrate with Freighter.
- Request address.
- Request signing.
- Return signed result to CLI.
- Show clear human-readable transaction explanation before signing.

### `packages/x402-client`

x402 client support.

Responsibilities:

- Detect HTTP 402 response.
- Parse payment requirements.
- Evaluate policy.
- Request signing.
- Retry request with payment proof/authorization.
- Return response body and receipt data.
- Prevent redirect-based payment changes unless policy allows.

### `packages/mpp-client`

MPP support.

Responsibilities:

- Parse MPP charge/session requirements.
- Support basic one-time charge flow.
- Support later session flow if feasible.
- Evaluate policy and approval rules.
- Log receipts.

### `packages/mcp-server`

Optional adapter.

Responsibilities:

- Expose MCP tools that call the same core library/CLI flows.
- Keep MCP thin.
- Avoid duplicating payment logic.
- Start with Testnet-only tools.

### `packages/codex-plugin`

Optional shared code for Codex plugin packaging.

Responsibilities:

- Validate plugin files.
- Provide scripts/examples used by `plugins/codex`.
- Document how Codex should call the CLI.

---

## Stellar network operation defaults

Network operations should have conservative defaults and stable error behavior.

Default timeouts and polling:

- HTTP request timeout: 15 seconds.
- Transaction confirmation timeout: 60 seconds.
- Transaction polling interval: 2 seconds.
- Friendbot attempts: 2 total attempts.
- Transaction submit attempts: 1 by default.

Retry rules:

- Friendbot funding may retry once on transient network failure.
- Transaction submission should not blindly retry unless the implementation can safely identify the same transaction hash and avoid duplicate/confusing results.
- Lookup and polling commands may retry transient network failures within the overall timeout.
- All timeout and retry failures must normalize to stable error codes.

Client usage:

- Horizon should be used initially for balances, account lookup, transaction lookup, payment history, and Friendbot-adjacent Testnet flows.
- Soroban RPC should be available in network profiles but reserved for simulation, Soroban, or future flows that need it.
- Commands should avoid requiring both Horizon and RPC unless the command actually needs both.

Transaction confirmation:

- A payment is considered successful only after the transaction is confirmed successful by the configured network client.
- A submitted transaction with an unknown final state must be reported as timeout or unknown, not success.
- Receipts for successful payments must include transaction hash, ledger if available, fee charged if available, source, destination, amount, and asset.

The implementation must include mocked tests for success, network unavailable, timeout, failed transaction, unknown final state, and error normalization.

---

## CLI command design

The CLI binary should be:

```bash
stellar-agent
```

All commands must have useful examples in help output.

Every command should support:

```bash
stellar-agent <command> --help
stellar-agent <command> --json
stellar-agent <command> --profile testnet
stellar-agent <command> --config ./stellar-agent.yaml
stellar-agent <command> --no-color
```

Global options:

```text
--profile <name>        Network profile to use: testnet, mainnet, local
--config <path>         Path to config file
--policy <path>         Path to policy file
--json                  Print machine-readable JSON
--no-color              Disable colored output
--verbose               Print additional diagnostics
--quiet                 Suppress nonessential output
--no-cache              Disable session caches for network lookups
```

### CLI behavior contract

All commands must follow the same output and exit-code rules.

Output streams:

- `stdout` is for primary command output.
- `stderr` is for warnings, progress, diagnostics, and human-readable error context.
- In `--json` mode, `stdout` must contain exactly one JSON object.
- In `--json` mode, `stderr` may contain diagnostics only when `--verbose` is passed or when a process-level failure prevents JSON output.
- Secrets must never be printed to either stream unless a Testnet-only command explicitly requires `--show-secret-testnet-only`.

Success JSON envelope:

```json
{
  "ok": true,
  "data": {}
}
```

Error JSON envelope:

```json
{
  "ok": false,
  "error": {
    "code": "POLICY_DENIED",
    "message": "Payment request was denied by policy.",
    "hint": "Run policy explain to inspect the matched rules.",
    "docs": "docs/troubleshooting.md#policy-denied"
  }
}
```

Exit codes:

```text
0  success
1  general failure
2  invalid CLI usage or invalid command input
3  config or policy validation failure
4  policy denied
5  approval required or approval denied
6  network unavailable
7  transaction failed or timed out
8  feature not implemented
```

Human-readable output should be concise, useful, and safe to paste into an issue. JSON output should be stable enough for agents and shell scripts to parse.

### Top-level help

`stellar-agent --help` must explain the 10-minute path:

```text
Stellar Agent Bridge

Safe agentic payments on Stellar from your terminal.

Quick start:
  stellar-agent testnet init
  stellar-agent testnet smoke-test
  stellar-agent testnet scenario basic-payment
  stellar-agent receipts latest

Common commands:
  stellar-agent testnet doctor
  stellar-agent wallet balance
  stellar-agent pay send --to G... --amount 1 --asset XLM
  stellar-agent policy explain --request ./payment-request.json
```

---

## Command groups

### `profile`

```bash
stellar-agent profile list
stellar-agent profile use testnet
stellar-agent profile inspect
stellar-agent profile add
stellar-agent profile remove
```

Acceptance criteria:

- `profile list --json` returns all configured profiles.
- `profile inspect testnet` shows network passphrase, RPC URL, Horizon URL, and Friendbot URL.
- `profile use mainnet` warns that Mainnet uses real funds.
- Mainnet cannot be used for payment commands until explicitly enabled.

### `testnet`

```bash
stellar-agent testnet doctor
stellar-agent testnet init
stellar-agent testnet reset
stellar-agent testnet friendbot
stellar-agent testnet fund # alias for friendbot
stellar-agent testnet create-pair
stellar-agent testnet smoke-test
stellar-agent testnet scenario basic-payment
stellar-agent testnet scenario policy-denied
stellar-agent testnet scenario approval-required
stellar-agent testnet scenario x402-payment
stellar-agent testnet export-report
```

#### `testnet doctor`

Checks:

- Node version.
- CLI version.
- Config exists.
- Testnet profile exists.
- RPC endpoint reachable.
- Horizon endpoint reachable if used.
- Friendbot endpoint reachable.
- Local wallet state valid.
- Local receipts/logs writable.
- Freighter bridge availability if requested.

#### `testnet init`

Creates local Testnet workspace:

```text
~/.stellar-agent/
  config.yaml
  profiles.yaml
  wallets/
  policies/
  receipts/
  ledgers/
  approvals/
  scenarios/
  logs/
```

Creates:

- Agent wallet.
- Merchant wallet.
- Optional auditor wallet.

Funds agent/merchant accounts using Friendbot.

Writes:

- Default Testnet policy.
- Initial receipt/event logs.
- README in local workspace explaining what was created.

Important safety rule:

- Testnet secrets may be stored locally for convenience but must be clearly labeled as Testnet-only.
- Never reuse Testnet keys on Mainnet.
- Never print secret keys unless the user passes an explicit `--show-secret-testnet-only` flag.

#### `testnet friendbot`

Supports:

```bash
stellar-agent testnet friendbot --account agent
stellar-agent testnet friendbot --address G...
stellar-agent testnet friendbot --json
```

Acceptance criteria:

- Funds a valid Testnet account.
- Handles already-funded accounts gracefully.
- Returns transaction hash if available.
- Provides clear diagnostics if Friendbot is unavailable.
- Supports JSON output.

#### `testnet smoke-test`

Runs:

1. `testnet doctor`
2. Ensure wallets exist.
3. Ensure wallets are funded.
4. Send small XLM payment from agent to merchant.
5. Confirm transaction.
6. Fetch ledger data.
7. Write receipt.
8. Print summary.

Acceptance criteria:

- One command proves install-to-payment lifecycle.
- `--json` output includes receipt path, transaction hash, ledger, source, destination, amount, and asset.
- Human-readable output includes next steps.

#### `testnet scenario basic-payment`

Runs a canned payment scenario with detailed logs.

#### `testnet scenario policy-denied`

Creates a payment request that violates the default policy and verifies denial.

Acceptance criteria:

- No transaction is signed.
- No transaction is submitted.
- Receipt/event log records denied request.
- Output explains the rule that blocked it.

#### `testnet scenario approval-required`

Creates a payment request that is under hard limit but over auto-approval threshold.

Acceptance criteria:

- Decision is `requires_approval`.
- If `--auto-deny` is passed, scenario completes without signing.
- If `--approve-testnet` is passed, scenario proceeds on Testnet.
- Mainnet must never support `--approve-testnet`.

#### `testnet scenario x402-payment`

Can initially be a placeholder that starts the demo paid API and proves the flow once x402 is implemented.

Acceptance criteria for phase 1:

- Command exists.
- Help explains that x402 support is in progress if not implemented.
- Tests assert graceful unavailable/incomplete status.

Acceptance criteria for x402 phase:

- Starts or uses demo paid API.
- Receives 402.
- Parses payment requirements.
- Evaluates policy.
- Signs/pays on Testnet.
- Retries request.
- Saves response body.
- Writes receipt.

### `wallet`

```bash
stellar-agent wallet create
stellar-agent wallet create-testnet
stellar-agent wallet connect-freighter
stellar-agent wallet balance
stellar-agent wallet address
stellar-agent wallet export-public
stellar-agent wallet import-public
stellar-agent wallet use-env
stellar-agent wallet status
```

Acceptance criteria:

- `wallet create-testnet` creates a keypair and stores it in local Testnet wallet storage.
- `wallet balance --json` returns structured balances.
- `wallet connect-freighter` opens local browser approval UI once the Freighter bridge phase is implemented.
- Before the Freighter bridge phase, `wallet connect-freighter` may follow the staged feature placeholder contract.
- `wallet import-public` supports watch-only Mainnet wallets.
- Secret-key import is not required for v1.

### `pay`

```bash
stellar-agent pay send
stellar-agent pay quote
stellar-agent pay batch
stellar-agent pay x402
stellar-agent pay mpp
```

#### `pay send`

Example:

```bash
stellar-agent pay send --to G... --amount 1 --asset XLM --memo "test" --profile testnet
```

Acceptance criteria:

- Validates destination.
- Validates amount.
- Evaluates policy.
- Builds payment transaction.
- Explains transaction.
- Signs only if policy allows or required approval is granted.
- Submits and polls.
- Logs receipt.

#### `pay quote`

Does not sign or submit.

Returns:

- Asset.
- Amount.
- Destination.
- Estimated fee.
- Policy decision.
- Approval requirement.
- Network profile.

#### `pay batch`

Bundles 1 to 100 Testnet payment operations from one local source wallet into one transaction.

Acceptance criteria:

- Reads a JSON array of payment objects from `--file`.
- Validates every destination, amount, and asset before signing.
- Evaluates policy for every payment and advances in-memory daily/monthly spend totals across the bundle.
- Fails before signing if any payment is denied or approval-required.
- Uses Horizon fee stats by default with `--fee-strategy base|low|medium|high|p95`.
- Writes an operation receipt containing public batch metadata.
- Must not support Mainnet auto-signing.

#### `pay x402`

Initial requirements:

- Detect HTTP 402.
- Return parsed payment requirements.
- Do not pay until policy and approval are implemented.
- Provide clear TODO status.

Full requirements:

- Parse x402 payment requirements.
- Evaluate policy.
- Bind payment to URL/domain/request.
- Prevent payment on redirect unless policy allows.
- Sign with Testnet wallet or Freighter.
- Retry request.
- Log receipt.

#### `pay mpp`

Same staged approach as x402.

### `tx`

```bash
stellar-agent tx build
stellar-agent tx simulate
stellar-agent tx explain
stellar-agent tx sign
stellar-agent tx submit
```

Acceptance criteria:

- `tx explain` must be safe and useful for humans.
- `tx sign` must never sign opaque transactions on Mainnet without explicit approval.
- `tx submit` must poll until confirmed, failed, duplicate, or timed out.
- All results support JSON output.

### `ledger`

```bash
stellar-agent ledger latest
stellar-agent ledger account
stellar-agent ledger tx
stellar-agent ledger payments
stellar-agent ledger effects
stellar-agent ledger export
```

Acceptance criteria:

- Ledger commands can inspect data generated by smoke tests.
- `ledger tx <hash>` returns transaction details.
- `ledger account agent` resolves local named wallet.
- `ledger export --latest-run` creates a JSON report.

### `receipts`

```bash
stellar-agent receipts list
stellar-agent receipts latest
stellar-agent receipts show
stellar-agent receipts verify
stellar-agent receipts export
```

Acceptance criteria:

- Receipts use stable schema version.
- Receipts never include secret keys.
- Receipts redact sensitive URLs by default.
- `verify` checks required fields and optional hash/integrity metadata.

### `policy`

```bash
stellar-agent policy init
stellar-agent policy check
stellar-agent policy explain
stellar-agent policy test
```

Acceptance criteria:

- `policy init` writes safe default Testnet policy.
- `policy check` validates YAML.
- `policy explain` returns human-readable explanation.
- `policy test` runs bundled policy fixtures.

### `mainnet`

```bash
stellar-agent mainnet status
stellar-agent mainnet enable
stellar-agent mainnet disable
stellar-agent mainnet readiness
```

Acceptance criteria:

- Mainnet is disabled by default.
- Enabling Mainnet requires explicit flag:

```bash
stellar-agent mainnet enable --i-understand-real-funds
```

- Mainnet payments require approval by default.
- Mainnet auto-approval must be disabled by default.
- Mainnet commands must display real-funds warnings in human output.
- JSON output must include `realFunds: true`.

---

## Config design

Default config path:

```text
~/.stellar-agent/config.yaml
```

Example:

```yaml
version: 1

activeProfile: testnet

profiles:
  testnet:
    network: testnet
    networkPassphrase: "Test SDF Network ; September 2015"
    horizonUrl: "https://horizon-testnet.stellar.org"
    rpcUrl: "https://soroban-testnet.stellar.org"
    friendbotUrl: "https://friendbot.stellar.org"
    defaultAsset: "XLM"

  mainnet:
    network: public
    networkPassphrase: "Public Global Stellar Network ; September 2015"
    horizonUrl: "https://horizon.stellar.org"
    rpcUrl: null
    friendbotUrl: null
    defaultAsset: "XLM"
    enabled: false
    requiresExplicitApproval: true

storage:
  rootDir: "~/.stellar-agent"
  receiptsDir: "~/.stellar-agent/receipts"
  ledgersDir: "~/.stellar-agent/ledgers"
  logsDir: "~/.stellar-agent/logs"

output:
  color: true
  json: false
  redactSensitiveData: true
```

### Configuration resolution

Config values must resolve in this order:

1. Explicit CLI flags.
2. Environment variables.
3. Config file values.
4. Built-in defaults.

Environment variables:

```text
STELLAR_AGENT_PROFILE
STELLAR_AGENT_CONFIG
STELLAR_AGENT_POLICY
STELLAR_AGENT_HOME
STELLAR_SECRET_KEY
```

Path rules:

- `~` must expand to the current user's home directory.
- Relative CLI flag paths resolve from the current working directory.
- Relative paths inside config files resolve relative to the config file location.
- Stored paths in JSON output should be absolute unless a documented schema field explicitly stores a display path.

State rules:

- `testnet init` must be idempotent by default.
- `testnet init` must not overwrite existing wallets or policies unless passed an explicit overwrite flag.
- `testnet reset --soft` clears generated scenario state, temporary reports, and nonessential logs while preserving wallets and policies.
- `testnet reset --wallets` also removes Testnet wallet files and must require `--yes` in non-interactive contexts.
- Destructive reset commands must never remove Mainnet config or Freighter connection metadata unless a future command explicitly supports that with a separate real-funds warning.

The implementation must include unit tests for precedence, path expansion, missing config behavior, invalid config behavior, and reset planning before destructive file operations run.

---

## Local wallet storage

Local wallet state should be file-based in v0.

Default layout:

```text
~/.stellar-agent/wallets/
  testnet-agent.json
  testnet-merchant.json
  testnet-auditor.json
  freighter-connections.json
```

Testnet wallet file:

```json
{
  "schemaVersion": "stellar-agent.wallet.v1",
  "name": "agent",
  "network": "testnet",
  "publicKey": "G...",
  "secretKey": "S...",
  "createdAt": "2026-05-29T12:34:56.000Z",
  "source": "generated-testnet"
}
```

Freighter connection metadata:

```json
{
  "schemaVersion": "stellar-agent.freighterConnection.v1",
  "connections": [
    {
      "network": "testnet",
      "publicKey": "G...",
      "connectedAt": "2026-05-29T12:34:56.000Z"
    }
  ]
}
```

Storage requirements:

- Testnet secret keys may be stored locally only in Testnet wallet files.
- Testnet wallet files should be written with `0600` permissions where the platform supports POSIX file modes.
- Mainnet secret-key storage is not implemented in v0.
- Mainnet watch-only wallets may store public keys only.
- `STELLAR_SECRET_KEY` is for advanced headless use and must never be read for Mainnet unless a future Mainnet flow explicitly supports it with additional safeguards.
- Wallet JSON output must redact secret fields.
- Receipts, event logs, reports, and errors must never include secret keys.

The implementation must include tests for wallet schema validation, redaction, JSON output safety, and file permissions where supported.

---

## Policy design

Default Testnet policy:

```yaml
version: 1
name: default-testnet-policy
network: testnet

assets:
  allow:
    - XLM

limits:
  perTransaction: "10 XLM"
  dailyTotal: "100 XLM"
  monthlyTotal: "1000 XLM"

approval:
  requireForAllPayments: false
  requireForNewRecipient: false
  requireForNewDomain: false
  requireAbove: "5 XLM"

x402:
  enabled: false
  allowDomains: []
  maxPricePerRequest: "1 XLM"
  bindPaymentToUrl: true
  denyRedirectPaymentChanges: true

privacy:
  redactUrlQueryParamsInLogs: true
  blockPiiInReason: true
  blockedMemoPatterns:
    - "ssn"
    - "password"
    - "secret"
    - "api_key"

logging:
  writeReceipts: true
  writeEventLog: true
```

Default Mainnet policy:

```yaml
version: 1
name: default-mainnet-policy
network: mainnet

assets:
  allow:
    - XLM
    - USDC

limits:
  perTransaction: "0.05 XLM"
  dailyTotal: "0.25 XLM"
  monthlyTotal: "1 XLM"

approval:
  requireForAllPayments: true
  requireForNewRecipient: true
  requireForNewDomain: true
  requireAbove: "0 XLM"

x402:
  enabled: false
  allowDomains: []
  maxPricePerRequest: "0.05 XLM"
  bindPaymentToUrl: true
  denyRedirectPaymentChanges: true

safety:
  simulationRequired: true
  explainTransactionRequired: true
  blockBlindSigning: true
  blockOpaqueTransactions: true

privacy:
  redactUrlQueryParamsInLogs: true
  blockPiiInReason: true
  blockedMemoPatterns:
    - "ssn"
    - "password"
    - "secret"
    - "api_key"

logging:
  writeReceipts: true
  writeEventLog: true
```

### Policy semantics

Policy evaluation must be deterministic and testable.

Amount rules:

- Stellar amounts must be represented as decimal strings.
- Native XLM amounts must normalize to 7 decimal places when serialized for transactions or receipts.
- The implementation must not use floating-point math for payment amounts, fees, or limits.
- Invalid, negative, zero, over-precision, or non-finite amounts must be rejected before policy evaluation.

Asset rules:

- Native XLM is represented as `XLM`.
- Issued assets are represented as `CODE:ISSUER_G_ADDRESS`.
- Asset codes and issuers must be validated before policy evaluation.
- Unknown asset formats must be denied or rejected with a stable validation error.

Spend-history rules:

- v0 computes daily and monthly totals from local event logs and receipts.
- Daily totals use UTC calendar days.
- Monthly totals use UTC calendar months.
- If spend history cannot be read or parsed, payment commands must fail closed.
- Read-only commands such as `pay quote` and `policy explain` should report the history problem without signing or submitting.

Recipient and domain rules:

- `requireForNewRecipient` is evaluated against prior approved local receipts.
- `requireForNewDomain` is evaluated against prior approved local receipts for x402/MPP flows.
- Missing local history means the recipient or domain should be treated as new.

Decision rules:

- Policy evaluation should collect all relevant matched rules where feasible.
- Denials take precedence over approval requirements.
- Approval requirements take precedence over auto-allow.
- Explanations must be safe for logs and must redact sensitive URLs or likely PII according to the active privacy policy.

The implementation must include fixtures for allow, deny, approval-required, unsupported asset, unreadable history, new recipient, new domain, and privacy redaction cases.

---

## Policy decision model

Policy decisions must use one of these statuses:

```ts
type PolicyDecisionStatus =
  | "allowed"
  | "denied"
  | "requires_approval";
```

Decision output:

```json
{
  "status": "requires_approval",
  "network": "testnet",
  "realFunds": false,
  "matchedRules": [
    "amount_under_hard_limit",
    "amount_above_auto_approval_threshold"
  ],
  "reasons": [
    "Payment is under the per-transaction limit.",
    "Payment is above the auto-approval threshold."
  ],
  "approval": {
    "required": true,
    "reason": "amount_above_auto_approval_threshold"
  }
}
```

Denial output:

```json
{
  "status": "denied",
  "network": "mainnet",
  "realFunds": true,
  "matchedRules": [
    "mainnet_requires_approval",
    "domain_not_allowlisted"
  ],
  "reasons": [
    "Mainnet payments require explicit approval.",
    "The requested payment domain is not allowlisted."
  ]
}
```

---

## Receipt schema

Receipt files should use stable schema versions.

Example:

```json
{
  "schemaVersion": "stellar-agent.receipt.v1",
  "id": "rec_20260529_abc123",
  "createdAt": "2026-05-29T12:34:56.000Z",
  "command": "testnet scenario basic-payment",
  "profile": "testnet",
  "network": {
    "name": "testnet",
    "passphrase": "Test SDF Network ; September 2015",
    "realFunds": false
  },
  "payment": {
    "source": "G...",
    "destination": "G...",
    "asset": "XLM",
    "amount": "1.0000000",
    "memo": "stellar-agent smoke test"
  },
  "policyDecision": {
    "status": "allowed",
    "matchedRules": ["testnet_default", "amount_under_limit"]
  },
  "transaction": {
    "hash": "...",
    "ledger": 123456,
    "successful": true,
    "feeCharged": "100"
  },
  "ledger": {
    "latestLedgerBefore": 123455,
    "confirmedLedger": 123456
  },
  "files": {
    "eventLog": "~/.stellar-agent/logs/events.jsonl"
  },
  "redactions": {
    "urlQueryParamsRedacted": true,
    "secretKeysIncluded": false
  }
}
```

---

## Event log schema

Use JSONL.

Example line:

```json
{"schemaVersion":"stellar-agent.event.v1","at":"2026-05-29T12:34:56.000Z","event":"policy_decision","status":"allowed","command":"pay send","profile":"testnet","requestId":"req_abc123"}
```

Events:

- `command_started`
- `command_finished`
- `policy_decision`
- `approval_requested`
- `approval_granted`
- `approval_denied`
- `transaction_built`
- `transaction_signed`
- `transaction_submitted`
- `transaction_confirmed`
- `transaction_failed`
- `receipt_written`
- `error`

---

## Error handling

All errors should have:

- Stable code.
- Human message.
- Optional hint.
- Optional docs link.
- JSON representation.

Example:

```json
{
  "ok": false,
  "error": {
    "code": "FRIENDBOT_UNAVAILABLE",
    "message": "Could not fund the Testnet account with Friendbot.",
    "hint": "Check your internet connection or try again later.",
    "docs": "docs/troubleshooting.md#friendbot-unavailable"
  }
}
```

Error categories:

- `CONFIG_NOT_FOUND`
- `CONFIG_INVALID`
- `PROFILE_NOT_FOUND`
- `MAINNET_NOT_ENABLED`
- `POLICY_INVALID`
- `POLICY_DENIED`
- `APPROVAL_REQUIRED`
- `APPROVAL_DENIED`
- `WALLET_NOT_FOUND`
- `WALLET_INVALID`
- `SECRET_KEY_BLOCKED`
- `FRIENDBOT_UNAVAILABLE`
- `RPC_UNAVAILABLE`
- `HORIZON_UNAVAILABLE`
- `TRANSACTION_BUILD_FAILED`
- `TRANSACTION_SUBMIT_FAILED`
- `TRANSACTION_TIMEOUT`
- `LEDGER_LOOKUP_FAILED`
- `X402_NOT_IMPLEMENTED`
- `MPP_NOT_IMPLEMENTED`

---

## Security requirements

These are mandatory.

### Secret handling

- Never print secret keys by default.
- Never include secret keys in receipts.
- Never include secret keys in logs.
- Never include secret keys in JSON output.
- Testnet secret export requires `--show-secret-testnet-only`.
- Mainnet secret import is out of scope for v1 unless implemented with OS keychain and explicit warnings.

### Mainnet safety

- Mainnet disabled by default.
- Mainnet payments require explicit approval by default.
- Mainnet auto-approval disabled by default.
- Mainnet commands include real-funds warnings.
- Mainnet payment commands require `mainnet enable --i-understand-real-funds`.
- Mainnet JSON output includes `realFunds: true`.

### Agent safety

- Agents can request payment actions.
- Policy decides whether payment is allowed, denied, or approval-required.
- Agents must not bypass policy.
- Agents must not access raw secrets.
- Agents must not silently enable Mainnet.
- Agents must not silently change policy files to weaken safety.

### Logging safety

- Redact query params from URLs by default.
- Redact likely PII from reason strings where possible.
- Block sensitive memo patterns.
- Provide `--unsafe-include-full-url` only for local debugging, never default.
- Receipts should include enough info for audit without leaking secrets.

### Transaction safety

- Explain before signing.
- Simulate before signing where feasible.
- Block opaque Mainnet transactions.
- Block redirect-based payment changes unless policy explicitly allows.
- Bind x402/MPP payments to intended URL/domain when supported.
- Detect duplicate/replay-like flows where feasible.

---

## Freighter bridge requirements

The Freighter bridge is a local human approval flow.

Command:

```bash
stellar-agent wallet connect-freighter
```

Expected flow:

1. CLI starts localhost server.
2. CLI opens browser to `http://127.0.0.1:<port>/connect`.
3. User connects Freighter.
4. CLI receives public address.
5. CLI stores wallet connection metadata, not secrets.

Approval flow:

1. CLI prepares transaction or auth entry.
2. CLI starts approval page.
3. UI displays:
   - Network.
   - Asset.
   - Amount.
   - Source.
   - Destination.
   - Domain/request origin if applicable.
   - Memo.
   - Fee.
   - Policy decision.
   - Simulation result if available.
   - Raw XDR/auth details behind reveal toggle.
4. User approves or denies.
5. Freighter signs if approved.
6. CLI submits or returns signed result.
7. Receipt is written.

Acceptance criteria:

- No secret keys handled by CLI.
- User sees transaction explanation before signing.
- Denial is logged.
- Signing result is never printed with secret data.
- Works with Testnet first.
- Mainnet support requires explicit Mainnet enablement.

---

## x402 requirements

Implementation should be staged.

### Phase x402-a: discovery and graceful placeholder

- Add `stellar-agent pay x402`.
- Add help text.
- Detect 402 if feasible.
- If full support is not implemented, return `X402_NOT_IMPLEMENTED` with guidance.
- Add docs describing the intended flow.

### Phase x402-b: local demo

- Add `examples/paid-api-demo`.
- Demo endpoint returns machine-readable 402.
- CLI parses requirements.
- Policy checks payment.
- Testnet payment is made.
- Request is retried.
- Response is returned.
- Receipt is written.

### Phase x402-c: hardened client

- Domain binding.
- Redirect protection.
- Policy allowlist.
- Duplicate/replay checks where feasible.
- Better errors.
- Integration tests.

---

## MPP requirements

Implementation should also be staged.

### Phase mpp-a: docs and placeholders

- Add `stellar-agent pay mpp`.
- Add docs.
- Return clear not-yet-implemented error.

### Phase mpp-b: one-time charge flow

- Parse MPP charge response.
- Evaluate policy.
- Pay with Testnet wallet.
- Retry request.
- Log receipt.

### Phase mpp-c: session flow

- Support only if safe and clearly scoped.
- Require stricter policy.
- Require approval for session budget.
- Log per-request spending.

---

## Staged feature placeholder contract

Commands for staged features must be useful before full implementation.

Placeholder commands include:

- `stellar-agent pay x402`
- `stellar-agent pay mpp`
- `stellar-agent testnet scenario x402-payment`
- Future MCP or ChatGPT adapter commands if added before implementation.

Placeholder behavior:

- `--help` must exit `0`.
- Running the placeholder command must exit `8`.
- Human output must briefly explain that the feature is not implemented in the current build and point to relevant docs.
- JSON output must use the standard error envelope.
- Placeholder commands must not read secret keys.
- Placeholder commands must not request signing.
- Placeholder commands must not submit transactions.
- Placeholder commands must not create successful payment receipts.
- Placeholder commands may write an event log entry only if logging is already initialized and the event clearly states that no payment was attempted.

Example JSON:

```json
{
  "ok": false,
  "error": {
    "code": "X402_NOT_IMPLEMENTED",
    "message": "x402 payments are not implemented in this build.",
    "hint": "Use the Testnet smoke test or read docs/x402-and-mpp.md for current support status.",
    "docs": "docs/x402-and-mpp.md"
  }
}
```

The implementation must include CLI tests for placeholder exit codes, JSON shape, help output, and absence of payment side effects.

---

## Codex plugin requirements

Create a Codex plugin under:

```text
plugins/codex/
```

The plugin should bundle:

- Skill for Testnet workflows.
- Skill for payment workflows.
- Optional MCP wrapper config later.
- README explaining install and usage.
- Examples.

### `plugins/codex/skills/stellar-agent-testnet/SKILL.md`

Should teach Codex to:

- Prefer Testnet for demos.
- Run `stellar-agent testnet doctor`.
- Run `stellar-agent testnet init` if workspace is missing.
- Run `stellar-agent testnet smoke-test --json`.
- Add receipt summaries to docs when asked.
- Never print secrets.
- Never enable Mainnet without explicit user request.

### `plugins/codex/skills/stellar-agent-payments/SKILL.md`

Should teach Codex to:

- Use `--json`.
- Run `policy explain` before payment commands.
- Treat `requires_approval` as a stop unless the user explicitly approves.
- Never weaken policy files.
- Never bypass the CLI.
- Prefer `pay quote` before `pay send`.

### Codex examples

Add:

```text
examples/codex/
  README.md
  prompts/
    build-testnet-demo.md
    run-smoke-test.md
    add-x402-demo.md
```

---

## AGENTS.md requirements

Create root `AGENTS.md`.

It should instruct coding agents:

```markdown
# AGENTS.md

## Project priorities

1. Preserve safety defaults.
2. Keep CLI behavior stable and documented.
3. Prefer Testnet in examples.
4. Never print or log secret keys.
5. Add tests for policy changes.
6. Update docs when commands change.
7. Keep Mainnet guarded.
8. Prefer small, reviewable commits.

## Before changing payment logic

- Read `docs/threat-model.md`.
- Read `docs/mainnet-safety.md`.
- Add or update policy tests.
- Run `pnpm test`.

## Do not

- Add Mainnet auto-signing.
- Store Mainnet secret keys in plain text.
- Print private keys.
- Disable policy checks.
- Bypass receipt logging.
```

---

## Documentation requirements

Create these docs in `docs/`.

### `docs/quickstart.md`

Goal:

> From install to first Testnet payment in 10 minutes.

Must include:

```bash
npm install -g stellar-agent-bridge
stellar-agent testnet init
stellar-agent testnet smoke-test
stellar-agent receipts latest
```

Include expected output.

### `docs/quickstart-testnet.md`

Must explain:

- Testnet.
- Friendbot.
- Test wallets.
- Testnet-only secrets.
- How to reset.
- How to inspect ledger data.
- How to export report.

### `docs/agent-integration.md`

Must include:

- Shell integration.
- JSON output.
- Exit codes.
- Example agent prompt.
- How to parse receipts.

### `docs/codex-plugin.md`

Must include:

- How to install/use plugin.
- How skills are organized.
- Example Codex prompts.
- Safety expectations.

### `docs/openclaw.md`

Must include:

- How OpenClaw or another shell-capable agent can call CLI.
- Suggested prompts.
- JSON parsing notes.

### `docs/mainnet-safety.md`

Must be very clear.

Include:

- Mainnet uses real funds.
- Mainnet disabled by default.
- Recommended Freighter-only signing.
- No autonomous Mainnet payments by default.
- Policy examples.
- Readiness checklist.

### `docs/threat-model.md`

Must include:

- Assets protected.
- Trusted components.
- Untrusted components.
- Threats.
- Mitigations.
- Out-of-scope risks.

Threats to cover:

- Agent prompt injection.
- Secret key leakage.
- Policy weakening.
- Overpayment.
- Replay/duplicate payment.
- Redirect payment changes.
- Paid but service fails.
- Log privacy leaks.
- Mainnet/Testnet confusion.
- Malicious paid API.
- Malicious contributor.

### `docs/security.md`

Must include:

- Reporting vulnerabilities.
- Safety defaults.
- Key handling.
- Supported versions.
- Security review checklist.

### `docs/ledger-logging.md`

Must include:

- Receipt schema.
- Event log schema.
- Export examples.
- Redaction behavior.

### `docs/x402-and-mpp.md`

Must include:

- High-level concepts.
- Project support status.
- Current limitations.
- Planned flow diagrams.

### `docs/troubleshooting.md`

Must include:

- Friendbot unavailable.
- RPC unavailable.
- Testnet reset.
- Invalid wallet.
- Mainnet disabled.
- Policy denied.
- Approval denied.
- Transaction timeout.

---

## README requirements

The root README should be polished for open-source release.

Must include:

- Project description.
- Status badge placeholders.
- Safety warning.
- 10-minute quickstart.
- CLI examples.
- Agent integration example.
- Testnet suite explanation.
- Mainnet safety section.
- Architecture summary.
- Contributing link.
- License.
- Roadmap.

Opening paragraph:

```markdown
`stellar-agent-bridge` is an open-source CLI and local wallet bridge for safe agentic payments on Stellar. It gives developers and AI agents a Testnet-first way to create wallets, fund accounts, run payments, inspect ledger data, enforce spend policies, and produce auditable receipts - with guarded Mainnet support when users are ready.
```

---

## `.gitignore` requirements

Must ignore:

```gitignore
node_modules/
dist/
coverage/
.turbo/
.env
.env.*
!.env.example
*.log

# Local Stellar Agent state
.stellar-agent/
wallets/
receipts/
ledgers/
approvals/
logs/

# OS/editor
.DS_Store
.vscode/*
!.vscode/extensions.json
.idea/
```

Do not ignore docs, examples, or plugin files.

---

## `.env.example`

Include:

```env
STELLAR_AGENT_PROFILE=testnet
STELLAR_AGENT_CONFIG=~/.stellar-agent/config.yaml
STELLAR_AGENT_POLICY=~/.stellar-agent/policies/default-testnet.yaml

# Advanced/headless use only. Do not use for Mainnet unless you understand the risks.
STELLAR_SECRET_KEY=
```

---

## Spec consistency and naming rules

Use these names consistently throughout the project:

- Repository and npm package name: `stellar-agent-bridge`.
- CLI binary: `stellar-agent`.
- Workspace package scope: `@stellar-agent/*` unless maintainers choose a different publishing scope.
- Receipts command group: `stellar-agent receipts ...`.
- Ledger command group: `stellar-agent ledger ...`.
- Root security policy file: `SECURITY.md`.
- Security guide: `docs/security.md`.

Command consistency:

- `stellar-agent testnet friendbot` is the explicit Friendbot funding command.
- `stellar-agent testnet fund` may be kept as a user-friendly alias for `testnet friendbot`, but help output must identify it as an alias.
- `stellar-agent receipts latest` is the canonical command for showing the latest receipt.
- Denied policy decisions must write an event log entry. They must not create a successful payment receipt.
- `testnet init` should fund agent and merchant accounts if they need starting Testnet XLM.
- `pay send --profile testnet` may auto-sign with the local Testnet key only when policy returns `allowed`.
- `pay send --profile mainnet` must not auto-sign.

Script consistency:

- `pnpm smoke` must be offline and suitable for normal CI.
- `pnpm smoke:testnet` and `pnpm test:live:testnet` may require network access and must be opt-in.
- If both live Testnet scripts exist, `pnpm smoke:testnet` should be a user-facing smoke alias and `pnpm test:live:testnet` should be the test-runner-oriented command used by CI workflow dispatch.

Documentation consistency:

- README quickstart should use the installed CLI command.
- Contributor/developer docs may also show `pnpm cli -- ...` for local checkout workflows.
- Docs must not imply that x402, MPP, Freighter, MCP, or Mainnet flows are implemented before they are.

---

## Testing requirements

### Unit tests

Required areas:

- Amount parsing.
- Asset parsing.
- Config validation.
- Policy allow.
- Policy deny.
- Policy approval required.
- Mainnet disabled behavior.
- Secret redaction.
- Receipt writing.
- Event logging.
- Error formatting.
- Help text includes examples.

### Integration tests with mocks

Required areas:

- Friendbot success.
- Friendbot failure.
- RPC unavailable.
- Transaction submit success.
- Transaction timeout.
- Ledger lookup.
- x402 placeholder behavior.
- MPP placeholder behavior.

### Live Testnet tests

Must be opt-in:

```bash
pnpm test:live:testnet
```

Do not run live Testnet tests in normal CI by default.

Live tests should:

- Create Testnet wallet.
- Fund from Friendbot.
- Send tiny payment.
- Confirm transaction.
- Write receipt.
- Export report.

### CLI smoke tests

Add:

```bash
pnpm smoke
pnpm smoke:testnet
```

`pnpm smoke` should not require network access.

`pnpm smoke:testnet` may require network access and should be opt-in.

---

## CI requirements

Use GitHub Actions initially, even if the project is later mirrored to Bitbucket.

Workflows:

### `ci.yml`

Runs on PR and main.

Steps:

- Checkout.
- Setup Node 22.
- Setup pnpm.
- Install.
- Typecheck.
- Lint.
- Unit tests.
- Build.
- CLI help smoke tests.

### `smoke-test.yml`

Manual workflow dispatch.

Runs opt-in live Testnet smoke test.

### `release.yml`

Can be placeholder initially.

Eventually:

- Changesets versioning.
- Build.
- Publish packages.
- Attach release notes.

---

## Commit strategy for Codex

Codex should make small, reviewable commits.

Recommended commit sequence:

1. `chore: initialize TypeScript monorepo`
2. `docs: add project specification and contribution guidelines`
3. `chore: add linting, formatting, and test setup`
4. `feat(core): add shared types, errors, and JSON output helpers`
5. `feat(policy): add policy schema and decision engine`
6. `test(policy): cover allow deny and approval decisions`
7. `feat(stellar): add network profiles and friendbot client`
8. `feat(testnet): add testnet init and funding workflow`
9. `feat(cli): add command framework and global options`
10. `feat(cli): add profile and wallet commands`
11. `feat(cli): add testnet doctor init and smoke-test commands`
12. `feat(ledger): add receipt and event logging`
13. `feat(cli): add basic payment command`
14. `test(cli): add help and smoke tests`
15. `docs: add quickstart and testnet guides`
16. `docs: add threat model and mainnet safety guide`
17. `feat(codex): add Codex plugin skills and examples`
18. `feat(x402): add placeholder command and docs`
19. `feat(mpp): add placeholder command and docs`
20. `chore: add CI workflows`

Codex should not make one giant commit.

---

## Implementation phases

### Phase 0 - Repo foundation

Deliverables:

- Monorepo initialized.
- pnpm configured.
- TypeScript configured.
- Vitest configured.
- ESLint/Prettier configured.
- README draft.
- AGENTS.md.
- CONTRIBUTING.md.
- SECURITY.md.
- CODE_OF_CONDUCT.md.
- LICENSE.
- .gitignore.
- .env.example.

Acceptance criteria:

- `pnpm install` works.
- `pnpm build` works.
- `pnpm test` works.
- `pnpm lint` works.
- README explains project.

### Phase 1 - Core and policy

Deliverables:

- Core types.
- Error types.
- Output helpers.
- Redaction helpers.
- Policy schema.
- Policy evaluator.
- Policy explanation.
- Policy tests.

Acceptance criteria:

- Policy can allow, deny, or require approval.
- Mainnet default policy requires approval.
- Tests cover key safety rules.

### Phase 2 - Stellar/Testnet basics

Deliverables:

- Network profiles.
- Friendbot client.
- Testnet wallet generation.
- Balance lookup.
- Basic payment build/submit/poll.
- Ledger lookup.
- Mocked integration tests.

Acceptance criteria:

- Can create/fund Testnet accounts.
- Can send XLM on Testnet in live opt-in smoke test.
- Can write receipt.

### Phase 3 - CLI

Deliverables:

- `stellar-agent` binary.
- Global options.
- `profile` commands.
- `wallet` commands.
- `testnet` commands.
- `policy` commands.
- `ledger` commands.
- `receipts` commands.
- Help text tests.

Acceptance criteria:

- `stellar-agent --help` is useful.
- `stellar-agent testnet init` works.
- `stellar-agent testnet smoke-test --json` works on live Testnet.
- Commands return stable JSON.

### Phase 4 - Ledger logging and receipts

Deliverables:

- Receipt schema.
- Event log schema.
- Export reports.
- Receipt verification.
- Redaction tests.

Acceptance criteria:

- Every payment attempt produces event log.
- Successful payment produces receipt.
- Denied policy produces event log.
- No secrets are logged.

### Phase 5 - Documentation and agent files

Deliverables:

- All docs listed above.
- AGENTS.md refined.
- Codex examples.
- OpenClaw examples.
- Shell examples.

Acceptance criteria:

- A new developer can follow quickstart.
- An agent can follow AGENTS.md.
- Docs match CLI behavior.

### Phase 6 - Freighter bridge

Deliverables:

- Local approval server.
- Vite/React approval UI.
- Freighter connect.
- Testnet signing flow.
- Human-readable transaction explanation.

Acceptance criteria:

- User can connect Freighter.
- User can approve/deny Testnet transaction.
- Denial is logged.
- Mainnet remains guarded.

### Phase 7 - Codex plugin

Deliverables:

- `plugins/codex/plugin.yaml`.
- Testnet skill.
- Payment skill.
- README.
- Example prompts.

Acceptance criteria:

- Codex can use skills to run Testnet workflow.
- Plugin docs explain safety behavior.
- Skill instructs Codex not to expose secrets or weaken policy.

### Phase 8 - x402 demo

Deliverables:

- Demo paid API.
- `pay x402` functional Testnet demo.
- Receipt logging.
- Tests for 402 parsing and policy behavior.

Acceptance criteria:

- Local demo returns 402.
- CLI pays on Testnet.
- CLI retries request.
- Receipt includes payment and response metadata.

### Phase 9 - MPP demo

Deliverables:

- `pay mpp` functional one-time Testnet demo.
- Docs and tests.

Acceptance criteria:

- CLI handles one-time MPP charge flow.
- Receipt is written.
- Policy controls spending.

### Phase 10 - Mainnet readiness

Deliverables:

- `mainnet status`.
- `mainnet enable`.
- Watch-only wallet import.
- Freighter Mainnet approval flow if feasible.
- Mainnet readiness docs.

Acceptance criteria:

- Mainnet disabled by default.
- Mainnet enable requires explicit real-funds flag.
- Mainnet cannot auto-sign.
- Mainnet receipt says `realFunds: true`.

---

## v0 acceptance matrix

The first working version should satisfy this matrix. It is intended to make autonomous implementation and review straightforward.

| Area | v0 behavior | Network required | Writes state | Writes receipt | JSON tested | Exit codes tested |
| --- | --- | --- | --- | --- | --- | --- |
| `stellar-agent --help` | Implemented | No | No | No | Not required | Yes |
| `profile list` | Implemented | No | No | No | Yes | Yes |
| `profile inspect` | Implemented | No | No | No | Yes | Yes |
| `profile use` | Implemented | No | Yes | No | Yes | Yes |
| `testnet doctor` | Implemented | Optional checks | No | No | Yes | Yes |
| `testnet init` | Implemented | Yes for Friendbot | Yes | No | Yes | Yes |
| `testnet friendbot` | Implemented | Yes | Yes | No | Yes | Yes |
| `testnet smoke-test` | Implemented | Yes | Yes | Yes on success | Yes | Yes |
| `testnet scenario basic-payment` | Implemented | Yes | Yes | Yes on success | Yes | Yes |
| `testnet scenario policy-denied` | Implemented | No | Event log if initialized | No successful payment receipt | Yes | Yes |
| `testnet scenario approval-required` | Implemented for Testnet | No unless approved | Event log if initialized | Only after approved payment | Yes | Yes |
| `testnet scenario x402-payment` | Placeholder | No | Optional event log | No | Yes | Yes |
| `wallet create-testnet` | Implemented | No | Yes | No | Yes | Yes |
| `wallet balance` | Implemented | Yes unless mocked | No | No | Yes | Yes |
| `wallet connect-freighter` | Placeholder or later phase | No | No secrets | No | Yes if placeholder | Yes |
| `pay quote` | Implemented | Optional fee lookup | No | No | Yes | Yes |
| `pay send --profile testnet` | Implemented | Yes | Yes | Yes on success | Yes | Yes |
| `pay batch` | Implemented for Testnet | Yes | Yes | Yes on success | Yes | Yes |
| `pay x402` | Placeholder | No | Optional event log | No | Yes | Yes |
| `pay mpp` | Placeholder | No | Optional event log | No | Yes | Yes |
| `ledger latest` | Implemented if backed by network client | Yes unless mocked | No | No | Yes | Yes |
| `ledger tx` | Implemented if backed by network client | Yes unless mocked | No | No | Yes | Yes |
| `receipts list/latest/show/verify` | Implemented | No | No | No | Yes | Yes |
| `policy init/check/explain/test` | Implemented | No | `init` writes policy | No | Yes | Yes |
| `mainnet status` | Implemented | No | No | No | Yes | Yes |
| `mainnet enable/disable/readiness` | Guarded placeholder or implemented status flow | No | Yes for enable/disable | No | Yes | Yes |

For commands marked as placeholders, the tested behavior is the placeholder contract, not the final feature behavior.

---

## Definition of done

The project is not done until:

- `pnpm install` works on a clean machine.
- `pnpm build` passes.
- `pnpm test` passes.
- `pnpm lint` passes.
- `stellar-agent --help` is useful.
- `stellar-agent testnet doctor` is useful.
- `stellar-agent testnet init` works.
- `stellar-agent testnet smoke-test` works on live Testnet when opted in.
- Receipts are written.
- No secrets are printed.
- Mainnet is guarded.
- README quickstart works.
- AGENTS.md exists.
- Security docs exist.
- Codex plugin docs exist.
- Commit history is reviewable.

---

## Codex operating instructions

When using Codex on this project:

1. Read `SPEC.md`.
2. Read `AGENTS.md`.
3. Build in phases.
4. Run tests after each meaningful change.
5. Commit small increments.
6. Update docs when commands change.
7. Never weaken safety defaults.
8. Prefer Testnet in examples.
9. Use `--json` in agent-facing examples.
10. Leave clear TODOs where x402/MPP/Freighter require later implementation.

Suggested first Codex prompt:

```text
Read SPEC.md and AGENTS.md. Initialize the repo foundation for stellar-agent-bridge using pnpm workspaces, TypeScript, Vitest, ESLint/Prettier, Commander.js for the CLI package, and the docs/README files described in the spec. Keep the first commit small and focused. After that, proceed phase by phase, running tests and committing meaningful increments.
```

Suggested continuing Codex prompt:

```text
Continue implementing the next incomplete phase in SPEC.md. Before making changes, summarize what is already complete. Preserve safety defaults, update docs when commands change, run relevant tests, and create a small commit with a clear open-source-friendly message.
```

---

## Open questions for maintainers

Codex should not block on these, but should leave TODOs where needed:

1. Should the canonical repo live on GitHub, Bitbucket, or both?
2. Confirm npm org/package access for the `@stellar-agent/*` package set before publishing the verified GitHub release tarballs.
3. Should the first Mainnet flow support only Freighter?
4. Should x402 or MPP come first after the base Testnet suite?
5. Should local Stellar Quickstart be supported in addition to public Testnet?
6. Should receipts include optional cryptographic integrity hashes in v1?
7. Should SQLite be introduced later for receipts/logs, or should file-based storage remain the default?
8. Should the ChatGPT app be a separate repo once the CLI stabilizes?

---

## Product quality bar

This should feel like a serious open-source infrastructure project, not a weekend demo.

The CLI should be friendly enough that a curious developer can succeed quickly, but conservative enough that a security-minded reviewer can trust the defaults.

Good output matters.

Good errors matter.

Good docs matter.

The first impression should be:

> I can install this, run a Testnet payment, see exactly what happened, and trust that Mainnet is not going to surprise me.

# Distribution Readiness

This repository is a pnpm workspace. The `0.3.x` release strategy is to publish scoped `@stellar-agent/*` package tarballs from a verified GitHub release. Source manifests keep `workspace:*` dependency ranges for local development; `pnpm release:pack` rewrites those ranges to the release version inside the staged package tarballs only.

## Current Release Gate

The release workflow runs:

```bash
pnpm install --frozen-lockfile
pnpm release:preflight
```

See `RELEASE.md` for the Codex-run release checklist.

The release preflight builds, lints, tests, smoke-tests, checks release metadata, verifies Mainnet safety invariants, packs every publishable package, validates the Codex plugin package, installs the generated tarballs in a fresh temporary project, and writes GitHub release notes.

Generated artifacts:

- `.release/artifacts/npm/*.tgz` for scoped npm packages.
- `.release/artifacts/codex/stellar-agent-codex-plugin-v0.4.0.tgz` for Codex plugin installation.
- `.release/artifacts/release-manifest.json` for checksums and source commit evidence.

The public package set is:

```text
@stellar-agent/core
@stellar-agent/ledger-logger
@stellar-agent/policy
@stellar-agent/stellar
@stellar-agent/defi
@stellar-agent/freighter-bridge
@stellar-agent/mcp-server
@stellar-agent/testnet-suite
@stellar-agent/x402-client
@stellar-agent/mpp-client
@stellar-agent/codex-plugin
@stellar-agent/cli
```

The unscoped root package remains private and is not the CLI package. Users should install or run `@stellar-agent/cli` once npm publication is enabled.

## npm Publication

npm publication is prepared but manual. Publish only the generated tarballs after confirming npm scope ownership and package access:

```bash
pnpm release:publish:npm:dry-run
pnpm release:publish:npm
```

Do not publish from package source directories. The generated tarballs are the tested artifacts.

Local token-backed publishing does not provide npm provenance. For provenance-backed publication, configure npm trusted publishing for each package and publish from a supported CI workflow with OIDC.

## Versioning and Changelog

- `0.3.x` means installable Testnet-first release artifacts with fee-aware transaction submission, guarded bundled payments, and stable CLI/JSON behavior for agent integration.
- Patch releases fix defects, documentation, packaging, and safety checks without broad command-shape churn.
- Breaking command, JSON envelope, policy schema, or receipt schema changes should wait for the next minor release unless they repair a safety bug.
- `CHANGELOG.md` is the source for GitHub release notes.

## Mainnet Release Requirements

Before a release advertises Mainnet usage:

- Mainnet local auto-signing remains blocked.
- Mainnet signed-XDR submission requires Mainnet enablement, an active Mainnet profile, explicit real-funds flags, an already signed envelope, and a receipt.
- Mainnet contract commands require explicit real-funds flags.
- Raw Mainnet secret keys are refused.
- Docs explain that users should use Stellar CLI identities, browser wallets, or signed XDR for Mainnet custody.
- Mainnet examples include real-funds disclaimers and never imply autonomous spending.

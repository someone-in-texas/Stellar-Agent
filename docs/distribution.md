# Distribution Readiness

This repository is a pnpm workspace. The current release strategy is to publish scoped `@stellar-agent/*` packages from verified release artifacts, with npm publication routed through trusted publishing. Source manifests keep `workspace:*` dependency ranges for local development; `pnpm release:pack` rewrites those ranges to the release version inside the staged package tarballs only.

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
- `.release/artifacts/codex/stellar-agent-codex-plugin-v0.5.1.tgz` for Codex plugin installation.
- `.release/artifacts/release-manifest.json` for checksums and source commit evidence.

The public package set is:

```text
@stellar-agent/core
@stellar-agent/ledger-logger
@stellar-agent/policy
@stellar-agent/stellar
@stellar-agent/defi
@stellar-agent/freighter-bridge
@stellar-agent/walletconnect-bridge
@stellar-agent/mcp-server
@stellar-agent/testnet-suite
@stellar-agent/x402-client
@stellar-agent/mpp-client
@stellar-agent/codex-plugin
@stellar-agent/cli
```

The unscoped root package remains private and is not the CLI package. Users should install or run `@stellar-agent/cli` once npm publication is enabled.

Every publishable package must include a package-local `README.md`. npm renders that file on the package page, so README changes require a new package version before they appear on npmjs.com.

Preview npm README content before publishing:

```bash
pnpm release:pack
tar -xOf .release/artifacts/npm/stellar-agent-cli-0.5.1.tgz package/README.md
pnpm release:verify-readmes
```

## npm Publication

npm publication uses the protected `Publish npm` GitHub Actions workflow after npm trusted publishing is configured for the package set. The `Release` workflow queues `Publish npm` automatically after the GitHub release is created; a maintainer approves the `npm-production` environment before packages are published.

The protected workflow verifies published package versions with retry/backoff because npm can briefly return 404s for a package version immediately after accepting a publish. If publish succeeds but verification fails, run:

```bash
node scripts/verify-published-npm.mjs
```

If the versions are visible, rerun the protected workflow rather than republishing from source directories; the publish helper skips existing package versions and confirms the already-published artifacts.

Configure trusted publishing:

```bash
pnpm release:trust:npm:dry-run
pnpm release:trust:npm
```

Publish locally only as a recovery path, and only from generated tarballs:

```bash
pnpm release:publish:npm:dry-run
pnpm release:publish:npm
```

Do not publish from package source directories. The generated tarballs are the tested artifacts.

Trusted publishing through GitHub Actions OIDC provides npm provenance for public packages. Local token-backed publishing does not provide npm provenance.

## Versioning and Changelog

- `0.5.x` means installable Testnet-first release artifacts with fee-aware transaction submission, guarded bundled payments, local x402/MPP demos, Mainnet agent-wallet workflows, Blend inspection and guarded Testnet mutation, Aquarius AMM inspection/preflight, core Stellar market-liquidity inspection/preflight, market alerts, strategy investigation, and stable CLI/JSON behavior for agent integration.
- Patch releases fix defects, documentation, packaging, and safety checks without broad command-shape churn.
- Breaking command, JSON envelope, policy schema, or receipt schema changes should wait for the next minor release unless they repair a safety bug.
- `CHANGELOG.md` is the source for GitHub release notes.

## Mainnet Release Requirements

Before a release advertises Mainnet usage:

- Generic Mainnet local auto-signing remains blocked; agent-wallet autosigning is allowed only for the explicitly enabled risk-budgeted payment path.
- Mainnet signed-XDR submission requires Mainnet enablement, an active Mainnet profile, explicit real-funds flags, an already signed envelope, and a receipt.
- Mainnet contract commands require explicit real-funds flags.
- Raw Mainnet secret keys are refused.
- Docs explain that users should use Stellar CLI identities, browser wallets, or signed XDR for Mainnet custody.
- Mainnet examples include real-funds disclaimers and never imply autonomous spending.

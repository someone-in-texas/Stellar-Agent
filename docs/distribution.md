# Distribution Readiness

This repository is a pnpm workspace. Publishing the CLI requires publishing the workspace packages it depends on or replacing `workspace:*` dependency ranges during release.

## Current Release Gate

The release workflow runs:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm test
pnpm smoke
pnpm --filter @stellar-agent/cli pack --dry-run
```

Publishing remains manual until these decisions are finalized:

- Public package names for each workspace package.
- npm provenance/signing requirements.
- Versioning and changelog policy.
- Package publish order for workspace dependencies.
- Whether the unscoped `stellar-agent-bridge` package is a wrapper package or the CLI package is published as `@stellar-agent/cli`.

## Mainnet Release Requirements

Before a release advertises Mainnet usage:

- Mainnet local auto-signing remains blocked.
- Mainnet signed-XDR submission requires Mainnet enablement, an active Mainnet profile, explicit real-funds flags, an already signed envelope, and a receipt.
- Mainnet contract commands require explicit real-funds flags.
- Raw Mainnet secret keys are refused.
- Docs explain that users should use Stellar CLI identities, browser wallets, or signed XDR for Mainnet custody.
- Mainnet examples include real-funds disclaimers and never imply autonomous spending.

# Release Process

This repository supports verified GitHub releases with source, npm package tarballs, and a bundled Codex plugin artifact.

The release process is still intentionally conservative: GitHub releases are automated around verified artifacts, while npm publication runs from a separate protected workflow after maintainer approval of the `npm-production` environment.

## Release Types

- **GitHub release:** supported for `v0.1.0` and later. It includes npm tarballs for every publishable `@stellar-agent/*` package, the Codex plugin tarball, generated release notes, and `release-manifest.json` with SHA-256 checksums.
- **npm package publication:** supported through the protected `Publish npm` workflow after npm trusted publishing is configured. The same generated tarballs can still be published locally with `pnpm release:publish:npm` as a recovery path.
- **Live Testnet verification:** strongly recommended before public release tags and required before releases that advertise new payment behavior.

## 0.5.1 Scope

`0.5.1` is a Testnet-first patch release that hardens x402 verification, improves market-alert config errors, and carries forward the guarded Mainnet agent-wallet, paid-service example, demo, schema, SDK-example, recipe, approval-bridge, and market-listener workflows from the `0.5.x` line:

- CLI command surface, JSON envelopes, policy checks, receipt logging, Testnet wallets, Friendbot funding, direct payments, fee-stat-aware transaction submission, bundled Testnet payments, issued assets, claimable balances, approval requests, guarded signed-XDR flows, MCP tools, local x402/MPP demos, Mainnet agent-wallet examples, agent-service-market examples, Blend DeFi inspection and guarded Testnet mutation, Aquarius AMM inspection and policy-gated preflight, core Stellar liquidity-pool inspection/preflight/Testnet mutation, market listeners, strategy investigation, cache controls, package-local npm READMEs, JSON version output, and Codex plugin validation are included.
- Mainnet agent-wallet mode stores only public wallet metadata by default, requires explicit arming, enforces config/policy fingerprints, receipt-backed spend caps, destination and asset allowlists, max-balance checks, and visible real-funds warnings.
- Mainnet agent-wallet autosigning is an explicit exception only for the configured dedicated wallet and only when policy returns `allowed`; default Mainnet `requires_approval` blocks submission.
- Local x402 and MPP demos issue fresh nonces, charges, and sessions and enforce one-use proof/replay protection.
- Example apps load documented `.env` files, use package-local tests, and include repeated-payment and receipt inspection coverage.
- Mainnet local auto-signing remains blocked outside the dedicated, armed agent-wallet autosign path.
- Raw Mainnet secret-key storage remains blocked.
- Mainnet usage is limited to guarded externally signed XDR or explicitly acknowledged contract operations.
- Mainnet batch auto-signing remains blocked.
- Mainnet Blend DeFi mutation remains blocked until an external signer flow exists.
- Mainnet Aquarius AMM mutation remains blocked until an external signer flow exists.
- Mainnet liquidity-pool mutation remains blocked until an external signer flow exists.
- Generic Soroban AMM mutation remains adapter-required until a protocol-specific adapter exists.
- Aquarius commands in this release are read-only or preflight-only and do not sign or submit transactions.
- Production facilitator-backed x402/MPP support remains future work.

## Preconditions

Before starting a release:

- The working tree is clean or contains only intentional release changes.
- `origin` points to `git@github.com:someone-in-texas/Stellar-Agent.git`.
- `package.json`, every publishable package manifest, `plugins/codex/plugin.yaml`, and `CHANGELOG.md` agree on the target version.
- Any newly added publishable npm package already exists on npm and has trusted publishing configured for `npm-publish.yml` and `npm-production`; `npm trust` cannot configure a package before the package record exists.
- Mainnet safety defaults remain intact:
  - no Mainnet auto-signing
  - no local Mainnet secret-key storage
  - real-funds commands require explicit acknowledgements
  - receipts are not bypassed
- Protocol SDK boundaries remain intact:
  - third-party protocol SDKs are confined to approved adapter packages
  - protocol SDKs are loaded lazily
  - CLI and shared packages do not statically import protocol SDKs
  - new protocol SDKs are added to `scripts/check-protocol-sdk-boundaries.mjs`
- Market liquidity boundaries remain intact:
  - core Stellar liquidity mutation runs policy before submission
  - Mainnet liquidity mutation cannot auto-sign locally
  - Soroban AMM mutation reports `adapter_required` without a protocol adapter
- DeFi boundaries remain intact:
  - Blend Testnet mutation runs preflight, policy, simulation, and receipt logging before/after submission
  - Aquarius AMM commands remain read-only or preflight-only
  - Mainnet DeFi mutation cannot auto-sign locally
- Codex plugin guidance is current:
  - every release headline workflow is represented in a bundled `SKILL.md` or documented as intentionally out of scope
  - `plugins/codex/plugin.yaml`, `plugins/codex/README.md`, and `docs/codex-plugin.md` describe the same skill set
  - safety-sensitive skills name the required preflight, mutation boundary, Mainnet limitation, and receipt expectations
- User-facing docs distinguish GitHub artifacts from npm publication.

## Local Preflight

Run:

```bash
pnpm install --frozen-lockfile
pnpm release:preflight
```

`pnpm release:preflight` runs:

```bash
pnpm build
pnpm lint
pnpm test
pnpm smoke
pnpm release:check-versions
pnpm release:safety
pnpm release:audit
pnpm release:pack
pnpm release:verify-artifacts
pnpm release:verify-readmes
pnpm release:notes
```

The release gate verifies:

- package and plugin versions are aligned
- user-facing docs do not carry stale previous-minor release-line references
- package metadata is publishable
- Mainnet safety invariants are present in docs, tests, and CLI behavior
- bundled Codex plugin guidance still covers the current workflow families
- third-party protocol SDKs remain isolated to approved adapter packages
- production dependencies have no known advisories from `pnpm audit --prod`
- npm tarballs are generated with internal `workspace:*` ranges rewritten to the release version
- no packed `package.json` leaks a `workspace:*` dependency
- every packed npm package includes its package-local README for npmjs.com
- a fresh temp project can install all generated tarballs
- the installed `stellar-agent` binary reports the release version and passes offline doctor/help checks
- the installed `stellar-agent-codex-plugin` binary validates the generated Codex plugin artifact

For a live integration check on Stellar Testnet, run:

```bash
LIVE_STELLAR_TESTNET=1 pnpm verify:live:testnet
```

The live verifier creates temporary Testnet accounts and submits real Testnet transactions. Run it before releases that change payment, receipt, policy, wallet, contract, DeFi, market liquidity, or approval behavior.

For non-mutating live DeFi examples that exercise current Testnet Blend and Aquarius endpoints, run:

```bash
pnpm examples:defi:testnet
```

The examples use isolated temp configs. The Blend example runs deployment and preflight checks; the Aquarius example loads deployments and pools, inspects pool/account/reward metadata, and preflights LP and swap requests without signing or submission.

## Generated Artifacts

`pnpm release:pack` writes artifacts under `.release/artifacts/`:

```text
.release/artifacts/npm/*.tgz
.release/artifacts/codex/stellar-agent-codex-plugin-v0.5.1.tgz
.release/artifacts/release-manifest.json
```

`release-manifest.json` records the release version, source commit, artifact paths, package names, and SHA-256 checksums. `.release/` is local output and is not committed.

## Codex Plugin Release

The bundled Codex plugin lives under `plugins/codex`.

Before a release, review the plugin as an agent-facing product surface, not only as a packaged artifact. If a release adds a new CLI workflow family, update an existing `SKILL.md` or add a new skill before tagging. If a feature should not be agent-guided yet, document that boundary explicitly.

Release packaging:

1. `pnpm build` builds `@stellar-agent/codex-plugin`.
2. `pnpm smoke` validates the bundled plugin.
3. `pnpm release:pack` copies `plugins/codex` into a release staging directory.
4. `stellar-agent-codex-plugin manifest` writes `plugin-manifest.json` into the staged plugin.
5. The staged plugin is archived as `stellar-agent-codex-plugin-v0.5.1.tgz`.
6. `pnpm release:verify-artifacts` extracts that archive and validates it through the installed `stellar-agent-codex-plugin` binary from the packed npm artifact.

This keeps Codex plugin packaging aligned with GitHub releases: the GitHub release contains the npm package that validates plugin manifests and the matching plugin artifact that Codex can install.

## GitHub Release

Create and verify the tag locally:

```bash
git tag -a v0.5.1 -m "Stellar Agent v0.5.1"
git push origin v0.5.1
```

The `Release` workflow runs on `v*` tags. It runs `pnpm release:preflight`, uploads generated artifacts, creates the GitHub release, and queues the protected `Publish npm` workflow from:

```text
.release/artifacts/npm/*.tgz
.release/artifacts/codex/*.tgz
.release/artifacts/release-manifest.json
```

The release notes come from `CHANGELOG.md` plus artifact and safety-boundary notes generated by `pnpm release:notes`.

After the release workflow queues `Publish npm`, approve the pending `npm-production` environment deployment in GitHub. That approval is the final step that lets npm trusted publishing publish the generated tarballs.

Manual local fallback:

```bash
pnpm release:preflight
gh release create v0.5.1 \
  .release/artifacts/npm/*.tgz \
  .release/artifacts/codex/*.tgz \
  .release/artifacts/release-manifest.json \
  --title "Stellar Agent v0.5.1" \
  --notes-file .release/github-release-notes.md \
  --verify-tag
```

If the tag or release already exists and points at different history, stop and inspect before deleting, replacing, or force-pushing anything.

## npm Publication

npm publication is intentionally routed through a separate protected workflow. The release workflow queues `Publish npm` after the GitHub release is created; the workflow waits for approval on the `npm-production` environment, then uses npm trusted publishing through GitHub Actions OIDC without a long-lived npm token.

After publishing, the workflow verifies every package version against npm with retries to allow for registry propagation. If the publish step succeeds but the verifier fails, first confirm the published versions:

```bash
node scripts/verify-published-npm.mjs
```

The publish helper skips package versions that already exist on npm, so rerunning the protected workflow after propagation is the preferred recovery path for a false verifier failure. Do not delete or retag a GitHub release for a publish verifier failure unless the release points at the wrong commit or the package contents are wrong.

Before enabling trusted publishing:

1. Create the GitHub environment `npm-production`.
2. Add yourself as a required reviewer for that environment.
3. Confirm every package already exists on npm and is public:

```bash
npm access list packages @stellar-agent --json
npm view @stellar-agent/cli version
```

If a release adds a new publishable package, create that package before the release by publishing the verified generated tarball once with `npm publish .release/artifacts/npm/<package>-<version>.tgz --access public --tag latest`, then run `npm trust github <package> ...`. The npm trust endpoint returns `E404` for packages that do not exist yet, and the protected workflow will fail at that package until this bootstrap step is done.

Configure npm trusted publishing for every package:

```bash
pnpm release:trust:npm:dry-run
pnpm release:trust:npm
```

The trust helper configures each package for:

```text
repo: someone-in-texas/Stellar-Agent
workflow file: npm-publish.yml
environment: npm-production
allowed action: npm publish
```

You can configure or inspect one package at a time:

```bash
pnpm release:trust:npm:dry-run -- --package @stellar-agent/cli
npm trust list @stellar-agent/cli
```

After trusted publishing is configured, publish future npm releases by approving the `Publish npm` workflow run queued by the release workflow, or run it manually with a release tag.

The local recovery path still publishes only from generated tarballs.

Dry-run the publish first:

```bash
pnpm release:publish:npm:dry-run
```

Then publish with a locally authenticated npm account:

```bash
pnpm release:publish:npm
```

Publish order is encoded by `scripts/release-utils.mjs` and the artifact manifest:

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

If npm requires a one-time password, pass it through the helper:

```bash
pnpm release:publish:npm -- --otp 123456
```

Do not publish npm packages until the maintainer has confirmed access to the `@stellar-agent` scope and reviewed `release-manifest.json`.

Trusted publishing automatically generates provenance attestations for public packages from supported CI runners. Local token-backed publishing does not provide npm provenance and should be treated as a recovery path.

## Commit Guidance

Prefer small, reviewable commits with messages that describe product-visible intent:

```text
Add release artifact verification
Harden guarded Mainnet signed-XDR flows
Document Codex plugin release packaging
```

Avoid scratchpad messages such as:

```text
work in progress
misc fixes
codex changes
```

## GitHub Actions

After pushing:

1. Confirm the `CI` workflow passes on `main`.
2. Push the release tag or run the `Release` workflow manually with `create_github_release=true`.
3. For important payment-flow milestones, run the `Live Testnet Smoke` workflow manually.

The `Release` workflow creates GitHub releases and artifacts, then queues the separate `Publish npm` workflow. The `Publish npm` workflow handles npm publication after environment approval.

## Release Notes Template

```text
## Summary

- Testnet-first Stellar agent payment CLI.
- Local policy evaluation, receipts, approval requests, MCP tools, Codex plugin packaging, and ledger inspection.
- Guarded Mainnet support limited to externally signed XDR and explicitly acknowledged real-funds contract operations.

## Verification

- pnpm release:preflight
- LIVE_STELLAR_TESTNET=1 pnpm verify:live:testnet

## Known Boundaries

- npm publishing is handled by the separate protected `Publish npm` workflow after environment approval.
- Production facilitator-backed x402/MPP is future work.
- Mainnet local auto-signing and Mainnet secret-key storage are intentionally blocked.
```

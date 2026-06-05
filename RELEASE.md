# Release Process

This repository supports verified GitHub releases with source, npm package tarballs, and a bundled Codex plugin artifact.

The release process is still intentionally conservative: GitHub releases are automated around verified artifacts, while npm publication remains a separate manual provenance-backed step until the maintainer confirms npm org/package access.

## Release Types

- **GitHub release:** supported for `v0.1.0` and later. It includes npm tarballs for every publishable `@stellar-agent/*` package, the Codex plugin tarball, generated release notes, and `release-manifest.json` with SHA-256 checksums.
- **npm package publication:** prepared but manual. Publish the same verified tarballs with `npm publish --provenance --access public` only after npm scope ownership and package access are confirmed.
- **Live Testnet verification:** strongly recommended before public release tags and required before releases that advertise new payment behavior.

## 0.2.0 Scope

`0.2.0` is a Testnet-first release:

- CLI command surface, JSON envelopes, policy checks, receipt logging, Testnet wallets, Friendbot funding, direct payments, issued assets, claimable balances, approval requests, guarded signed-XDR flows, MCP tools, local x402/MPP demos, Blend DeFi inspection and guarded Testnet mutation, and Codex plugin validation are included.
- Mainnet local auto-signing remains blocked.
- Raw Mainnet secret-key storage remains blocked.
- Mainnet usage is limited to guarded externally signed XDR or explicitly acknowledged contract operations.
- Mainnet Blend DeFi mutation remains blocked until an external signer flow exists.
- Production facilitator-backed x402/MPP support remains future work.

## Preconditions

Before starting a release:

- The working tree is clean or contains only intentional release changes.
- `origin` points to `git@github.com:someone-in-texas/Stellar-Agent.git`.
- `package.json`, every publishable package manifest, `plugins/codex/plugin.yaml`, and `CHANGELOG.md` agree on the target version.
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
pnpm release:notes
```

The release gate verifies:

- package and plugin versions are aligned
- package metadata is publishable
- Mainnet safety invariants are present in docs, tests, and CLI behavior
- third-party protocol SDKs remain isolated to approved adapter packages
- production dependencies have no known advisories from `pnpm audit --prod`
- npm tarballs are generated with internal `workspace:*` ranges rewritten to the release version
- no packed `package.json` leaks a `workspace:*` dependency
- a fresh temp project can install all generated tarballs
- the installed `stellar-agent` binary reports the release version and passes offline doctor/help checks
- the installed `stellar-agent-codex-plugin` binary validates the generated Codex plugin artifact

For a live integration check on Stellar Testnet, run:

```bash
LIVE_STELLAR_TESTNET=1 pnpm verify:live:testnet
```

The live verifier creates temporary Testnet accounts and submits real Testnet transactions. Run it before releases that change payment, receipt, policy, wallet, contract, DeFi, or approval behavior.

## Generated Artifacts

`pnpm release:pack` writes artifacts under `.release/artifacts/`:

```text
.release/artifacts/npm/*.tgz
.release/artifacts/codex/stellar-agent-codex-plugin-v0.2.0.tgz
.release/artifacts/release-manifest.json
```

`release-manifest.json` records the release version, source commit, artifact paths, package names, and SHA-256 checksums. `.release/` is local output and is not committed.

## Codex Plugin Release

The bundled Codex plugin lives under `plugins/codex`.

Release packaging:

1. `pnpm build` builds `@stellar-agent/codex-plugin`.
2. `pnpm smoke` validates the bundled plugin.
3. `pnpm release:pack` copies `plugins/codex` into a release staging directory.
4. `stellar-agent-codex-plugin manifest` writes `plugin-manifest.json` into the staged plugin.
5. The staged plugin is archived as `stellar-agent-codex-plugin-v0.2.0.tgz`.
6. `pnpm release:verify-artifacts` extracts that archive and validates it through the installed `stellar-agent-codex-plugin` binary from the packed npm artifact.

This keeps Codex plugin packaging aligned with GitHub releases: the GitHub release contains the npm package that validates plugin manifests and the matching plugin artifact that Codex can install.

## GitHub Release

Create and verify the tag locally:

```bash
git tag -a v0.2.0 -m "Stellar Agent v0.2.0"
git push origin v0.2.0
```

The `Release` workflow runs on `v*` tags. It runs `pnpm release:preflight`, uploads generated artifacts, and creates the GitHub release from:

```text
.release/artifacts/npm/*.tgz
.release/artifacts/codex/*.tgz
.release/artifacts/release-manifest.json
```

The release notes come from `CHANGELOG.md` plus artifact and safety-boundary notes generated by `pnpm release:notes`.

Manual local fallback:

```bash
pnpm release:preflight
gh release create v0.2.0 \
  .release/artifacts/npm/*.tgz \
  .release/artifacts/codex/*.tgz \
  .release/artifacts/release-manifest.json \
  --title "Stellar Agent v0.2.0" \
  --notes-file .release/github-release-notes.md \
  --verify-tag
```

If the tag or release already exists and points at different history, stop and inspect before deleting, replacing, or force-pushing anything.

## npm Publication

npm publication is intentionally separate from GitHub release creation.

After a GitHub release has passed, publish only from the generated tarballs:

```bash
for package in .release/artifacts/npm/*.tgz; do
  npm publish "$package" --provenance --access public
done
```

Publish order is encoded by `scripts/release-utils.mjs` and the artifact manifest:

```text
@stellar-agent/core
@stellar-agent/ledger-logger
@stellar-agent/policy
@stellar-agent/stellar
@stellar-agent/freighter-bridge
@stellar-agent/mcp-server
@stellar-agent/testnet-suite
@stellar-agent/x402-client
@stellar-agent/mpp-client
@stellar-agent/codex-plugin
@stellar-agent/cli
```

Do not publish npm packages until the maintainer has confirmed access to the `@stellar-agent` scope and reviewed `release-manifest.json`.

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

The `Release` workflow creates GitHub releases and artifacts only. It does not publish npm packages.

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

- npm publishing is prepared but not automatic.
- Production facilitator-backed x402/MPP is future work.
- Mainnet local auto-signing and Mainnet secret-key storage are intentionally blocked.
```

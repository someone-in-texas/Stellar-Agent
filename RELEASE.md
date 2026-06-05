# Release Process

This repository is release-preflight ready, but npm publishing is intentionally gated until package names, provenance, and workspace publish order are finalized.

Use this file as the operating checklist for Codex-driven GitHub releases. The goal is to make each release reproducible without relying on a maintainer's memory.

## Release Types

- **GitHub preflight release:** push the repository, run CI, and optionally tag a source-only milestone. This is the current supported release path.
- **npm package release:** not enabled yet. Complete the package-name, provenance, changelog, and workspace publish-order decisions in `docs/distribution.md` first.

## Preconditions

Before starting a release:

- The working tree is clean or contains only intentional release changes.
- `origin` points to `git@github.com:someone-in-texas/Stellar-Agent.git`.
- Mainnet safety defaults remain intact:
  - no Mainnet auto-signing
  - no local Mainnet secret-key storage
  - real-funds commands require explicit acknowledgements
  - receipts are not bypassed
- User-facing docs do not claim npm publishing is available.

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
NPM_CONFIG_CACHE=/tmp/stellar-agent-npm-cache pnpm --filter @stellar-agent/cli exec npm pack --dry-run
```

For a live integration check on Stellar Testnet, run:

```bash
LIVE_STELLAR_TESTNET=1 pnpm verify:live:testnet
```

The live verifier creates temporary Testnet accounts and submits real Testnet transactions. It should be run before important public milestones, but it is not required for every documentation-only push.

## Codex Release Prompt

Use a prompt like this when asking Codex to run a release:

> Prepare a GitHub preflight release for Stellar Agent. Check the working tree, verify the release checklist in `RELEASE.md`, run `pnpm release:preflight`, optionally run the live Testnet verifier if code or payment behavior changed, commit intentional changes with a professional message, push `main` to `origin`, and report the exact commit hash and checks that passed. Do not publish npm packages.

## Commit Guidance

Prefer small, reviewable commits with messages that describe product-visible intent:

```text
Document release preflight process
Harden guarded Mainnet signed-XDR flows
Add receipt-backed policy history
```

Avoid scratchpad messages such as:

```text
work in progress
misc fixes
codex changes
```

## First Public Push History Cleanup

Before the first push to GitHub, the local history may be rewritten to make the contributor-facing history easier to read. Do this only before the remote has shared history.

Recommended public history shape:

```text
Add Stellar Agent Bridge specification
Implement Testnet-first agent payment foundation
Expand wallet, approval, contract, and paid-resource workflows
Harden production readiness and Mainnet safeguards
Document Codex-driven release preflight
```

If the current local branch still contains rough messages such as `Initial codex commit` or `work towards production readiness`, reword them before pushing:

```bash
git rebase -i --root
```

Use `reword` for the commits whose messages need cleanup. Do not change file contents during this rebase unless the release checklist has to be rerun afterward.

## GitHub Push

If `origin` is missing, add it:

```bash
git remote add origin git@github.com:someone-in-texas/Stellar-Agent.git
```

Push the main branch:

```bash
git push -u origin main
```

If local history was intentionally cleaned up before the first public push and the remote is empty, a normal push should be enough. If the remote already contains conflicting history, stop and ask before force-pushing.

## GitHub Actions

After pushing:

1. Confirm the `CI` workflow passes on `main`.
2. Run the `Release` workflow manually from GitHub Actions.
3. For important payment-flow milestones, run the `Live Testnet Smoke` workflow manually.

The `Release` workflow is a preflight check only. It does not publish packages.

## Tagging

Use tags only for source milestones until npm publishing is ready:

```bash
git tag -a v0.1.0-preflight -m "Stellar Agent v0.1.0 preflight"
git push origin v0.1.0-preflight
```

Do not use a tag name that implies production Mainnet custody or npm availability until those release gates are closed.

## Release Notes Template

```text
## Summary

- Testnet-first Stellar agent payment CLI.
- Local policy evaluation, receipts, approval requests, and ledger inspection.
- Guarded Mainnet support limited to externally signed XDR and explicitly acknowledged contract operations.

## Verification

- pnpm release:preflight
- LIVE_STELLAR_TESTNET=1 pnpm verify:live:testnet

## Known Boundaries

- npm publishing is not enabled.
- Production facilitator-backed x402/MPP is future work.
- Mainnet local auto-signing and Mainnet secret-key storage are intentionally blocked.
```

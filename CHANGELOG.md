# Changelog

## 0.4.4

- Hardened payment policy evaluation so Mainnet requests remain marked as real-funds and fail closed when evaluated with a mismatched policy network.
- Added a local default policy and local policy filename so local-profile payment quotes do not reuse a Testnet-labeled policy.
- Tightened local x402 and MPP resource binding to include URL query strings.
- Hardened the local approval bridge by keeping bearer tokens out of unauthenticated HTML, removing remote Freighter script loading, and requiring explicit acknowledgement for non-loopback binds.
- Updated Mainnet safety, x402/MPP, approval bridge, CLI, and policy docs for the tightened behavior.
- Updated Aquarius Mainnet AQUA metadata, client-side pool limiting, and JSON parse-error handling for Aquarius CLI preflight.

## 0.4.3

- Added npm-facing README files for every public `@stellar-agent/*` package and package-specific npm homepage links.
- Added root and package README guidance for installing `@stellar-agent/cli`, choosing scoped packages, and previewing npm README content before release.
- Added release checks that require package READMEs in source and verify `package/README.md` is present in every packed npm tarball.
- Added `stellar-agent --version --json` for scripts that need machine-readable CLI version output.
- Updated release notes and npm package descriptions for README/package-page changes.

## 0.4.2

- Added Aquarius AMM deployment discovery, pool inspection, account-position reads, LP deposit/withdraw preflight, swap quote/preflight, and rewards inspection.
- Added `defi.aquarius` policy controls for allowed pools, assets, actions, nominal exposure, slippage bounds, and Mainnet approval gating.
- Added Testnet example scripts for Blend and Aquarius DeFi workflows under `examples/defi/`, plus `pnpm examples:defi:testnet`.
- Added a bundled `stellar-agent-defi` Codex skill covering Blend and Aquarius command sequencing, preflight requirements, policy boundaries, and Mainnet signing limits.
- Documented Aquarius Testnet endpoints, examples, read-only/preflight-only boundaries, and Mainnet external-signer requirements.
- Kept Aquarius public asset metadata visible in redacted CLI output and tightened slippage-bound and asset-allowlist policy checks.

## 0.4.1

- Added MCP tools for core Stellar liquidity-pool listing, inspection, trade reads, LP position inspection, LP preflight, finite market listeners, and strategy liquidity investigation.
- Added package-level LP input validation for pool ids, distinct reserve assets, and deposit price bounds.
- Added nominal LP exposure metadata to preflight output and documented that it is a policy proxy, not a mark-to-market value or profitability estimate.
- Added `--fee-strategy` to `market lp trustline add` for consistency with other mutating Testnet commands.
- Added live Testnet verifier coverage for read-only market workflows and LP preflight against an existing Testnet core pool.
- Fixed stale release-line documentation and added a release metadata guard for previous-minor doc drift.

## 0.4.0

- Added `market` commands for core Stellar AMM pool listing, inspection, trade reads, LP position inspection, and finite JSON market alerts.
- Added guarded Testnet `market lp` preflight, pool-share trustline creation, deposit, and withdrawal commands with policy checks before submission and receipt logging after successful transactions.
- Added `market.liquidity` policy controls for allowed pools, assets, actions, exposure limits, and explicit deposit price bounds.
- Added `strategy explain`, `strategy simulate`, and `strategy investigate liquidity` so agents can evaluate liquidity proposals without hidden signing or submission.
- Added a Soroban pool investigation boundary: contract interface inspection is read-only, and generic Soroban AMM mutation reports `adapter_required` until a protocol-specific adapter, policy controls, simulation, and signing model exist.
- Documented safe market-making scope, Mainnet liquidity guards, and liquidity-pool risk notes.

## 0.3.0

- Added fee-stat-aware transaction building with `base`, `low`, `medium`, `high`, and `p95` fee strategies, including session caching and base-fee fallback behavior.
- Added guarded Testnet `pay batch` support for bundling multiple payments into one transaction with per-payment policy checks and aggregate spend-limit evaluation.
- Tightened signed-XDR submission so ambiguous Horizon submit responses are confirmed by transaction lookup before reporting success.
- Added `cache inspect` and `cache clear` commands plus global `--no-cache` support for long-running agent sessions.
- Expanded CLI help smoke coverage, docs-linked error hints, and agent integration docs for faster setup and troubleshooting.
- Updated GitHub Actions workflow actions to Node 24-runtime majors while keeping the project test runtime on Node 22.

## 0.2.0

- Added first-class Blend DeFi inspection, preflight, deployment discovery, guided trustline setup, and guarded Testnet supply, borrow, repay, withdraw, and batch commands.
- Integrated Blend SDK-backed pool loading, reserve math, position estimates, APYs, request construction, Soroban simulation, and receipt metadata while keeping Mainnet DeFi auto-signing blocked.
- Added explicit DeFi policy controls for allowed pools, request types, borrow value, protocol exposure, health factor, and simulation requirements.
- Added live Testnet verification for Blend deployment discovery, USDC trustline creation, XLM collateral supply, batched Blend actions, and receipt validation.
- Hardened protocol SDK boundaries with release checks, production dependency audits, lazy DeFi adapter loading, and security documentation for future protocol SDK additions.
- Refreshed the README opening to better explain the agentic payment use case while preserving safety-first release notes.

## 0.1.0

- Promoted the workspace to a Testnet-first release candidate with aligned package, CLI, MCP, and Codex plugin versions.
- Added release gates for version consistency, package metadata, Mainnet safety invariants, staged npm tarball generation, fresh tarball install verification, Codex plugin artifact packaging, checksums, and GitHub release notes.
- Prepared scoped `@stellar-agent/*` npm tarballs while keeping npm publication manual and provenance-backed.
- Documented GitHub release creation, Codex plugin release packaging, and `0.1.x` compatibility boundaries.
- Kept Mainnet local auto-signing and Mainnet secret-key storage blocked.

## 0.0.0

- Initial v0 scaffold with core, policy, Stellar Testnet helpers, ledger logging, CLI, docs, and placeholders.

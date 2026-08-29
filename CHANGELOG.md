# Changelog

## 0.5.4

- Aligned direct Stellar SDK dependencies on the 16.3.0 LTS release, including current Protocol 28 XDR support and a patched Axios dependency.
- Made signed transaction-envelope inspection compatible with both SDK 16 method-style XDR unions and SDK 17 property-style unions.
- Made liquidity-pool identifiers explicitly `Uint8Array`-safe instead of relying on Buffer-only return behavior.
- Added an SDK 17 migration notice covering its Node.js 22.12 floor, XDR runtime changes, and Buffer-to-Uint8Array transition.
- Refreshed `body-parser` to 2.3.0 through Express's supported dependency range to clear the independent preflight advisory.
- Documented the separately versioned Blend SDK dependency boundary instead of treating it as a direct Stellar Agent SDK alignment.

## 0.5.3

- Redacted Stellar secret-shaped values and URL query strings from serialized error messages and hints, in addition to structured error details.
- Made private configuration, wallet, approval, policy, report, and receipt writes atomic while preserving restrictive file permissions.
- Hardened MCP stdio handling with byte-accurate UTF-8 framing, fragmented and coalesced message support, bounded message and output sizes, and a CLI timeout.
- Tightened Aquarius liquidity policy validation for exact per-pool amount vectors, complete withdrawal bounds, and exact decimal exposure arithmetic.
- Guarded manually dispatched release runs against stale or mismatched tag, version, and commit selections.
- Refreshed patch-level WalletConnect, Blend, Prettier, tsx, and TypeScript ESLint dependencies.

## 0.5.2

- Fixed WalletConnect SignClient resolution for the npm-installed `@walletconnect/sign-client` export shape, including function exports with static `init`.
- Closed WalletConnect SDK transport, subscriber, and heartbeat handles after pair/status/disconnect/sign commands so installed CLI commands return cleanly after printing JSON.
- Added the Codex-native `.codex-plugin/plugin.json` manifest to the bundled plugin and made release packaging and artifact verification require it.
- Clarified the difference between the `@stellar-agent/codex-plugin` npm tooling tarball and the installable `stellar-agent-codex-plugin-v*.tgz` plugin bundle.
- Improved `stellar-agent-codex-plugin --help` and documented `validate`, `manifest`, and `plugin-json`.
- Documented that `policy explain --request` files use `destination`, not `to`, and mapped schema validation failures to structured `INVALID_INPUT` responses.

## 0.5.1

- Hardened Horizon-backed x402 verification so settled transactions must include a challenge memo bound to the issued resource and nonce, preventing reuse of older matching payments for fresh challenges.
- Normalized malformed x402 proof amounts to `invalid_payment_proof` responses so local paid API demos return HTTP 402 JSON errors instead of surfacing unhandled parser failures.
- Added safe demo bundle commands, typed SDK examples, agent payment recipes, approval bridge URL helpers, and config-file market alerts from the post-0.5.0 feature set.
- Published programmatic CLI JSON schemas for agent/tool integrations.
- Wrapped missing or malformed market alert config files as structured `INVALID_INPUT` responses with market-listener docs.

## 0.5.0

- Added a guarded Mainnet agent-wallet workflow for dedicated, risk-budgeted wallets, including external-funding guidance, arming fingerprints, receipt-backed spend caps, balance checks, and an explicit autosign exception that still requires policy status `allowed`.
- Added example apps for a local x402 paid API, an agent service market, and a Mainnet agent-wallet playground.
- Hardened example payment proofs with issued nonce, charge, session, and transaction-hash replay checks, plus package-local and repo-level example contract tests.
- Moved shared Mainnet agent-wallet preflight, fingerprint, balance, and risk-budget helpers into `@stellar-agent/core` so CLI and examples use the same guard semantics.
- Updated Codex payment guidance for Mainnet agent-wallet setup, funding, arming, autosign boundaries, local x402, and MPP workflows.
- Kept production facilitator-backed x402/MPP support, generic Mainnet auto-signing, and non-agent-wallet Mainnet autosign out of scope.

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

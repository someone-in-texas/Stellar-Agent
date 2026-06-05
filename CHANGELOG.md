# Changelog

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

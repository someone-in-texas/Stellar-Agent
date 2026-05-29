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

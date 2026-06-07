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

## Before adding or changing CLI workflows

- Update user-facing docs for command changes.
- Check whether `plugins/codex/README.md` and `plugins/codex/skills/*/SKILL.md` need updates.
- Add or update a Codex skill when a new workflow family needs agent-specific safety rules or command sequencing.

## Before preparing a release

- Run `pnpm release:preflight`.
- Check the Codex plugin with `node packages/codex-plugin/dist/cli.js validate plugins/codex`.
- Confirm every release headline feature is represented in either an existing Codex skill or a deliberately documented non-skill boundary.
- After a GitHub release is created, confirm the protected `Publish npm` workflow was queued and is waiting for `npm-production` approval.

## Do not

- Add Mainnet auto-signing.
- Store Mainnet secret keys in plain text.
- Print private keys.
- Disable policy checks.
- Bypass receipt logging.

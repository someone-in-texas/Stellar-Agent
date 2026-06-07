# @stellar-agent/codex-plugin

Validation, manifest, and release tooling for the bundled Codex plugin under `plugins/codex`.

## Install

```bash
npm install @stellar-agent/codex-plugin
```

## Commands

```bash
pnpm build
node packages/codex-plugin/dist/cli.js validate plugins/codex
node packages/codex-plugin/dist/cli.js manifest plugins/codex plugins/codex/plugin-manifest.json
```

The validator checks `plugin.yaml`, referenced skill directories, `SKILL.md` files, and agent routing YAML. The manifest command writes a normalized JSON manifest that packaging or installation scripts can consume.

Release packaging is handled by the repository-level release gate:

```bash
pnpm release:preflight
```

That command builds this package, stages `plugins/codex`, writes `plugin-manifest.json`, creates the versioned `stellar-agent-codex-plugin-v*.tgz` artifact, then verifies the artifact through the installed `stellar-agent-codex-plugin` binary from the generated npm tarball.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Codex plugin docs: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/codex-plugin.md
- Bundled plugin README: https://github.com/someone-in-texas/Stellar-Agent/blob/main/plugins/codex/README.md

# @stellar-agent/codex-plugin

Validation, manifest, and release tooling for the bundled Codex plugin under `plugins/codex`.

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

That command builds this package, stages `plugins/codex`, writes `plugin-manifest.json`, creates `stellar-agent-codex-plugin-v0.1.0.tgz`, then verifies the artifact through the installed `stellar-agent-codex-plugin` binary from the generated npm tarball.

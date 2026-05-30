# @stellar-agent/codex-plugin

Validation and manifest tooling for the bundled Codex plugin under `plugins/codex`.

```bash
pnpm build
node packages/codex-plugin/dist/cli.js validate plugins/codex
node packages/codex-plugin/dist/cli.js manifest plugins/codex plugins/codex/plugin-manifest.json
```

The validator checks `plugin.yaml`, referenced skill directories, `SKILL.md` files, and agent routing YAML. The manifest command writes a normalized JSON manifest that packaging or installation scripts can consume.

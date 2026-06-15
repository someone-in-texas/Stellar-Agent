# @stellar-agent/codex-plugin

Validation, manifest, and release tooling for the bundled Codex plugin under `plugins/codex`.

## Install

```bash
npm install @stellar-agent/codex-plugin
```

## Commands

```bash
pnpm build
node packages/codex-plugin/dist/cli.js --help
node packages/codex-plugin/dist/cli.js validate plugins/codex
node packages/codex-plugin/dist/cli.js manifest plugins/codex plugins/codex/plugin-manifest.json
node packages/codex-plugin/dist/cli.js plugin-json plugins/codex plugins/codex/.codex-plugin/plugin.json
```

The validator checks `plugin.yaml`, `.codex-plugin/plugin.json`, referenced skill directories, `SKILL.md` files, and agent routing YAML. The `manifest` command writes the repository release manifest consumed by release checks. The `plugin-json` command writes the Codex-native install manifest required by `codex plugin add`.

Release packaging is handled by the repository-level release gate:

```bash
pnpm release:preflight
```

That command builds this package, stages `plugins/codex`, writes `.codex-plugin/plugin.json` and `plugin-manifest.json`, creates the versioned `stellar-agent-codex-plugin-v*.tgz` artifact, then verifies the artifact through the installed `stellar-agent-codex-plugin` binary from the generated npm tarball.

Do not confuse the release artifacts: `stellar-agent-codex-plugin-*.tgz` under the npm artifact directory is this tooling package, while `stellar-agent-codex-plugin-v*.tgz` under the Codex artifact directory is the installable Codex plugin bundle.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Codex plugin docs: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/codex-plugin.md
- Bundled plugin README: https://github.com/someone-in-texas/Stellar-Agent/blob/main/plugins/codex/README.md

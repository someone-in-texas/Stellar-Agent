#!/usr/bin/env node
import { validateCodexPlugin, writeCodexNativePluginJson, writeCodexPluginManifest } from "./index.js";

const [, , command = "validate", pluginRoot = "plugins/codex", outputPath] = process.argv;

try {
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(codexPluginCliHelp());
  } else if (command === "validate") {
    const result = await validateCodexPlugin(pluginRoot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.valid ? 0 : 3;
  } else if (command === "manifest") {
    const manifestPath = outputPath ?? "plugins/codex/plugin-manifest.json";
    const manifest = await writeCodexPluginManifest(pluginRoot, manifestPath);
    process.stdout.write(`${JSON.stringify({ ok: true, manifestPath, manifest }, null, 2)}\n`);
  } else if (command === "plugin-json") {
    const manifestPath = outputPath ?? `${pluginRoot}/.codex-plugin/plugin.json`;
    const manifest = await writeCodexNativePluginJson(pluginRoot, manifestPath);
    process.stdout.write(`${JSON.stringify({ ok: true, manifestPath, manifest }, null, 2)}\n`);
  } else {
    process.stderr.write(codexPluginCliHelp());
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

export function codexPluginCliHelp(): string {
  return `Usage: stellar-agent-codex-plugin [command] [pluginRoot] [outputPath]

Commands:
  validate     Validate plugin.yaml, .codex-plugin/plugin.json, skills, and agent routing YAML.
  manifest     Write the Stellar Agent release manifest as plugin-manifest.json.
  plugin-json  Write the Codex-native .codex-plugin/plugin.json manifest.
  help         Show this help.

Defaults:
  pluginRoot   plugins/codex
  outputPath   plugins/codex/plugin-manifest.json
`;
}

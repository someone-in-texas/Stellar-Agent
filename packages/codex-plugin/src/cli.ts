#!/usr/bin/env node
import { validateCodexPlugin, writeCodexPluginManifest } from "./index.js";

const [, , command = "validate", pluginRoot = "plugins/codex", outputPath = "plugins/codex/plugin-manifest.json"] = process.argv;

try {
  if (command === "validate") {
    const result = await validateCodexPlugin(pluginRoot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.valid ? 0 : 3;
  } else if (command === "manifest") {
    const manifest = await writeCodexPluginManifest(pluginRoot, outputPath);
    process.stdout.write(`${JSON.stringify({ ok: true, manifestPath: outputPath, manifest }, null, 2)}\n`);
  } else {
    process.stderr.write("Usage: stellar-agent-codex-plugin [validate|manifest] [pluginRoot] [outputPath]\n");
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

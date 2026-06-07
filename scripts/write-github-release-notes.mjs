import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactDir, readJson, releaseDir, releaseManifestPath, rootDir } from "./release-utils.mjs";

const manifest = await readJson(releaseManifestPath);
const changelog = await readFile(join(rootDir, "CHANGELOG.md"), "utf8");
const notes = extractChangelogSection(changelog, manifest.version);

await mkdir(releaseDir, { recursive: true });
await writeFile(
  join(releaseDir, "github-release-notes.md"),
  [
    notes.trim(),
    "",
    "## Artifacts",
    "",
    "- npm package tarballs for every publishable `@stellar-agent/*` workspace package.",
    `- Codex plugin artifact: \`stellar-agent-codex-plugin-v${manifest.version}.tgz\`.`,
    "- `release-manifest.json` with artifact SHA-256 checksums and source commit.",
    "",
    "## Verification",
    "",
    "- `pnpm release:preflight`",
    "- Fresh install from generated npm tarballs",
    "- Bundled Codex plugin validation from the generated plugin tarball",
    "",
    "## Boundaries",
    "",
    "- npm publication is handled by the separate protected `Publish npm` workflow.",
    "- Testnet remains the default.",
    "- Mainnet local auto-signing and Mainnet secret-key storage remain blocked.",
    ""
  ].join("\n")
);

console.log(`GitHub release notes written to ${join(artifactDir, "..", "github-release-notes.md")}.`);

function extractChangelogSection(changelog, version) {
  const marker = `## ${version}`;
  const start = changelog.indexOf(marker);
  if (start === -1) throw new Error(`CHANGELOG.md does not contain ${marker}.`);
  const next = changelog.indexOf("\n## ", start + marker.length);
  return changelog.slice(start, next === -1 ? changelog.length : next);
}

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  artifactDir,
  codexArtifactDir,
  npmArtifactDir,
  posixRelative,
  publishablePackageDirs,
  readJson,
  releaseManifestPath,
  rootDir,
  run,
  sha256,
  workDir
} from "./release-utils.mjs";

const rootPackage = await readJson(join(rootDir, "package.json"));
const version = process.env.RELEASE_VERSION ?? rootPackage.version;
const gitHead = run("git", ["rev-parse", "HEAD"]).stdout.trim();
const generatedAt = new Date().toISOString();

await rm(artifactDir, { recursive: true, force: true });
await rm(workDir, { recursive: true, force: true });
await mkdir(npmArtifactDir, { recursive: true });
await mkdir(codexArtifactDir, { recursive: true });
await mkdir(workDir, { recursive: true });

const packages = [];
for (const packageDir of publishablePackageDirs) {
  const sourceDir = join(rootDir, packageDir);
  const stagingDir = join(workDir, "npm", basename(packageDir));
  await cp(sourceDir, stagingDir, {
    recursive: true,
    filter: (source) => !source.includes("/node_modules/") && !source.includes("/.tsbuildinfo")
  });
  await cp(join(rootDir, "LICENSE"), join(stagingDir, "LICENSE"));

  const packageJsonPath = join(stagingDir, "package.json");
  const packageJson = await readJson(packageJsonPath);
  rewriteWorkspaceDependencies(packageJson.dependencies);
  rewriteWorkspaceDependencies(packageJson.peerDependencies);
  rewriteWorkspaceDependencies(packageJson.optionalDependencies);
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const pack = run("npm", ["pack", stagingDir, "--pack-destination", npmArtifactDir, "--json"], {
    env: { NPM_CONFIG_CACHE: "/tmp/stellar-agent-npm-cache" }
  });
  const [packInfo] = JSON.parse(pack.stdout);
  const tarball = join(npmArtifactDir, packInfo.filename);
  packages.push({
    name: packageJson.name,
    version: packageJson.version,
    directory: packageDir,
    tarball: posixRelative(rootDir, tarball),
    sha256: await sha256(tarball),
    unpackedSize: packInfo.unpackedSize,
    files: packInfo.files.map((file) => file.path)
  });
}

const codex = await packCodexPlugin(version);
const manifest = {
  schemaVersion: "stellar-agent.release.v1",
  version,
  gitHead,
  generatedAt,
  npmPackages: packages,
  codexPlugin: codex
};
await writeFile(releaseManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Release artifacts written to ${posixRelative(rootDir, artifactDir)}.`);

function rewriteWorkspaceDependencies(dependencies) {
  if (!dependencies) return;
  for (const [name, range] of Object.entries(dependencies)) {
    if (name.startsWith("@stellar-agent/") && typeof range === "string" && range.startsWith("workspace:")) {
      dependencies[name] = version;
    }
  }
}

async function packCodexPlugin(version) {
  const pluginRoot = join(rootDir, "plugins", "codex");
  const pluginYaml = parseSimpleYaml(await readFile(join(pluginRoot, "plugin.yaml"), "utf8"));
  if (pluginYaml.version !== version) {
    throw new Error(`Codex plugin version ${pluginYaml.version} does not match release version ${version}.`);
  }

  const packageName = `stellar-agent-codex-plugin-${version}`;
  const stagingRoot = join(workDir, "codex", packageName);
  await cp(pluginRoot, stagingRoot, { recursive: true });
  run(process.execPath, [
    join(rootDir, "packages", "codex-plugin", "dist", "cli.js"),
    "manifest",
    stagingRoot,
    join(stagingRoot, "plugin-manifest.json")
  ]);

  const tarballName = `stellar-agent-codex-plugin-v${version}.tgz`;
  const tarball = join(codexArtifactDir, tarballName);
  run("tar", ["-czf", tarball, "-C", join(workDir, "codex"), packageName]);
  return {
    name: pluginYaml.name,
    version,
    tarball: posixRelative(rootDir, tarball),
    sha256: await sha256(tarball),
    manifestPath: `${packageName}/plugin-manifest.json`
  };
}

function parseSimpleYaml(raw) {
  const parsed = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(line);
    if (match) parsed[match[1]] = match[2].trim();
  }
  return parsed;
}

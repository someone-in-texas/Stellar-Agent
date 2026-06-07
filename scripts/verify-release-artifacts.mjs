import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  readJson,
  releaseManifestPath,
  rootDir,
  run
} from "./release-utils.mjs";

const manifest = await readJson(releaseManifestPath);
const workspaceLeakErrors = [];

for (const pkg of manifest.npmPackages) {
  const tarball = resolve(rootDir, pkg.tarball);
  const packageJson = JSON.parse(run("tar", ["-xOf", tarball, "package/package.json"]).stdout);
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, range] of Object.entries(packageJson[field] ?? {})) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        workspaceLeakErrors.push(`${packageJson.name} ${field}.${name} leaked ${range}`);
      }
    }
  }
  if (!packageJson.files?.includes("dist")) {
    workspaceLeakErrors.push(`${packageJson.name} package does not declare files: [dist]`);
  }
  if (!pkg.files?.includes("README.md")) {
    workspaceLeakErrors.push(`${packageJson.name} tarball does not include README.md for npm package pages`);
  }
  const tarballFiles = run("tar", ["-tf", tarball]).stdout.split(/\r?\n/);
  if (!tarballFiles.includes("package/README.md")) {
    workspaceLeakErrors.push(`${packageJson.name} tarball is missing package/README.md`);
  }
}

if (workspaceLeakErrors.length > 0) {
  for (const error of workspaceLeakErrors) console.error(`artifact check: ${error}`);
  process.exit(1);
}

const installRoot = await mkdtemp(join(tmpdir(), "stellar-agent-release-install-"));
await mkdir(installRoot, { recursive: true });
await run("npm", ["init", "-y"], { cwd: installRoot });
const tarballs = manifest.npmPackages.map((pkg) => resolve(rootDir, pkg.tarball));
await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", "/tmp/stellar-agent-npm-cache", ...tarballs], {
  cwd: installRoot,
  stdio: "pipe"
});

const binDir = join(installRoot, "node_modules", ".bin");
const cli = join(binDir, "stellar-agent");
const codexCli = join(binDir, "stellar-agent-codex-plugin");
const version = run(cli, ["--version"], { cwd: installRoot }).stdout.trim();
if (version !== manifest.version) {
  throw new Error(`Installed stellar-agent version ${version} does not match ${manifest.version}.`);
}
run(cli, ["--help"], { cwd: installRoot });
const doctor = JSON.parse(run(cli, ["--config", join(installRoot, "config.yaml"), "testnet", "doctor", "--json"], { cwd: installRoot }).stdout);
if (!doctor.ok || doctor.data?.ok !== true) {
  throw new Error(`Installed stellar-agent testnet doctor failed: ${JSON.stringify(doctor)}`);
}

const extractRoot = await mkdtemp(join(tmpdir(), "stellar-agent-codex-artifact-"));
run("tar", ["-xzf", resolve(rootDir, manifest.codexPlugin.tarball), "-C", extractRoot]);
const pluginRoot = join(extractRoot, `stellar-agent-codex-plugin-${manifest.version}`);
const codexValidation = JSON.parse(run(codexCli, ["validate", pluginRoot], { cwd: installRoot }).stdout);
if (!codexValidation.valid) {
  throw new Error(`Codex plugin artifact failed validation: ${JSON.stringify(codexValidation)}`);
}
const pluginManifest = JSON.parse(await readFile(join(pluginRoot, "plugin-manifest.json"), "utf8"));
if (pluginManifest.version !== manifest.version) {
  throw new Error(`Codex plugin manifest version ${pluginManifest.version} does not match ${manifest.version}.`);
}

console.log(`Release artifacts install and validate cleanly for ${manifest.version}.`);

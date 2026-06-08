import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

export const rootDir = process.cwd();
export const releaseDir = join(rootDir, ".release");
export const artifactDir = join(releaseDir, "artifacts");
export const npmArtifactDir = join(artifactDir, "npm");
export const codexArtifactDir = join(artifactDir, "codex");
export const workDir = join(releaseDir, "work");
export const releaseManifestPath = join(artifactDir, "release-manifest.json");

export const publishablePackageDirs = [
  "packages/core",
  "packages/ledger-logger",
  "packages/policy",
  "packages/stellar",
  "packages/defi",
  "packages/freighter-bridge",
  "packages/walletconnect-bridge",
  "packages/mcp-server",
  "packages/testnet-suite",
  "packages/x402-client",
  "packages/mpp-client",
  "packages/codex-plugin",
  "packages/cli"
];

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function sha256(path) {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: { ...process.env, ...(options.env ?? {}) }
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout?.trim(),
        result.stderr?.trim()
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  return result;
}

export async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

export async function assertExists(path, label = path) {
  try {
    await stat(path);
  } catch {
    throw new Error(`Missing required ${label}: ${path}`);
  }
}

export function posixRelative(from, to) {
  return relative(from, to).split("\\").join("/");
}

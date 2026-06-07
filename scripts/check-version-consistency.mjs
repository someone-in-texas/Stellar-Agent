import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { publishablePackageDirs, readJson, rootDir } from "./release-utils.mjs";

const rootPackage = await readJson(join(rootDir, "package.json"));
const releaseVersion = process.env.RELEASE_VERSION ?? rootPackage.version;
const errors = [];

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(releaseVersion)) {
  errors.push(`Root version is not a semver release version: ${releaseVersion}`);
}
for (const packageDir of publishablePackageDirs) {
  const packageJsonPath = join(rootDir, packageDir, "package.json");
  const packageJson = await readJson(packageJsonPath);
  if (packageJson.version !== releaseVersion) {
    errors.push(`${packageDir} version ${packageJson.version} does not match ${releaseVersion}`);
  }
  if (packageJson.private) {
    errors.push(`${packageDir} is marked private but is in the publishable package set`);
  }
  for (const field of ["name", "description", "license", "repository", "bugs", "homepage", "engines", "files"]) {
    if (!packageJson[field]) errors.push(`${packageDir} package.json is missing ${field}`);
  }
  if (!Array.isArray(packageJson.files) || !packageJson.files.includes("dist")) {
    errors.push(`${packageDir} package.json files must include dist`);
  }
  if (!packageJson.repository?.url?.includes("someone-in-texas/Stellar-Agent")) {
    errors.push(`${packageDir} repository URL must point at someone-in-texas/Stellar-Agent`);
  }
}

const pluginYaml = parseSimpleYaml(await readFile(join(rootDir, "plugins", "codex", "plugin.yaml"), "utf8"));
if (pluginYaml.version !== releaseVersion) {
  errors.push(`plugins/codex/plugin.yaml version ${pluginYaml.version} does not match ${releaseVersion}`);
}

const changelog = await readFile(join(rootDir, "CHANGELOG.md"), "utf8");
if (!changelog.includes(`## ${releaseVersion}`)) {
  errors.push(`CHANGELOG.md is missing ## ${releaseVersion}`);
}

const releaseDoc = await readFile(join(rootDir, "RELEASE.md"), "utf8");
for (const expected of [
  "pnpm release:pack",
  "pnpm release:verify-artifacts",
  `stellar-agent-codex-plugin-v${releaseVersion}.tgz`,
  "pnpm release:publish:npm"
]) {
  if (!releaseDoc.includes(expected)) errors.push(`RELEASE.md is missing ${expected}`);
}

await checkUserFacingDocsForStaleReleaseLines(releaseVersion);

if (errors.length > 0) {
  for (const error of errors) console.error(`release version check: ${error}`);
  process.exit(1);
}

console.log(`Release version metadata is consistent for ${releaseVersion}.`);

function parseSimpleYaml(raw) {
  const parsed = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(line);
    if (match) parsed[match[1]] = match[2].trim();
  }
  return parsed;
}

async function checkUserFacingDocsForStaleReleaseLines(version) {
  const staleLine = previousMinorLine(version);
  if (!staleLine) return;
  const docs = [
    "README.md",
    "RELEASE.md",
    "docs/codex-plugin.md",
    "docs/distribution.md",
    "docs/quickstart.md",
    "docs/quickstart-testnet.md",
    "packages/mcp-server/README.md",
    "packages/codex-plugin/README.md",
    "plugins/codex/README.md",
    ...(await skillDocs())
  ];
  for (const doc of docs) {
    const body = await readFile(join(rootDir, doc), "utf8");
    if (body.includes(staleLine)) {
      errors.push(`${doc} contains stale previous release line ${staleLine}; update docs or move historical notes to CHANGELOG.md`);
    }
  }
}

function previousMinorLine(version) {
  const match = /^(\d+)\.(\d+)\./.exec(version);
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || minor < 1) return undefined;
  return `${major}.${minor - 1}.x`;
}

async function skillDocs() {
  const skillsDir = join(rootDir, "plugins", "codex", "skills");
  const entries = await readdir(skillsDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => `plugins/codex/skills/${entry.name}/SKILL.md`);
}

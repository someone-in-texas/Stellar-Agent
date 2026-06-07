import { readJson, releaseManifestPath, run } from "./release-utils.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const repo = readOption("--repo") ?? "someone-in-texas/Stellar-Agent";
const workflow = readOption("--workflow") ?? "npm-publish.yml";
const environment = readOption("--env") ?? "npm-production";
const packageFilter = readOption("--package");

const manifest = await readJson(releaseManifestPath);
const packages = packageFilter ? manifest.npmPackages.filter((pkg) => pkg.name === packageFilter) : manifest.npmPackages;
if (packageFilter && packages.length === 0) {
  throw new Error(`Package ${packageFilter} was not found in ${releaseManifestPath}.`);
}

for (const pkg of packages) {
  const command = [
    "trust",
    "github",
    pkg.name,
    "--repo",
    repo,
    "--file",
    workflow,
    "--env",
    environment,
    "--allow-publish",
    "--yes",
    "--json"
  ];
  if (dryRun) command.push("--dry-run");

  console.log(`${dryRun ? "Dry-run configuring" : "Configuring"} trusted publishing for ${pkg.name}`);
  run("npm", command, { stdio: "inherit" });
}

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

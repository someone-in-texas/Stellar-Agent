import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readJson, releaseManifestPath, rootDir, run } from "./release-utils.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipExisting = !args.includes("--no-skip-existing");
const skipAuthCheck = args.includes("--skip-auth-check");
const provenance = args.includes("--provenance");
const tag = readOption("--tag") ?? "latest";
const otp = readOption("--otp");
const packageFilter = readOption("--package");

const passthroughArgs = ["--access", "public", "--tag", tag];
if (dryRun) passthroughArgs.push("--dry-run");
if (provenance) passthroughArgs.push("--provenance");
if (otp) passthroughArgs.push("--otp", otp);

const manifest = await readJson(releaseManifestPath);

if (!dryRun && !skipAuthCheck) {
  const whoami = run("npm", ["whoami"], { allowFailure: true });
  if (whoami.status !== 0) {
    process.stderr.write(
      [
        "npm publish check: npm authentication failed.",
        "Run `npm login` and verify with `npm whoami` before publishing.",
        whoami.stderr.trim()
      ]
        .filter(Boolean)
        .join("\n") + "\n"
    );
    process.exit(1);
  }
}

const packages = packageFilter ? manifest.npmPackages.filter((pkg) => pkg.name === packageFilter) : manifest.npmPackages;
if (packageFilter && packages.length === 0) {
  throw new Error(`Package ${packageFilter} was not found in ${releaseManifestPath}.`);
}

for (const pkg of packages) {
  const tarball = resolve(rootDir, pkg.tarball);
  if (!existsSync(tarball)) {
    throw new Error(`Missing npm tarball for ${pkg.name}: ${pkg.tarball}`);
  }

  if (skipExisting && packageVersionExists(pkg.name, pkg.version)) {
    console.log(`Skipping ${pkg.name}@${pkg.version}; it already exists on npm.`);
    continue;
  }

  console.log(`${dryRun ? "Dry-run publishing" : "Publishing"} ${pkg.name}@${pkg.version} from ${pkg.tarball}`);
  run("npm", ["publish", tarball, ...passthroughArgs], { stdio: "inherit" });
}

function packageVersionExists(name, version) {
  const result = run("npm", ["view", `${name}@${version}`, "version", "--json"], { allowFailure: true });
  if (result.status === 0) return true;
  if (result.stderr.includes("E404") || result.stdout.includes("E404")) return false;
  return false;
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

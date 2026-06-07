import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readJson, releaseManifestPath } from "./release-utils.mjs";

const defaultAttempts = readPositiveInteger(process.env.NPM_VERIFY_ATTEMPTS, 12);
const defaultDelayMs = readPositiveInteger(process.env.NPM_VERIFY_DELAY_MS, 10_000);

if (isMain()) {
  await verifyPublishedNpmVersions({
    attempts: defaultAttempts,
    delayMs: defaultDelayMs
  });
}

export async function verifyPublishedNpmVersions(options = {}) {
  const manifest = await readJson(options.manifestPath ?? releaseManifestPath);
  const packages = options.packages ?? manifest.npmPackages;
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error("release manifest does not contain npm packages to verify.");
  }

  const attempts = options.attempts ?? defaultAttempts;
  const delayMs = options.delayMs ?? defaultDelayMs;
  const npmView = options.npmView ?? viewPackageVersion;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? console.log;
  const pending = new Map(packages.map((pkg) => [`${pkg.name}@${pkg.version}`, pkg]));
  const lastErrors = new Map();

  for (let attempt = 1; attempt <= attempts && pending.size > 0; attempt += 1) {
    for (const [label, pkg] of [...pending]) {
      try {
        const publishedVersion = npmView(pkg.name, pkg.version);
        if (publishedVersion !== pkg.version) {
          throw new Error(`npm returned version ${publishedVersion}`);
        }
        pending.delete(label);
        lastErrors.delete(label);
        log(`${label} is visible on npm.`);
      } catch (error) {
        lastErrors.set(label, error instanceof Error ? error.message : String(error));
      }
    }

    if (pending.size === 0) break;
    if (attempt < attempts) {
      log(
        `Waiting ${delayMs}ms for npm registry propagation before verification attempt ${attempt + 1}/${attempts}: ${[
          ...pending.keys()
        ].join(", ")}`
      );
      await sleep(delayMs);
    }
  }

  if (pending.size > 0) {
    throw new Error(
      [
        `npm publish verification failed after ${attempts} attempts.`,
        ...[...pending.keys()].map((label) => `- ${label}: ${lastErrors.get(label) ?? "not visible"}`)
      ].join("\n")
    );
  }
}

function viewPackageVersion(name, version) {
  const output = execFileSync("npm", ["view", `${name}@${version}`, "version", "--json"], {
    encoding: "utf8"
  }).trim();
  return JSON.parse(output);
}

function readPositiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isMain() {
  return process.argv[1] ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href : false;
}

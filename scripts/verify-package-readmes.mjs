import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  publishablePackageDirs,
  readJson,
  releaseManifestPath,
  rootDir,
  run
} from "./release-utils.mjs";

const errors = [];

for (const packageDir of publishablePackageDirs) {
  const packageJson = await readJson(join(rootDir, packageDir, "package.json"));
  const readmePath = join(rootDir, packageDir, "README.md");
  try {
    const readme = await readFile(readmePath, "utf8");
    if (!readme.includes(`# ${packageJson.name}`)) {
      errors.push(`${packageDir}/README.md must include '# ${packageJson.name}'.`);
    }
    if (!readme.includes("https://github.com/someone-in-texas/Stellar-Agent")) {
      errors.push(`${packageDir}/README.md must link back to the GitHub repository.`);
    }
  } catch {
    errors.push(`${packageDir} is missing README.md.`);
  }
}

try {
  await access(releaseManifestPath);
  const manifest = await readJson(releaseManifestPath);
  for (const pkg of manifest.npmPackages ?? []) {
    if (!pkg.files?.includes("README.md")) {
      errors.push(`${pkg.name} manifest entry is missing README.md.`);
      continue;
    }
    const tarball = resolve(rootDir, pkg.tarball);
    const tarballFiles = run("tar", ["-tf", tarball]).stdout.split(/\r?\n/);
    if (!tarballFiles.includes("package/README.md")) {
      errors.push(`${pkg.name} tarball is missing package/README.md.`);
    }
  }
} catch {
  errors.push("release manifest is missing; run pnpm release:pack before pnpm release:verify-readmes.");
}

if (errors.length > 0) {
  for (const error of errors) console.error(`package readme check: ${error}`);
  process.exit(1);
}

console.log("Package README checks passed.");

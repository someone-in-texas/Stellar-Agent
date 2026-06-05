import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listFiles, posixRelative, readJson, rootDir } from "./release-utils.mjs";

const errors = [];
const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

const protocolSdks = [
  {
    name: "@blend-capital/blend-sdk",
    allowedPackageDirs: ["packages/defi"],
    allowedImportDirs: ["packages/defi/src"],
    requireDynamicImport: true
  }
];

const adapterPackages = [
  {
    name: "@stellar-agent/defi",
    allowedPackageDirs: ["packages/cli"],
    allowedDynamicImportDirs: ["packages/cli/src"],
    allowedTypeImportDirs: ["packages/cli/src"]
  }
];

const approvedDefiThirdPartyDependencies = new Set(["@blend-capital/blend-sdk", "@stellar/stellar-sdk"]);

const packageJsonPaths = (await listFiles(join(rootDir, "packages")))
  .filter((file) => file.endsWith("/package.json"))
  .sort();

for (const packageJsonPath of packageJsonPaths) {
  const packageDir = posixRelative(rootDir, dirname(packageJsonPath));
  const packageJson = await readJson(packageJsonPath);
  const declaredDependencies = dependencyFields.flatMap((field) =>
    Object.keys(packageJson[field] ?? {}).map((name) => ({ field, name }))
  );

  for (const sdk of protocolSdks) {
    for (const dependency of declaredDependencies.filter((entry) => entry.name === sdk.name)) {
      if (!sdk.allowedPackageDirs.includes(packageDir)) {
        errors.push(`${packageDir} declares ${sdk.name} in ${dependency.field}; allowed only in ${sdk.allowedPackageDirs.join(", ")}`);
      }
    }
  }

  for (const adapter of adapterPackages) {
    for (const dependency of declaredDependencies.filter((entry) => entry.name === adapter.name)) {
      if (!adapter.allowedPackageDirs.includes(packageDir)) {
        errors.push(
          `${packageDir} declares ${adapter.name} in ${dependency.field}; allowed only in ${adapter.allowedPackageDirs.join(", ")}`
        );
      }
    }
  }

  if (packageDir === "packages/defi") {
    for (const dependency of declaredDependencies) {
      if (dependency.name.startsWith("@stellar-agent/")) continue;
      if (approvedDefiThirdPartyDependencies.has(dependency.name)) continue;
      errors.push(
        `${packageDir} declares unapproved third-party dependency ${dependency.name}; update protocol SDK boundaries before release`
      );
    }
  }
}

const sourceFiles = (await listFiles(join(rootDir, "packages")))
  .filter((file) => /\.(c|m)?(t|j)sx?$/.test(file))
  .filter((file) => !file.includes("/dist/"))
  .sort();

for (const file of sourceFiles) {
  const relativeFile = posixRelative(rootDir, file);
  const source = await readText(file);

  for (const sdk of protocolSdks) {
    const imports = findImports(source, sdk.name);
    if (imports.length === 0) continue;
    const allowed = sdk.allowedImportDirs.some((dir) => relativeFile.startsWith(`${dir}/`));
    if (!allowed) {
      errors.push(`${relativeFile} imports ${sdk.name}; allowed only under ${sdk.allowedImportDirs.join(", ")}`);
    }
    if (sdk.requireDynamicImport && imports.some((entry) => entry.kind !== "dynamic")) {
      errors.push(`${relativeFile} must import ${sdk.name} with dynamic import() only`);
    }
  }

  for (const adapter of adapterPackages) {
    const imports = findImports(source, adapter.name);
    for (const importEntry of imports) {
      if (importEntry.kind === "type") {
        const allowedType = adapter.allowedTypeImportDirs.some((dir) => relativeFile.startsWith(`${dir}/`));
        if (!allowedType) {
          errors.push(`${relativeFile} type-imports ${adapter.name}; allowed only under ${adapter.allowedTypeImportDirs.join(", ")}`);
        }
        continue;
      }
      if (importEntry.kind === "dynamic") {
        const allowedDynamic = adapter.allowedDynamicImportDirs.some((dir) => relativeFile.startsWith(`${dir}/`));
        if (!allowedDynamic) {
          errors.push(
            `${relativeFile} dynamically imports ${adapter.name}; allowed only under ${adapter.allowedDynamicImportDirs.join(", ")}`
          );
        }
        continue;
      }
      errors.push(`${relativeFile} statically imports ${adapter.name}; use import type or dynamic import() instead`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`protocol SDK boundary check: ${error}`);
  process.exit(1);
}

console.log("Protocol SDK boundaries passed.");

async function readText(path) {
  return await readFile(path, "utf8");
}

function findImports(source, specifier) {
  const escaped = escapeRegExp(specifier);
  const imports = [];
  const staticImport = new RegExp(`import\\s+(type\\s+)?(?:[^"']+?\\s+from\\s+)?["']${escaped}["']`, "g");
  for (const match of source.matchAll(staticImport)) {
    imports.push({ kind: match[1] ? "type" : "static" });
  }
  const dynamicImport = new RegExp(`import\\s*\\(\\s*["']${escaped}["']\\s*\\)`, "g");
  const dynamicImportCount = source.match(dynamicImport)?.length ?? 0;
  for (let index = 0; index < dynamicImportCount; index += 1) {
    imports.push({ kind: "dynamic" });
  }
  return imports;
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

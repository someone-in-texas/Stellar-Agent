import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, rootDir } from "./release-utils.mjs";

const errors = [];

function requireText(name, body, needles) {
  for (const needle of needles) {
    if (!body.includes(needle)) errors.push(`${name} is missing safety invariant: ${needle}`);
  }
}

const threatModel = await readFile(join(rootDir, "docs", "threat-model.md"), "utf8");
const securityPolicy = await readFile(join(rootDir, "SECURITY.md"), "utf8");
const securityGuide = await readFile(join(rootDir, "docs", "security.md"), "utf8");
const mainnetSafety = await readFile(join(rootDir, "docs", "mainnet-safety.md"), "utf8");
const readme = await readFile(join(rootDir, "README.md"), "utf8");
const rootPackage = await readFile(join(rootDir, "package.json"), "utf8");
const cliSource = await readFile(join(rootDir, "packages", "cli", "src", "index.ts"), "utf8");
const coreTests = await readFile(join(rootDir, "packages", "core", "test", "core.test.ts"), "utf8");
const policyTests = await readFile(join(rootDir, "packages", "policy", "test", "policy.test.ts"), "utf8");
const cliTests = await readFile(join(rootDir, "packages", "cli", "test", "cli.test.ts"), "utf8");

requireText("docs/threat-model.md", threatModel, [
  "Secret key leakage",
  "Spend-history bypass",
  "Mainnet/Testnet confusion",
  "Third-party protocol SDK compromise",
  "protocol SDK boundary checks",
  "tests and docs are required for safety-sensitive changes"
]);
requireText("SECURITY.md", securityPolicy, [
  "Protocol SDK Boundaries",
  "treated as untrusted supply-chain inputs",
  "pnpm release:safety"
]);
requireText("docs/security.md", securityGuide, [
  "Protocol SDK Boundaries",
  "treated as untrusted supply-chain inputs",
  "scripts/check-protocol-sdk-boundaries.mjs"
]);
requireText("docs/mainnet-safety.md", mainnetSafety, [
  "Mainnet local auto-signing is blocked.",
  "do not pass raw Mainnet secret keys",
  "--allow-real-funds",
  "--i-understand-real-funds",
  "Receipts are enabled."
]);
requireText("README.md", readme, [
  "Testnet is the default.",
  "Mainnet is disabled by default and cannot auto-sign payments.",
  "Secret keys are redacted from CLI output, logs, and receipts.",
  "Policy evaluation runs before payment submission."
]);
requireText("packages/cli/src/index.ts", cliSource, [
  "resolveContractExecutionContext",
  "resolveContractSource",
  "SECRET_KEY_BLOCKED",
  "writeSubmittedXdrReceipt",
  "writeOperationReceipt"
]);
requireText("packages/core/test/core.test.ts", coreTests, ["redacts secret keys", "mainnet.enabled).toBe(false)"]);
requireText("packages/policy/test/policy.test.ts", policyTests, ["mainnet_requires_approval"]);
requireText("packages/cli/test/cli.test.ts", cliTests, [
  "blocks Mainnet contract submissions unless guarded Mainnet mode is enabled",
  "submits externally signed Mainnet XDR only with explicit real-funds flags and writes a receipt",
  "not.toContain(\"\\\"S\")"
]);
requireText("package.json", rootPackage, [
  "release:check-sdk-boundaries",
  "check-protocol-sdk-boundaries.mjs",
  "release:audit",
  "pnpm audit --prod"
]);

const cli = join(rootDir, "packages", "cli", "dist", "index.js");
const configPath = join(await mkdtemp(join(tmpdir(), "stellar-agent-release-safety-")), "config.yaml");
const status = run(process.execPath, [cli, "--config", configPath, "mainnet", "status", "--json"]);
const statusEnvelope = JSON.parse(status.stdout);
if (statusEnvelope.data?.enabled !== false) {
  errors.push(`mainnet status should default to enabled=false: ${status.stdout}`);
}
if (statusEnvelope.data?.realFunds !== true) {
  errors.push(`mainnet status should report realFunds=true: ${status.stdout}`);
}

const enableWithoutAck = run(process.execPath, [cli, "--config", configPath, "mainnet", "enable", "--json"], {
  stdio: "pipe",
  allowFailure: true
});
const enableEnvelope = JSON.parse(enableWithoutAck.stdout);
if (enableEnvelope.ok !== false || enableEnvelope.error?.code !== "MAINNET_NOT_ENABLED") {
  errors.push(`mainnet enable without acknowledgement should fail with MAINNET_NOT_ENABLED: ${enableWithoutAck.stdout}`);
}

for (const [label, body] of [
  ["README.md", readme],
  ["docs/mainnet-safety.md", mainnetSafety],
  ["plugins/codex/README.md", await readFile(join(rootDir, "plugins", "codex", "README.md"), "utf8")]
]) {
  if (/S[A-Z2-7]{55}/.test(body)) {
    errors.push(`${label} contains a raw Stellar secret-like value`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`release safety check: ${error}`);
  process.exit(1);
}

console.log("Release safety invariants passed.");

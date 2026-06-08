import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const examplePackages = [
  "x402-paid-api",
  "agent-service-market",
  "mainnet-agent-wallet-playground"
] as const;

describe("example package contracts", () => {
  it("keeps package-local test scripts runnable from each example directory", async () => {
    for (const example of examplePackages) {
      const packageJson = JSON.parse(await readFile(join("examples", example, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      expect(packageJson.scripts?.test, example).toMatch(/^vitest run test\/.+\.test\.ts$/);
      expect(packageJson.scripts?.test, example).not.toContain(`examples/${example}/`);
    }
  });

  it("documents receipt commands with each example's storage root", async () => {
    const marketReadme = await readFile(join("examples", "agent-service-market", "README.md"), "utf8");
    expect(marketReadme).toContain("STELLAR_AGENT_HOME=.stellar-agent-service-market stellar-agent receipts latest --json");

    const x402Readme = await readFile(join("examples", "x402-paid-api", "README.md"), "utf8");
    expect(x402Readme).toContain("STELLAR_AGENT_HOME=.stellar-agent-x402-example stellar-agent receipts latest --json");
  });
});

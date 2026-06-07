import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { verifyPublishedNpmVersions } from "./verify-published-npm.mjs";

describe("verifyPublishedNpmVersions", () => {
  it("retries packages that are not immediately visible on npm", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "stellar-agent-npm-verify-"));
    const manifestPath = join(tempDir, "release-manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        npmPackages: [
          { name: "@stellar-agent/core", version: "0.4.1" },
          { name: "@stellar-agent/cli", version: "0.4.1" }
        ]
      })
    );

    const calls = [];
    await verifyPublishedNpmVersions({
      manifestPath,
      attempts: 3,
      delayMs: 1,
      log: () => {},
      sleep: async () => {},
      npmView: (name, version) => {
        calls.push(`${name}@${version}`);
        if (name === "@stellar-agent/cli" && calls.filter((call) => call === `${name}@${version}`).length === 1) {
          throw new Error("E404");
        }
        return version;
      }
    });

    expect(calls).toEqual([
      "@stellar-agent/core@0.4.1",
      "@stellar-agent/cli@0.4.1",
      "@stellar-agent/cli@0.4.1"
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("reports packages that never become visible", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "stellar-agent-npm-verify-"));
    const manifestPath = join(tempDir, "release-manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        npmPackages: [{ name: "@stellar-agent/cli", version: "0.4.1" }]
      })
    );

    await expect(
      verifyPublishedNpmVersions({
        manifestPath,
        attempts: 2,
        delayMs: 1,
        log: () => {},
        sleep: async () => {},
        npmView: () => {
          throw new Error("E404");
        }
      })
    ).rejects.toThrow("@stellar-agent/cli@0.4.1: E404");

    await rm(tempDir, { recursive: true, force: true });
  });
});

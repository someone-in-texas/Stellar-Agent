import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("release version consistency", () => {
  it("rejects a workflow release tag that differs from the package version", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    const result = spawnSync(process.execPath, ["scripts/check-version-consistency.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, RELEASE_TAG: "v99.99.99" }
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `Release tag v99.99.99 does not match package version ${packageJson.version}`
    );
  });
});

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCodexPlugin, writeCodexPluginManifest } from "../src/index.js";

describe("codex plugin tooling", () => {
  it("validates the bundled Codex plugin", async () => {
    const validation = await validateCodexPlugin(join(process.cwd(), "plugins", "codex"));
    expect(validation).toMatchObject({
      valid: true,
      manifest: {
        name: "stellar-agent-bridge",
        skills: [
          { path: "skills/stellar-agent-testnet", title: "Stellar Agent Testnet" },
          { path: "skills/stellar-agent-payments", title: "Stellar Agent Payments" }
        ]
      }
    });
    expect(validation.errors).toEqual([]);
  });

  it("keeps bundled skills aligned with implemented workflow families", async () => {
    const root = join(process.cwd(), "plugins", "codex");
    const testnetSkill = await readFile(join(root, "skills", "stellar-agent-testnet", "SKILL.md"), "utf8");
    const paymentsSkill = await readFile(join(root, "skills", "stellar-agent-payments", "SKILL.md"), "utf8");

    for (const expected of ["issued-asset-payment", "contract-asset-smoke", "trustline", "claimable", "contract asset-deploy"]) {
      expect(testnetSkill).toContain(expected);
    }
    for (const expected of ["pay x402", "pay mpp", "mpp-session", "approval create-transaction"]) {
      expect(paymentsSkill).toContain(expected);
    }
  });

  it("reports missing skill files", async () => {
    const root = join(tmpdir(), `stellar-agent-codex-plugin-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "plugin.yaml"),
      "name: broken\nversion: 0.0.0\ndescription: broken plugin\nskills:\n  - skills/missing\n"
    );
    await expect(validateCodexPlugin(root)).resolves.toMatchObject({
      valid: false,
      errors: ["Missing or empty skill file: skills/missing/SKILL.md"]
    });
  });

  it("writes a normalized plugin manifest", async () => {
    const output = join(tmpdir(), `stellar-agent-codex-plugin-manifest-${Date.now()}.json`);
    await expect(writeCodexPluginManifest(join(process.cwd(), "plugins", "codex"), output)).resolves.toMatchObject({
      schemaVersion: "stellar-agent.codex-plugin.v1",
      name: "stellar-agent-bridge"
    });
  });
});

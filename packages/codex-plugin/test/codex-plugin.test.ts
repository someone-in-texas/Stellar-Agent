import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateCodexPlugin, writeCodexPluginManifest } from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const pluginRoot = join(repoRoot, "plugins", "codex");

describe("codex plugin tooling", () => {
  it("validates the bundled Codex plugin", async () => {
    const validation = await validateCodexPlugin(pluginRoot);
    expect(validation).toMatchObject({
      valid: true,
      manifest: {
        name: "stellar-agent-bridge",
        skills: [
          { path: "skills/stellar-agent-testnet", title: "Stellar Agent Testnet" },
          { path: "skills/stellar-agent-payments", title: "Stellar Agent Payments" },
          { path: "skills/stellar-agent-defi", title: "Stellar Agent DeFi" },
          { path: "skills/stellar-agent-market-liquidity", title: "Stellar Agent Market Liquidity" }
        ]
      }
    });
    expect(validation.errors).toEqual([]);
  });

  it("keeps bundled skills aligned with implemented workflow families", async () => {
    const root = pluginRoot;
    const testnetSkill = await readFile(join(root, "skills", "stellar-agent-testnet", "SKILL.md"), "utf8");
    const paymentsSkill = await readFile(join(root, "skills", "stellar-agent-payments", "SKILL.md"), "utf8");
    const defiSkill = await readFile(join(root, "skills", "stellar-agent-defi", "SKILL.md"), "utf8");
    const marketSkill = await readFile(join(root, "skills", "stellar-agent-market-liquidity", "SKILL.md"), "utf8");

    for (const expected of ["issued-asset-payment", "contract-asset-smoke", "trustline", "claimable", "contract asset-deploy"]) {
      expect(testnetSkill).toContain(expected);
    }
    for (const expected of ["pay x402", "pay mpp", "mpp-session", "approval create-transaction"]) {
      expect(paymentsSkill).toContain(expected);
    }
    for (const expected of ["defi blend preflight", "defi aquarius lp preflight", "defi.aquarius", "slippage-bps"]) {
      expect(defiSkill).toContain(expected);
    }
    for (const expected of ["market lp preflight", "market listen price", "strategy investigate liquidity", "adapter-required"]) {
      expect(marketSkill).toContain(expected);
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
    await expect(writeCodexPluginManifest(pluginRoot, output)).resolves.toMatchObject({
      schemaVersion: "stellar-agent.codex-plugin.v1",
      name: "stellar-agent-bridge"
    });
  });
});

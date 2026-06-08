import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("agent recipes", () => {
  it("documents the quote, approval, explicit-submit, receipt sequence for LLM agents", async () => {
    const path = fileURLToPath(new URL("../../docs/agent-recipes.md", import.meta.url));
    const text = await readFile(path, "utf8");
    for (const required of [
      "stellar-agent pay quote --to G... --amount 1 --asset XLM --fee-strategy medium --json",
      "stellar-agent policy explain --to G... --amount 1 --asset XLM --json",
      "stellar-agent approval create-payment --to G... --amount 1 --asset XLM --json",
      "stellar-agent pay send --to G... --amount 1 --asset XLM --approval-id appr_... --json",
      "stellar-agent receipts latest --json",
      "paidResourceDelivered: true"
    ]) {
      expect(text).toContain(required);
    }
  });
});

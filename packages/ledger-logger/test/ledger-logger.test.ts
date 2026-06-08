import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvent, latestReceipt, spendHistoryFromReceipts, writeReceipt } from "../src/index.js";

describe("ledger logger", () => {
  it("writes JSONL events without secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stellar-agent-"));
    const logPath = join(dir, "events.jsonl");
    await appendEvent(logPath, {
      event: "policy_decision",
      status: "allowed",
      profile: "testnet",
      data: { secretKey: "S".padEnd(56, "A") }
    });
    const raw = await readFile(logPath, "utf8");
    expect(raw).toContain("[REDACTED]");
    expect(raw).not.toContain("SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("writes and reads latest receipts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stellar-agent-"));
    const { receipt } = await writeReceipt(dir, {
      command: "testnet smoke-test",
      profile: "testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      realFunds: false,
      payment: {
        source: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        asset: "XLM",
        amount: "1.0000000"
      },
      policyDecision: { status: "allowed", matchedRules: ["policy_allowed"] },
      transaction: { hash: "abc", successful: true }
    });
    const latest = await latestReceipt(dir);
    expect(latest?.receipt.id).toBe(receipt.id);
  });

  it("writes operation receipts without payment metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stellar-agent-"));
    const { receipt } = await writeReceipt(dir, {
      command: "wallet trustline add",
      profile: "testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      realFunds: false,
      operation: {
        type: "trustline.add",
        account: "merchant",
        source: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        asset: "USD:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        limit: "100.0000000"
      },
      policyDecision: { status: "allowed", matchedRules: ["testnet_operation"] },
      transaction: { hash: "abc", successful: true }
    });
    expect(receipt.payment).toBeUndefined();
    expect(receipt.operation).toMatchObject({ type: "trustline.add", account: "merchant" });
  });

  it("computes spend history from successful non-denied payment receipts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stellar-agent-"));
    await writeReceipt(dir, {
      command: "pay send",
      profile: "testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      realFunds: false,
      payment: {
        source: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        destination: "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        asset: "XLM",
        amount: "1.5000000",
        domain: "127.0.0.1:3000"
      },
      policyDecision: { status: "allowed", matchedRules: ["policy_allowed"] },
      transaction: { hash: "abc", successful: true }
    });
    await writeReceipt(dir, {
      command: "pay send",
      profile: "testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      realFunds: false,
      payment: {
        source: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        destination: "GCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        asset: "XLM",
        amount: "2.0000000"
      },
      policyDecision: { status: "requires_approval", matchedRules: ["amount_above_auto_approval_threshold"] },
      transaction: { hash: "def", successful: true }
    });

    await expect(spendHistoryFromReceipts(dir, { profile: "testnet", asset: "XLM" })).resolves.toMatchObject({
      dailyTotal: "3.5000000",
      monthlyTotal: "3.5000000",
      knownRecipients: expect.arrayContaining([
        "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "GCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      ]),
      knownDomains: ["127.0.0.1:3000"]
    });
  });
});

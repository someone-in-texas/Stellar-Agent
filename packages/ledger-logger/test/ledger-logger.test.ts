import { appendFile, mkdtemp, readFile, readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { activeSpendReservations, appendEvent, claimExecutionIntent, createExecutionIntent, latestReceipt, readExecutionIntent, spendHistoryFromReceipts, transitionExecutionIntent, verifyEventLogChain, verifyReceiptChain, writeReceipt } from "../src/index.js";

describe("ledger logger", () => {
  it("allows only one worker to claim an idempotent execution", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stellar-agent-execution-claim-"));
    const { intent } = await createExecutionIntent(dir, { command: "pay send", profile: "testnet", networkPassphrase: "Test SDF Network ; September 2015", realFunds: false, operation: { type: "payment", amount: "0.1", asset: "XLM" }, idempotencyKey: "one-job" });
    const results = await Promise.allSettled([claimExecutionIntent(dir, intent.id, "worker_a"), claimExecutionIntent(dir, intent.id, "worker_b")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
  it("creates one durable intent for concurrent idempotent calls and rejects semantic reuse", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stellar-agent-intents-"));
    const input = {
      command: "pay send",
      profile: "testnet" as const,
      networkPassphrase: "Test SDF Network ; September 2015",
      realFunds: false,
      operation: {
        type: "payment",
        destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        asset: "XLM",
        amount: "1.0000000"
      },
      idempotencyKey: "job-1",
      spendReservation: { asset: "XLM", amount: "1.0000000" }
    };
    const [left, right] = await Promise.all([createExecutionIntent(dir, input), createExecutionIntent(dir, input)]);
    expect(left.intent.id).toBe(right.intent.id);
    expect([left.created, right.created].filter(Boolean)).toHaveLength(1);
    await expect(activeSpendReservations(dir)).resolves.toEqual([{ intentId: left.intent.id, amount: "1.0000000", asset: "XLM" }]);
    await expect(
      createExecutionIntent(dir, {
        ...input,
        operation: { ...input.operation, amount: "2.0000000" }
      })
    ).rejects.toThrow("different operation");
    const idempotencyDir = join(dir, "idempotency");
    const [indexName] = await readdir(idempotencyDir);
    await unlink(join(idempotencyDir, indexName!));
    await expect(createExecutionIntent(dir, input)).resolves.toMatchObject({
      created: false,
      intent: { id: left.intent.id }
    });
  });

  it("serializes concurrent intent transitions without corrupting revisions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stellar-agent-intent-transition-"));
    const { intent } = await createExecutionIntent(dir, {
      command: "pay send",
      profile: "testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      realFunds: false,
      operation: { type: "payment" }
    });
    const outcomes = await Promise.allSettled([transitionExecutionIntent(dir, intent.id, "approved"), transitionExecutionIntent(dir, intent.id, "denied")]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(readExecutionIntent(dir, intent.id)).resolves.toMatchObject({ revision: 2 });
  });

  it("keeps a confirmed spend counted until its receipt link is durable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stellar-agent-intent-receipt-gap-"));
    const { intent } = await createExecutionIntent(dir, {
      command: "pay send",
      profile: "mainnet",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      realFunds: true,
      operation: { type: "payment" },
      spendReservation: { asset: "XLM", amount: "1.0000000" }
    });
    const approved = await transitionExecutionIntent(dir, intent.id, "approved");
    const signed = await transitionExecutionIntent(dir, approved.id, "signed");
    const submitted = await transitionExecutionIntent(dir, signed.id, "submitted");
    await transitionExecutionIntent(dir, submitted.id, "confirmed", {
      spendReservation: { ...submitted.spendReservation!, active: false }
    });
    await expect(activeSpendReservations(dir)).resolves.toMatchObject([{ intentId: intent.id, amount: "1.0000000" }]);
  });

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
    await expect(verifyReceiptChain(dir)).resolves.toMatchObject({ valid: true, receipts: 1 });
  });

  it("verifies chained concurrent events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stellar-agent-events-"));
    const logPath = join(dir, "events.jsonl");
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        appendEvent(logPath, {
          event: "command_finished",
          status: "ok",
          data: { index }
        })
      )
    );
    await expect(verifyEventLogChain(logPath)).resolves.toMatchObject({ valid: true, entries: 8 });
  });

  it("rejects a legacy event inserted after the v2 chain begins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stellar-agent-events-reset-"));
    const logPath = join(dir, "events.jsonl");
    await appendEvent(logPath, { event: "command_started", status: "ok" });
    await appendFile(logPath, `${JSON.stringify({ schemaVersion: "stellar-agent.event.v1", event: "injected", status: "ok" })}\n`);
    await expect(verifyEventLogChain(logPath)).rejects.toThrow("only allowed before");
    await expect(appendEvent(logPath, { event: "command_finished", status: "ok" })).rejects.toThrow("only allowed before");
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
      policyDecision: {
        status: "requires_approval",
        matchedRules: ["amount_above_auto_approval_threshold"]
      },
      transaction: { hash: "def", successful: true }
    });

    await expect(spendHistoryFromReceipts(dir, { profile: "testnet", asset: "XLM" })).resolves.toMatchObject({
      dailyTotal: "3.5000000",
      monthlyTotal: "3.5000000",
      knownRecipients: expect.arrayContaining(["GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "GCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"]),
      knownDomains: ["127.0.0.1:3000"]
    });
  });
});

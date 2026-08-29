import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_TESTNET_POLICY } from "@stellar-agent/policy";
import { mppSessionStatePath, parseMppCharge, parseMppSessionRequirement, runMppPayment, runMppSession, readDurableMppSession, reserveMppSessionDebit, startMppDemo, startMppSessionDemo } from "../src/index.js";

const recipient = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const source = {
  schemaVersion: "stellar-agent.wallet.v1" as const,
  name: "agent",
  network: "testnet" as const,
  publicKey: "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  secretKey: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  createdAt: "2026-05-29T00:00:00.000Z",
  source: "generated-testnet" as const
};

const profile = {
  name: "testnet" as const,
  network: "testnet" as const,
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
  defaultAsset: "XLM" as const,
  realFunds: false
};

describe("mpp client", () => {
  it("hashes untrusted session ids instead of using them as path components", () => {
    const root = "/safe/session-state";
    const path = mppSessionStatePath(root, "../../approvals/appr_target");
    expect(path).toMatch(/^\/safe\/session-state\/[a-f0-9]{64}\.json$/);
    expect(path).not.toContain("approvals");
  });
  it("atomically enforces a durable MPP session budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-mpp-budget-"));
    const path = join(root, "session.json");
    const session = {
      sessionId: "session_atomic",
      networkPassphraseHash: "network_hash",
      asset: "XLM",
      budget: "0.0000002",
      recipient,
      facilitatorOrigin: "https://facilitator.example"
    };
    const results = await Promise.allSettled([reserveMppSessionDebit({ path, session, amount: "0.0000002" }), reserveMppSessionDebit({ path, session, amount: "0.0000002" })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(readDurableMppSession(path)).resolves.toMatchObject({
      spent: "0.0000002",
      revision: 1
    });
  });

  it("persists a confirmed intent for an MPP payment before returning the resource", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-mpp-intent-"));
    const url = "https://merchant.example/mpp";
    let calls = 0;
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const policy = { ...DEFAULT_TESTNET_POLICY, x402: { ...DEFAULT_TESTNET_POLICY.x402, enabled: true, allowDomains: [new URL(url).host] } };
    const result = await runMppPayment({
      url, source, policy, profile,
      receiptsDir: join(root, "receipts"), eventLog: join(root, "events.jsonl"), intentsDir: join(root, "intents"),
      idempotencyKey: "mpp-job-1", command: "test mpp",
      sendPaymentImpl: async () => ({ hash: "f".repeat(64), successful: true, ledger: 321 }),
      fetchImpl: async (_input, init) => {
        redirectModes.push(init?.redirect);
        calls += 1;
        return calls === 1
          ? new Response(JSON.stringify({ protocol: "stellar-agent-local-mpp", version: 1, chargeId: "charge_intent", network: "testnet", asset: "XLM", amount: "0.0000001", recipient, resource: url }), { status: 402 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    });
    expect(result).toMatchObject({ finalStatus: 200, intent: { status: "confirmed", receiptPath: expect.any(String) } });
    expect(redirectModes).toEqual(["error", "error"]);
  });

  it("parses charges from 402 headers", async () => {
    const charge = {
      protocol: "stellar-agent-local-mpp",
      version: 1,
      chargeId: "charge_1",
      network: "testnet",
      asset: "XLM",
      amount: "0.0000001",
      recipient,
      resource: "http://127.0.0.1/mpp-report"
    };
    const response = new Response(JSON.stringify(charge), {
      status: 402,
      headers: { "MPP-Charge": JSON.stringify(charge) }
    });
    await expect(parseMppCharge(response)).resolves.toEqual(charge);
  });

  it("parses session requirements from 402 headers", async () => {
    const session = {
      protocol: "stellar-agent-local-mpp-session" as const,
      version: 1 as const,
      sessionId: "session_1",
      network: "testnet" as const,
      asset: "XLM",
      budget: "0.0000003",
      pricePerRequest: "0.0000001",
      recipient,
      resource: "http://127.0.0.1/mpp-session"
    };
    const response = new Response(JSON.stringify(session), {
      status: 402,
      headers: { "MPP-Session": JSON.stringify(session) }
    });
    await expect(parseMppSessionRequirement(response)).resolves.toEqual(session);
  });

  it("runs a dry-run policy evaluation against the demo server", async () => {
    const server = await startMppDemo({ recipient });
    try {
      const policy = {
        ...DEFAULT_TESTNET_POLICY,
        x402: {
          ...DEFAULT_TESTNET_POLICY.x402,
          enabled: true,
          allowDomains: [new URL(server.url).host]
        }
      };
      const root = await mkdtemp(join(tmpdir(), "stellar-agent-mpp-"));
      await expect(
        runMppPayment({
          url: server.url,
          source,
          policy,
          profile,
          receiptsDir: join(root, "receipts"),
          eventLog: join(root, "logs", "events.jsonl"),
          command: "test",
          dryRun: true
        })
      ).resolves.toMatchObject({
        firstStatus: 402,
        finalStatus: 402,
        policyDecision: { status: "allowed" }
      });
    } finally {
      await server.close();
    }
  });

  it("rejects malformed proof headers without crashing the demo server", async () => {
    const server = await startMppDemo({ recipient });
    try {
      const response = await fetch(server.url, { headers: { "X-MPP-Payment": "{" } });
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "invalid_mpp_payment_proof"
      });
      expect(response.status).toBe(402);
    } finally {
      await server.close();
    }
  });

  it("rejects replayed one-time MPP payment proofs", async () => {
    const server = await startMppDemo({ recipient });
    try {
      const challenge = await fetch(server.url);
      const charge = await parseMppCharge(challenge);
      const proof = proofForCharge(charge, "a".repeat(64));

      const first = await fetch(server.url, {
        headers: { "X-MPP-Payment": JSON.stringify(proof) }
      });
      expect(first.status).toBe(200);

      const replay = await fetch(server.url, {
        headers: { "X-MPP-Payment": JSON.stringify(proof) }
      });
      expect(replay.status).toBe(402);
      await expect(replay.json()).resolves.toEqual({
        ok: false,
        error: "mpp_payment_proof_replayed"
      });
    } finally {
      await server.close();
    }
  });

  it("issues one MPP charge ID per paid challenge", async () => {
    const server = await startMppDemo({ recipient });
    try {
      const firstCharge = await parseMppCharge(await fetch(server.url));
      const invented = proofForCharge(firstCharge, "b".repeat(64), "invented_mpp_charge");

      const inventedResponse = await fetch(server.url, {
        headers: { "X-MPP-Payment": JSON.stringify(invented) }
      });
      expect(inventedResponse.status).toBe(402);
      await expect(inventedResponse.json()).resolves.toEqual({
        ok: false,
        error: "mpp_charge_not_issued"
      });

      const first = await fetch(server.url, {
        headers: { "X-MPP-Payment": JSON.stringify(proofForCharge(firstCharge, "c".repeat(64))) }
      });
      expect(first.status).toBe(200);

      const stale = await fetch(server.url, {
        headers: { "X-MPP-Payment": JSON.stringify(proofForCharge(firstCharge, "d".repeat(64))) }
      });
      expect(stale.status).toBe(402);
      await expect(stale.json()).resolves.toEqual({ ok: false, error: "mpp_charge_not_issued" });

      const secondCharge = await parseMppCharge(await fetch(server.url));
      expect(secondCharge.chargeId).not.toBe(firstCharge.chargeId);
      const second = await fetch(server.url, {
        headers: { "X-MPP-Payment": JSON.stringify(proofForCharge(secondCharge, "e".repeat(64))) }
      });
      expect(second.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("rejects charges for a different resource", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-mpp-resource-"));
    await expect(
      runMppPayment({
        url: "http://api.example.test/mpp-report",
        source,
        policy: DEFAULT_TESTNET_POLICY,
        profile,
        receiptsDir: join(root, "receipts"),
        eventLog: join(root, "logs", "events.jsonl"),
        command: "test",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              protocol: "stellar-agent-local-mpp",
              version: 1,
              chargeId: "charge_1",
              network: "testnet",
              asset: "XLM",
              amount: "0.0000001",
              recipient,
              resource: "http://other.example.test/mpp-report"
            }),
            { status: 402 }
          )
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects charges when only the resource query string differs", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-mpp-resource-query-"));
    await expect(
      runMppPayment({
        url: "http://api.example.test/mpp-report?item=expensive",
        source,
        policy: DEFAULT_TESTNET_POLICY,
        profile,
        receiptsDir: join(root, "receipts"),
        eventLog: join(root, "logs", "events.jsonl"),
        command: "test",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              protocol: "stellar-agent-local-mpp",
              version: 1,
              chargeId: "charge_1",
              network: "testnet",
              asset: "XLM",
              amount: "0.0000001",
              recipient,
              resource: "http://api.example.test/mpp-report?item=cheap"
            }),
            { status: 402 }
          )
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("runs a dry-run policy evaluation against the session demo server", async () => {
    const server = await startMppSessionDemo({ recipient });
    try {
      const policy = {
        ...DEFAULT_TESTNET_POLICY,
        x402: {
          ...DEFAULT_TESTNET_POLICY.x402,
          enabled: true,
          allowDomains: [new URL(server.url).host]
        }
      };
      const root = await mkdtemp(join(tmpdir(), "stellar-agent-mpp-session-"));
      await expect(
        runMppSession({
          url: server.url,
          source,
          policy,
          profile,
          receiptsDir: join(root, "receipts"),
          eventLog: join(root, "logs", "events.jsonl"),
          command: "test",
          requestCount: 2,
          dryRun: true
        })
      ).resolves.toMatchObject({
        firstStatus: 402,
        finalStatus: 402,
        requestCount: 2,
        policyDecision: { status: "allowed" }
      });
    } finally {
      await server.close();
    }
  });

  it("rejects malformed session proof headers without crashing the session demo server", async () => {
    const server = await startMppSessionDemo({ recipient });
    try {
      const response = await fetch(server.url, { headers: { "X-MPP-Session": "{" } });
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "invalid_mpp_session_proof"
      });
      expect(response.status).toBe(402);
    } finally {
      await server.close();
    }
  });

  it("binds issued MPP session IDs to one funded transaction", async () => {
    const server = await startMppSessionDemo({
      recipient,
      budget: "0.0000003",
      pricePerRequest: "0.0000001"
    });
    try {
      const session = await parseMppSessionRequirement(await fetch(server.url));
      const invented = proofForSession(session, "b".repeat(64), "invented_mpp_session");

      const inventedResponse = await fetch(server.url, {
        headers: { "X-MPP-Session": JSON.stringify(invented) }
      });
      expect(inventedResponse.status).toBe(402);
      await expect(inventedResponse.json()).resolves.toEqual({
        ok: false,
        error: "mpp_session_not_issued"
      });

      const proof = proofForSession(session, "c".repeat(64));
      const first = await fetch(server.url, {
        headers: { "X-MPP-Session": JSON.stringify(proof) }
      });
      expect(first.status).toBe(200);

      const secondSameSession = await fetch(server.url, {
        headers: { "X-MPP-Session": JSON.stringify(proof) }
      });
      expect(secondSameSession.status).toBe(200);

      const staleDifferentTransaction = await fetch(server.url, {
        headers: { "X-MPP-Session": JSON.stringify(proofForSession(session, "d".repeat(64))) }
      });
      expect(staleDifferentTransaction.status).toBe(402);
      await expect(staleDifferentTransaction.json()).resolves.toEqual({
        ok: false,
        error: "mpp_session_not_issued"
      });

      const nextSession = await parseMppSessionRequirement(await fetch(server.url));
      expect(nextSession.sessionId).not.toBe(session.sessionId);
      const next = await fetch(server.url, {
        headers: { "X-MPP-Session": JSON.stringify(proofForSession(nextSession, "e".repeat(64))) }
      });
      expect(next.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("rejects session requirements when only the resource query string differs", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-mpp-session-query-"));
    await expect(
      runMppSession({
        url: "http://api.example.test/mpp-session?item=expensive",
        source,
        policy: DEFAULT_TESTNET_POLICY,
        profile,
        receiptsDir: join(root, "receipts"),
        eventLog: join(root, "logs", "events.jsonl"),
        command: "test",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              protocol: "stellar-agent-local-mpp-session",
              version: 1,
              sessionId: "session_1",
              network: "testnet",
              asset: "XLM",
              budget: "0.0000003",
              pricePerRequest: "0.0000001",
              recipient,
              resource: "http://api.example.test/mpp-session?item=cheap"
            }),
            { status: 402 }
          )
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("normalizes unreachable MPP resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-mpp-"));
    await expect(
      runMppPayment({
        url: "http://127.0.0.1:1/mpp-report",
        source,
        policy: DEFAULT_TESTNET_POLICY,
        profile,
        receiptsDir: join(root, "receipts"),
        eventLog: join(root, "logs", "events.jsonl"),
        command: "test"
      })
    ).rejects.toMatchObject({ code: "MPP_RESOURCE_UNAVAILABLE" });
  });
});

function proofForCharge(charge: Awaited<ReturnType<typeof parseMppCharge>>, transactionHash: string, chargeId = charge.chargeId) {
  return {
    protocol: "stellar-agent-local-mpp",
    version: 1,
    chargeId,
    transactionHash,
    payer: source.publicKey,
    recipient,
    asset: charge.asset,
    amount: charge.amount,
    resource: charge.resource
  };
}

function proofForSession(session: Awaited<ReturnType<typeof parseMppSessionRequirement>>, transactionHash: string, sessionId = session.sessionId) {
  return {
    protocol: "stellar-agent-local-mpp-session",
    version: 1,
    sessionId,
    transactionHash,
    payer: source.publicKey,
    recipient,
    asset: session.asset,
    budget: session.budget,
    pricePerRequest: session.pricePerRequest,
    resource: session.resource
  };
}

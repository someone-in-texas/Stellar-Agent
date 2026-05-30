import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_TESTNET_POLICY } from "@stellar-agent/policy";
import {
  parseMppCharge,
  parseMppSessionRequirement,
  runMppPayment,
  runMppSession,
  startMppDemo,
  startMppSessionDemo
} from "../src/index.js";

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
      await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_mpp_payment_proof" });
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
      const proof = {
        protocol: "stellar-agent-local-mpp",
        version: 1,
        chargeId: charge.chargeId,
        transactionHash: "a".repeat(64),
        payer: source.publicKey,
        recipient,
        asset: charge.asset,
        amount: charge.amount,
        resource: charge.resource
      };

      const first = await fetch(server.url, { headers: { "X-MPP-Payment": JSON.stringify(proof) } });
      expect(first.status).toBe(200);

      const replay = await fetch(server.url, { headers: { "X-MPP-Payment": JSON.stringify(proof) } });
      expect(replay.status).toBe(402);
      await expect(replay.json()).resolves.toEqual({ ok: false, error: "mpp_payment_proof_replayed" });
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
      await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_mpp_session_proof" });
      expect(response.status).toBe(402);
    } finally {
      await server.close();
    }
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

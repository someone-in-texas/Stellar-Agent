import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseX402Requirement, runX402Payment, startPaidApiDemo } from "../src/index.js";
import { DEFAULT_TESTNET_POLICY } from "@stellar-agent/policy";

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

describe("x402 client", () => {
  it("parses payment requirements from 402 headers", async () => {
    const requirement = {
      protocol: "stellar-agent-local-x402",
      version: 1,
      network: "testnet",
      asset: "XLM",
      amount: "0.0000001",
      recipient,
      resource: "http://127.0.0.1/paid-report",
      nonce: "x402_req_1"
    };
    const response = new Response(JSON.stringify(requirement), {
      status: 402,
      headers: { "Payment-Required": JSON.stringify(requirement) }
    });
    await expect(parseX402Requirement(response)).resolves.toEqual(requirement);
  });

  it("runs a dry-run policy evaluation against the demo server", async () => {
    const server = await startPaidApiDemo({ recipient });
    try {
      const policy = {
        ...DEFAULT_TESTNET_POLICY,
        x402: {
          ...DEFAULT_TESTNET_POLICY.x402,
          enabled: true,
          allowDomains: [new URL(server.url).host]
        }
      };
      const root = await mkdtemp(join(tmpdir(), "stellar-agent-x402-"));
      await expect(
        runX402Payment({
          url: server.url,
          source,
          policy,
          profile: {
            name: "testnet",
            network: "testnet",
            networkPassphrase: "Test SDF Network ; September 2015",
            horizonUrl: "https://horizon-testnet.stellar.org",
            rpcUrl: "https://soroban-testnet.stellar.org",
            friendbotUrl: "https://friendbot.stellar.org",
            defaultAsset: "XLM",
            realFunds: false
          },
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
    const server = await startPaidApiDemo({ recipient });
    try {
      const response = await fetch(server.url, { headers: { "X-Payment": "{" } });
      await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_payment_proof" });
      expect(response.status).toBe(402);
    } finally {
      await server.close();
    }
  });

  it("rejects replayed one-time payment proofs", async () => {
    const server = await startPaidApiDemo({ recipient });
    try {
      const challenge = await fetch(server.url);
      const requirement = await parseX402Requirement(challenge);
      const proof = {
        protocol: "stellar-agent-local-x402",
        version: 1,
        transactionHash: "a".repeat(64),
        payer: source.publicKey,
        recipient,
        asset: requirement.asset,
        amount: requirement.amount,
        resource: requirement.resource,
        nonce: requirement.nonce
      };

      const first = await fetch(server.url, { headers: { "X-Payment": JSON.stringify(proof) } });
      expect(first.status).toBe(200);

      const replay = await fetch(server.url, { headers: { "X-Payment": JSON.stringify(proof) } });
      expect(replay.status).toBe(402);
      await expect(replay.json()).resolves.toEqual({ ok: false, error: "payment_proof_replayed" });
    } finally {
      await server.close();
    }
  });

  it("marks paid resource delivery false when retry fails after settlement", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-x402-delivery-"));
    const url = "http://api.example.test/paid-report";
    const policy = {
      ...DEFAULT_TESTNET_POLICY,
      x402: {
        ...DEFAULT_TESTNET_POLICY.x402,
        enabled: true,
        allowDomains: [new URL(url).host]
      }
    };
    let calls = 0;
    const result = await runX402Payment({
      url,
      source,
      policy,
      profile: {
        name: "testnet",
        network: "testnet",
        networkPassphrase: "Test SDF Network ; September 2015",
        horizonUrl: "https://horizon-testnet.stellar.org",
        rpcUrl: "https://soroban-testnet.stellar.org",
        friendbotUrl: "https://friendbot.stellar.org",
        defaultAsset: "XLM",
        realFunds: false
      },
      receiptsDir: join(root, "receipts"),
      eventLog: join(root, "logs", "events.jsonl"),
      command: "test",
      sendPaymentImpl: async () => ({ hash: "a".repeat(64), successful: true, ledger: 123 }),
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(
            JSON.stringify({
              protocol: "stellar-agent-local-x402",
              version: 1,
              network: "testnet",
              asset: "XLM",
              amount: "0.0000001",
              recipient,
              resource: url,
              nonce: "x402_req_1"
            }),
            { status: 402 }
          );
        }
        return new Response(JSON.stringify({ ok: false }), { status: 500 });
      }
    });

    expect(result).toMatchObject({
      finalStatus: 500,
      paidResourceDelivered: false,
      transaction: { hash: "a".repeat(64), successful: true },
      receiptPath: expect.any(String)
    });
  });

  it("rejects payment requirements for a different resource", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-x402-resource-"));
    await expect(
      runX402Payment({
        url: "http://api.example.test/paid-report",
        source,
        policy: DEFAULT_TESTNET_POLICY,
        profile: {
          name: "testnet",
          network: "testnet",
          networkPassphrase: "Test SDF Network ; September 2015",
          horizonUrl: "https://horizon-testnet.stellar.org",
          rpcUrl: "https://soroban-testnet.stellar.org",
          friendbotUrl: "https://friendbot.stellar.org",
          defaultAsset: "XLM",
          realFunds: false
        },
        receiptsDir: join(root, "receipts"),
        eventLog: join(root, "logs", "events.jsonl"),
        command: "test",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              protocol: "stellar-agent-local-x402",
              version: 1,
              network: "testnet",
              asset: "XLM",
              amount: "0.0000001",
              recipient,
              resource: "http://other.example.test/paid-report",
              nonce: "x402_req_1"
            }),
            { status: 402 }
          )
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects payment requirements when only the resource query string differs", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-x402-resource-query-"));
    await expect(
      runX402Payment({
        url: "http://api.example.test/paid-report?item=expensive",
        source,
        policy: DEFAULT_TESTNET_POLICY,
        profile: {
          name: "testnet",
          network: "testnet",
          networkPassphrase: "Test SDF Network ; September 2015",
          horizonUrl: "https://horizon-testnet.stellar.org",
          rpcUrl: "https://soroban-testnet.stellar.org",
          friendbotUrl: "https://friendbot.stellar.org",
          defaultAsset: "XLM",
          realFunds: false
        },
        receiptsDir: join(root, "receipts"),
        eventLog: join(root, "logs", "events.jsonl"),
        command: "test",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              protocol: "stellar-agent-local-x402",
              version: 1,
              network: "testnet",
              asset: "XLM",
              amount: "0.0000001",
              recipient,
              resource: "http://api.example.test/paid-report?item=cheap",
              nonce: "x402_req_1"
            }),
            { status: 402 }
          )
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("normalizes unreachable x402 resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-x402-"));
    await expect(
      runX402Payment({
        url: "http://127.0.0.1:1/paid-report",
        source,
        policy: DEFAULT_TESTNET_POLICY,
        profile: {
          name: "testnet",
          network: "testnet",
          networkPassphrase: "Test SDF Network ; September 2015",
          horizonUrl: "https://horizon-testnet.stellar.org",
          rpcUrl: "https://soroban-testnet.stellar.org",
          friendbotUrl: "https://friendbot.stellar.org",
          defaultAsset: "XLM",
          realFunds: false
        },
        receiptsDir: join(root, "receipts"),
        eventLog: join(root, "logs", "events.jsonl"),
        command: "test"
      })
    ).rejects.toMatchObject({ code: "X402_RESOURCE_UNAVAILABLE" });
  });
});

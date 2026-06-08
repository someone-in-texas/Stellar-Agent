import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseX402Requirement } from "@stellar-agent/x402-client";
import { DEFAULT_TESTNET_POLICY } from "@stellar-agent/policy";
import { payForResource } from "../src/client.js";
import { startX402PaidApi } from "../src/server.js";

const recipient = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("examples/x402-paid-api", () => {
  it("serves a free endpoint without payment", async () => {
    const server = await startX402PaidApi({ recipient });
    try {
      const response = await fetch(`${server.baseUrl}/free`);
      await expect(response.json()).resolves.toMatchObject({ ok: true, tier: "free" });
      expect(response.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("returns a 402 payment requirement for the paid endpoint", async () => {
    const server = await startX402PaidApi({ recipient, amount: "0.0000002" });
    try {
      const response = await fetch(server.paidUrl);
      const requirement = await parseX402Requirement(response);
      expect(response.status).toBe(402);
      expect(requirement).toMatchObject({
        protocol: "stellar-agent-local-x402",
        network: "testnet",
        recipient,
        amount: "0.0000002",
        resource: server.paidUrl
      });
    } finally {
      await server.close();
    }
  });

  it("returns JSON errors for malformed payment proofs", async () => {
    const server = await startX402PaidApi({ recipient });
    try {
      const response = await fetch(server.paidUrl, { headers: { "X-Payment": "{" } });
      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_payment_proof" });
    } finally {
      await server.close();
    }
  });

  it("denies paid requests when client policy does not allow the domain", async () => {
    const server = await startX402PaidApi({ recipient });
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-x402-denied-"));
    try {
      await expect(
        payForResource({
          url: server.paidUrl,
          rootDir: root,
          policy: {
            ...DEFAULT_TESTNET_POLICY,
            x402: { ...DEFAULT_TESTNET_POLICY.x402, enabled: true, allowDomains: ["other.example.test"] }
          }
        })
      ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    } finally {
      await server.close();
    }
  });

  it("completes the paid request and writes a receipt with mocked Testnet settlement", async () => {
    const server = await startX402PaidApi({ recipient });
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-x402-success-"));
    try {
      const { result, latestReceipt } = await payForResource({ url: server.paidUrl, rootDir: root });
      expect(result).toMatchObject({
        firstStatus: 402,
        finalStatus: 200,
        policyDecision: { status: "allowed" },
        paidResourceDelivered: true,
        transaction: { hash: "x402".padEnd(64, "0"), successful: true }
      });
      expect(result.responseBody).toContain("Premium Testnet signal");
      expect(result.receiptPath).toBeDefined();
      expect(latestReceipt?.receipt).toMatchObject({
        command: "examples/x402-paid-api client",
        profile: "testnet",
        network: { realFunds: false },
        payment: { destination: recipient, domain: new URL(server.paidUrl).host },
        policyDecision: { status: "allowed" },
        redactions: { secretKeysIncluded: false }
      });
      const receiptText = await readFile(result.receiptPath!, "utf8");
      expect(receiptText).not.toContain("SAAAAAAAA");
    } finally {
      await server.close();
    }
  });
});

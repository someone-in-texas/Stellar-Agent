import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_TESTNET_POLICY } from "@stellar-agent/policy";
import { parseX402Requirement } from "@stellar-agent/x402-client";
import { buyDiscoveredService, buyerPolicyForService, discoverSellerServices } from "../src/buyer.js";
import { startSellerService } from "../src/seller.js";

const recipient = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("examples/agent-service-market", () => {
  it("supports seller service discovery", async () => {
    const seller = await startSellerService({ recipient });
    try {
      const directory = await discoverSellerServices(seller.directoryUrl);
      expect(directory).toMatchObject({
        seller: { name: "tiny-seller-agent" },
        services: [
          {
            id: "premium-summary",
            protocol: "x402",
            endpoint: seller.serviceUrl,
            price: "0.0000002",
            network: "testnet",
            recipient
          }
        ]
      });
    } finally {
      await seller.close();
    }
  });

  it("negotiates a 402 payment requirement for the paid service", async () => {
    const seller = await startSellerService({ recipient, price: "0.0000003" });
    try {
      const response = await fetch(seller.serviceUrl);
      const requirement = await parseX402Requirement(response);
      expect(response.status).toBe(402);
      expect(requirement).toMatchObject({
        recipient,
        amount: "0.0000003",
        resource: seller.serviceUrl,
        network: "testnet"
      });
    } finally {
      await seller.close();
    }
  });

  it("denies buyer payment when policy does not allow the seller domain", async () => {
    const seller = await startSellerService({ recipient });
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-market-denied-"));
    try {
      await expect(
        buyDiscoveredService({
          directoryUrl: seller.directoryUrl,
          rootDir: root,
          policy: {
            ...DEFAULT_TESTNET_POLICY,
            x402: { ...DEFAULT_TESTNET_POLICY.x402, enabled: true, allowDomains: ["other.example.test"] }
          }
        })
      ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    } finally {
      await seller.close();
    }
  });

  it("buys the discovered service and writes a receipt", async () => {
    const seller = await startSellerService({ recipient });
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-market-success-"));
    try {
      const result = await buyDiscoveredService({ directoryUrl: seller.directoryUrl, rootDir: root });
      expect(result.result).toMatchObject({
        firstStatus: 402,
        finalStatus: 200,
        policyDecision: { status: "allowed" },
        paidResourceDelivered: true,
        transaction: { hash: "market".padEnd(64, "0"), successful: true }
      });
      expect(result.result.responseBody).toContain("Seller agent premium summary");
      expect(result.latestReceipt?.receipt).toMatchObject({
        command: "examples/agent-service-market buyer",
        profile: "testnet",
        network: { realFunds: false },
        payment: {
          destination: recipient,
          domain: new URL(seller.serviceUrl).host,
          url: seller.serviceUrl
        },
        policyDecision: { status: "allowed" }
      });
    } finally {
      await seller.close();
    }
  });

  it("refuses spend cap exhaustion before paying", async () => {
    const seller = await startSellerService({ recipient, price: "0.0000002" });
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-market-cap-"));
    try {
      const directory = await discoverSellerServices(seller.directoryUrl);
      const service = directory.services[0]!;
      await expect(
        buyDiscoveredService({
          directoryUrl: seller.directoryUrl,
          rootDir: root,
          policy: buyerPolicyForService(service, {
            limits: { ...DEFAULT_TESTNET_POLICY.limits, dailyTotal: "0.0000003 XLM" }
          }),
          spendHistory: { dailyTotal: "0.0000002" }
        })
      ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    } finally {
      await seller.close();
    }
  });

  it("surfaces seller-side verification failure after mocked settlement", async () => {
    const seller = await startSellerService({ recipient, forceVerificationFailure: true });
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-market-seller-fail-"));
    try {
      const result = await buyDiscoveredService({ directoryUrl: seller.directoryUrl, rootDir: root });
      expect(result.result).toMatchObject({
        firstStatus: 402,
        finalStatus: 402,
        paidResourceDelivered: false,
        transaction: { successful: true },
        receiptPath: expect.any(String)
      });
      expect(result.result.responseBody).toContain("seller_verification_failed");
      expect(result.latestReceipt?.receipt.transaction.successful).toBe(true);
    } finally {
      await seller.close();
    }
  });
});

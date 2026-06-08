import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_TESTNET_POLICY } from "@stellar-agent/policy";
import { parseX402Requirement } from "@stellar-agent/x402-client";
import { buyDiscoveredService, buyerPolicyForService, discoverSellerServices } from "../src/buyer.js";
import { loadMarketEnv, startSellerService } from "../src/seller.js";

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
        transaction: { successful: true }
      });
      expect(result.result.transaction?.hash).toMatch(/^[a-f0-9]{64}$/);
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

  it("uses fresh mock transaction hashes for repeated buyer runs against one seller", async () => {
    const seller = await startSellerService({ recipient });
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-market-repeat-"));
    try {
      const first = await buyDiscoveredService({ directoryUrl: seller.directoryUrl, rootDir: root });
      const second = await buyDiscoveredService({ directoryUrl: seller.directoryUrl, rootDir: root });
      expect(first.result.finalStatus).toBe(200);
      expect(second.result.finalStatus).toBe(200);
      expect(first.result.transaction?.hash).not.toBe(second.result.transaction?.hash);
    } finally {
      await seller.close();
    }
  });

  it("rejects service proofs with invented or stale nonces", async () => {
    const seller = await startSellerService({ recipient });
    try {
      const challenge = await fetch(seller.serviceUrl);
      const requirement = await parseX402Requirement(challenge);
      const invented = proofForRequirement(requirement, "1".repeat(64), "invented_market_nonce");

      const inventedResponse = await fetch(seller.serviceUrl, { headers: { "X-Payment": JSON.stringify(invented) } });
      expect(inventedResponse.status).toBe(402);
      await expect(inventedResponse.json()).resolves.toEqual({ ok: false, error: "payment_nonce_not_issued" });

      const valid = await fetch(seller.serviceUrl, {
        headers: { "X-Payment": JSON.stringify(proofForRequirement(requirement, "2".repeat(64))) }
      });
      expect(valid.status).toBe(200);

      const stale = await fetch(seller.serviceUrl, {
        headers: { "X-Payment": JSON.stringify(proofForRequirement(requirement, "3".repeat(64))) }
      });
      expect(stale.status).toBe(402);
      await expect(stale.json()).resolves.toEqual({ ok: false, error: "payment_nonce_not_issued" });
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

  it("loads copied .env values before seller or buyer scripts read settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-market-env-"));
    const envPath = join(root, ".env");
    const previous = {
      PORT: process.env.PORT,
      SELLER_RECIPIENT: process.env.SELLER_RECIPIENT,
      SERVICE_PRICE: process.env.SERVICE_PRICE,
      SERVICE_ASSET: process.env.SERVICE_ASSET,
      STELLAR_AGENT_MARKET_ROOT: process.env.STELLAR_AGENT_MARKET_ROOT
    };
    for (const key of Object.keys(previous)) delete process.env[key];
    await writeFile(
      envPath,
      [
        "PORT=8799",
        `SELLER_RECIPIENT=${recipient}`,
        "SERVICE_PRICE=0.0000004",
        "SERVICE_ASSET=XLM",
        "STELLAR_AGENT_MARKET_ROOT=.tmp-agent-market"
      ].join("\n")
    );

    try {
      loadMarketEnv(envPath);
      expect(process.env.PORT).toBe("8799");
      expect(process.env.SELLER_RECIPIENT).toBe(recipient);
      expect(process.env.SERVICE_PRICE).toBe("0.0000004");
      expect(process.env.SERVICE_ASSET).toBe("XLM");
      expect(process.env.STELLAR_AGENT_MARKET_ROOT).toBe(".tmp-agent-market");
    } finally {
      restoreEnv(previous);
    }
  });
});

function proofForRequirement(
  requirement: Awaited<ReturnType<typeof parseX402Requirement>>,
  transactionHash: string,
  nonce = requirement.nonce
) {
  return {
    protocol: "stellar-agent-local-x402",
    version: 1,
    transactionHash,
    payer: "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    recipient: requirement.recipient,
    asset: requirement.asset,
    amount: requirement.amount,
    resource: requirement.resource,
    nonce
  };
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

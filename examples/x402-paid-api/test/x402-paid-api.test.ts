import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { parseX402Requirement } from "@stellar-agent/x402-client";
import { DEFAULT_TESTNET_POLICY } from "@stellar-agent/policy";
import { payForResource } from "../src/client.js";
import { loadExampleEnv, startX402PaidApi } from "../src/server.js";

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
        transaction: { successful: true }
      });
      expect(result.transaction?.hash).toMatch(/^[a-f0-9]{64}$/);
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

  it("uses a fresh mock transaction hash for repeated client runs against one server", async () => {
    const server = await startX402PaidApi({ recipient });
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-x402-repeat-"));
    try {
      const first = await payForResource({ url: server.paidUrl, rootDir: root });
      const second = await payForResource({ url: server.paidUrl, rootDir: root });
      expect(first.result.finalStatus).toBe(200);
      expect(second.result.finalStatus).toBe(200);
      expect(first.result.transaction?.hash).not.toBe(second.result.transaction?.hash);
    } finally {
      await server.close();
    }
  });

  it("rejects proofs with stale or invented nonces", async () => {
    const server = await startX402PaidApi({ recipient });
    try {
      const challenge = await fetch(server.paidUrl);
      const requirement = await parseX402Requirement(challenge);
      const proof = {
        protocol: "stellar-agent-local-x402",
        version: 1,
        transactionHash: "a".repeat(64),
        payer: "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        recipient: requirement.recipient,
        asset: requirement.asset,
        amount: requirement.amount,
        resource: requirement.resource,
        nonce: "invented_nonce"
      };

      const response = await fetch(server.paidUrl, { headers: { "X-Payment": JSON.stringify(proof) } });
      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toEqual({ ok: false, error: "payment_nonce_not_issued" });

      const valid = await fetch(server.paidUrl, {
        headers: { "X-Payment": JSON.stringify(proofForRequirement(requirement, "c".repeat(64))) }
      });
      expect(valid.status).toBe(200);

      const staleNonce = await fetch(server.paidUrl, {
        headers: { "X-Payment": JSON.stringify(proofForRequirement(requirement, "d".repeat(64))) }
      });
      expect(staleNonce.status).toBe(402);
      await expect(staleNonce.json()).resolves.toEqual({ ok: false, error: "payment_nonce_not_issued" });
    } finally {
      await server.close();
    }
  });

  it("records facilitator-approved hashes as spent", async () => {
    const facilitator = createServer((_request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve, reject) => {
      facilitator.once("error", reject);
      facilitator.listen(0, "127.0.0.1", () => resolve());
    });
    const facilitatorAddress = facilitator.address();
    const facilitatorUrl = `http://127.0.0.1:${typeof facilitatorAddress === "object" && facilitatorAddress ? facilitatorAddress.port : 0}`;
    const server = await startX402PaidApi({ recipient, verificationMode: "facilitator", facilitatorUrl });
    try {
      const firstChallenge = await fetch(server.paidUrl);
      const firstRequirement = await parseX402Requirement(firstChallenge);
      const transactionHash = "b".repeat(64);
      const firstProof = proofForRequirement(firstRequirement, transactionHash);
      const first = await fetch(server.paidUrl, { headers: { "X-Payment": JSON.stringify(firstProof) } });
      expect(first.status).toBe(200);

      const secondChallenge = await fetch(server.paidUrl);
      const secondRequirement = await parseX402Requirement(secondChallenge);
      const replayWithFreshNonce = proofForRequirement(secondRequirement, transactionHash);
      const replay = await fetch(server.paidUrl, { headers: { "X-Payment": JSON.stringify(replayWithFreshNonce) } });
      expect(replay.status).toBe(402);
      await expect(replay.json()).resolves.toEqual({ ok: false, error: "payment_proof_replayed" });
    } finally {
      await server.close();
      await new Promise<void>((resolve, reject) => {
        facilitator.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("loads copied .env values before server startup reads settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-x402-env-"));
    const envPath = join(root, ".env");
    const previous = {
      X402_PRICE: process.env.X402_PRICE,
      X402_RECIPIENT: process.env.X402_RECIPIENT,
      X402_VERIFICATION_MODE: process.env.X402_VERIFICATION_MODE,
      STELLAR_AGENT_EXAMPLE_ROOT: process.env.STELLAR_AGENT_EXAMPLE_ROOT,
      PORT: process.env.PORT
    };
    delete process.env.X402_PRICE;
    delete process.env.X402_RECIPIENT;
    delete process.env.X402_VERIFICATION_MODE;
    delete process.env.STELLAR_AGENT_EXAMPLE_ROOT;
    delete process.env.PORT;
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        envPath,
        [
          "X402_PRICE=0.0000003",
          "X402_RECIPIENT=GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWHF",
          "X402_VERIFICATION_MODE=facilitator",
          "STELLAR_AGENT_EXAMPLE_ROOT=.tmp-x402-example",
          "PORT=8788"
        ].join("\n")
      )
    );
    try {
      loadExampleEnv(envPath);
      expect(process.env.X402_PRICE).toBe("0.0000003");
      expect(process.env.X402_RECIPIENT).toBe("GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWHF");
      expect(process.env.X402_VERIFICATION_MODE).toBe("facilitator");
      expect(process.env.STELLAR_AGENT_EXAMPLE_ROOT).toBe(".tmp-x402-example");
      expect(process.env.PORT).toBe("8788");
    } finally {
      restoreEnv(previous);
    }
  });
});

function proofForRequirement(requirement: Awaited<ReturnType<typeof parseX402Requirement>>, transactionHash: string) {
  return {
    protocol: "stellar-agent-local-x402",
    version: 1,
    transactionHash,
    payer: "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    recipient: requirement.recipient,
    asset: requirement.asset,
    amount: requirement.amount,
    resource: requirement.resource,
    nonce: requirement.nonce
  };
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

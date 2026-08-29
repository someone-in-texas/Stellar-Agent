import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadX402PaymentFromHorizon, parseX402Requirement, runX402Payment, startPaidApiDemo, verifyWithX402Facilitator, verifyX402PaymentProof, x402ChallengeMemo } from "../src/index.js";
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
  it("pins facilitator settlements and rejects replayed proofs atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-x402-facilitator-"));
    const proof = {
      protocol: "stellar-agent-local-x402" as const,
      version: 1 as const,
      transactionHash: "a".repeat(64),
      payer: source.publicKey,
      recipient,
      asset: "XLM",
      amount: "0.0000001",
      resource: "https://merchant.example/report",
      nonce: "nonce_1"
    };
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          protocol: "stellar-agent-facilitated-x402",
          version: 1,
          verified: true,
          transactionHash: proof.transactionHash,
          networkPassphraseHash: "network_hash",
          recipient,
          asset: "XLM",
          amount: "0.0000001",
          challengeId: "challenge_1",
          ledger: 123
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const args = {
      facilitator: {
        protocol: "stellar-agent-facilitated-x402" as const,
        version: 1 as const,
        url: "https://facilitator.example",
        networkPassphraseHash: "network_hash"
      },
      proof,
      challengeId: "challenge_1",
      replayStorePath: join(root, "replays.json"),
      fetchImpl: fetchImpl as typeof fetch
    };
    await expect(verifyWithX402Facilitator(args)).resolves.toMatchObject({
      verified: true,
      ledger: 123
    });
    await expect(verifyWithX402Facilitator(args)).rejects.toThrow("already been accepted");
  });

  it("rejects insecure remote facilitators and mismatched settlements", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-x402-facilitator-"));
    const proof = {
      protocol: "stellar-agent-local-x402" as const,
      version: 1 as const,
      transactionHash: "b".repeat(64),
      payer: source.publicKey,
      recipient,
      asset: "XLM",
      amount: "0.0000001",
      resource: "https://merchant.example/report",
      nonce: "nonce_2"
    };
    await expect(
      verifyWithX402Facilitator({
        facilitator: {
          protocol: "stellar-agent-facilitated-x402",
          version: 1,
          url: "http://facilitator.example",
          networkPassphraseHash: "network_hash"
        },
        proof,
        challengeId: "challenge_2",
        replayStorePath: join(root, "replays.json")
      })
    ).rejects.toThrow("must use HTTPS");
    await expect(
      verifyWithX402Facilitator({
        facilitator: {
          protocol: "stellar-agent-facilitated-x402",
          version: 1,
          url: "https://facilitator.example",
          networkPassphraseHash: "network_hash"
        },
        proof,
        challengeId: "challenge_2",
        replayStorePath: join(root, "replays.json"),
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              protocol: "stellar-agent-facilitated-x402",
              version: 1,
              verified: true,
              transactionHash: "c".repeat(64),
              networkPassphraseHash: "network_hash",
              recipient,
              asset: "XLM",
              amount: "0.0000001",
              challengeId: "challenge_2"
            }),
            { status: 200 }
          )) as typeof fetch
      })
    ).rejects.toThrow("does not match");
  });

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
    await expect(parseX402Requirement(response)).resolves.toEqual({
      ...requirement,
      memo: x402ChallengeMemo(requirement)
    });
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
      const proof = proofForRequirement(requirement, "a".repeat(64));

      const first = await fetch(server.url, { headers: { "X-Payment": JSON.stringify(proof) } });
      expect(first.status).toBe(200);

      const replay = await fetch(server.url, { headers: { "X-Payment": JSON.stringify(proof) } });
      expect(replay.status).toBe(402);
      await expect(replay.json()).resolves.toEqual({ ok: false, error: "payment_proof_replayed" });
    } finally {
      await server.close();
    }
  });

  it("verifies x402 proofs against loaded Stellar payment evidence", async () => {
    const requirement = {
      protocol: "stellar-agent-local-x402" as const,
      version: 1 as const,
      network: "testnet" as const,
      asset: "XLM",
      amount: "0.0000001",
      recipient,
      resource: "http://127.0.0.1/paid-report",
      nonce: "x402_req_1",
      issuedAt: new Date("2026-06-08T12:00:00.000Z").toISOString()
    };
    const proof = proofForRequirement(requirement, "a".repeat(64));
    const acceptedTransactions = new Set<string>();

    const verification = await verifyX402PaymentProof({
      proof,
      requirement,
      acceptedTransactions,
      now: new Date("2026-06-08T12:01:00.000Z"),
      loadPayment: async () => ({
        transactionHash: proof.transactionHash,
        successful: true,
        ledger: 123,
        createdAt: "2026-06-08T12:00:20.000Z",
        memo: x402ChallengeMemo(requirement),
        operations: [
          {
            source: proof.payer,
            destination: requirement.recipient,
            asset: requirement.asset,
            amount: requirement.amount
          }
        ]
      })
    });

    expect(verification).toMatchObject({
      ok: true,
      settlement: {
        mode: "horizon",
        transactionHash: proof.transactionHash,
        operation: {
          source: proof.payer,
          destination: requirement.recipient,
          amount: requirement.amount,
          asset: requirement.asset
        }
      }
    });
    expect(acceptedTransactions.has(proof.transactionHash)).toBe(true);

    await expect(
      verifyX402PaymentProof({
        proof,
        requirement,
        acceptedTransactions,
        now: new Date("2026-06-08T12:01:00.000Z"),
        loadPayment: async () => null
      })
    ).resolves.toEqual({ ok: false, error: "payment_proof_replayed" });
  });

  it("rejects Stellar payment evidence bound to an older x402 challenge", async () => {
    const oldRequirement = {
      protocol: "stellar-agent-local-x402" as const,
      version: 1 as const,
      network: "testnet" as const,
      asset: "XLM",
      amount: "0.0000001",
      recipient,
      resource: "http://127.0.0.1/paid-report",
      nonce: "x402_req_old",
      issuedAt: new Date("2026-06-08T12:00:00.000Z").toISOString()
    };
    const freshRequirement = {
      ...oldRequirement,
      nonce: "x402_req_fresh",
      issuedAt: new Date("2026-06-08T12:01:00.000Z").toISOString()
    };
    const proof = proofForRequirement(freshRequirement, "f".repeat(64));

    await expect(
      verifyX402PaymentProof({
        proof,
        requirement: freshRequirement,
        now: new Date("2026-06-08T12:01:30.000Z"),
        loadPayment: async () => ({
          transactionHash: proof.transactionHash,
          successful: true,
          ledger: 124,
          memo: x402ChallengeMemo(oldRequirement),
          operations: [
            {
              source: proof.payer,
              destination: freshRequirement.recipient,
              asset: freshRequirement.asset,
              amount: freshRequirement.amount
            }
          ]
        })
      })
    ).resolves.toEqual({ ok: false, error: "payment_operation_mismatch" });
  });

  it("treats malformed proof amounts as invalid x402 proofs", async () => {
    const requirement = {
      protocol: "stellar-agent-local-x402" as const,
      version: 1 as const,
      network: "testnet" as const,
      asset: "XLM",
      amount: "0.0000001",
      recipient,
      resource: "http://127.0.0.1/paid-report",
      nonce: "x402_req_1",
      issuedAt: new Date("2026-06-08T12:00:00.000Z").toISOString()
    };
    const proof = { ...proofForRequirement(requirement, "9".repeat(64)), amount: "not-an-amount" };

    await expect(
      verifyX402PaymentProof({
        proof,
        requirement,
        now: new Date("2026-06-08T12:01:00.000Z"),
        loadPayment: async () => null
      })
    ).resolves.toEqual({ ok: false, error: "invalid_payment_proof" });
  });

  it("rejects x402 proofs when Stellar payment evidence does not match", async () => {
    const requirement = {
      protocol: "stellar-agent-local-x402" as const,
      version: 1 as const,
      network: "testnet" as const,
      asset: "XLM",
      amount: "0.0000001",
      recipient,
      resource: "http://127.0.0.1/paid-report",
      nonce: "x402_req_1",
      issuedAt: new Date("2026-06-08T12:00:00.000Z").toISOString()
    };
    const proof = proofForRequirement(requirement, "b".repeat(64));

    await expect(
      verifyX402PaymentProof({
        proof,
        requirement,
        now: new Date("2026-06-08T12:01:00.000Z"),
        loadPayment: async () => ({
          transactionHash: proof.transactionHash,
          successful: true,
          operations: [
            {
              source: proof.payer,
              destination: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWHF",
              asset: requirement.asset,
              amount: requirement.amount
            }
          ]
        })
      })
    ).resolves.toEqual({ ok: false, error: "payment_operation_mismatch" });
  });

  it("rejects expired x402 payment requirements", async () => {
    const requirement = {
      protocol: "stellar-agent-local-x402" as const,
      version: 1 as const,
      network: "testnet" as const,
      asset: "XLM",
      amount: "0.0000001",
      recipient,
      resource: "http://127.0.0.1/paid-report",
      nonce: "x402_req_1",
      issuedAt: new Date("2026-06-08T12:00:00.000Z").toISOString(),
      expiresAt: new Date("2026-06-08T12:02:00.000Z").toISOString()
    };

    await expect(
      verifyX402PaymentProof({
        proof: proofForRequirement(requirement, "c".repeat(64)),
        requirement,
        now: new Date("2026-06-08T12:03:00.000Z"),
        loadPayment: async () => null
      })
    ).resolves.toEqual({ ok: false, error: "payment_nonce_expired" });
  });

  it("loads matching payment operations from Horizon transaction records", async () => {
    const transactionHash = "d".repeat(64);
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith(`/transactions/${transactionHash}`)) {
        return new Response(
          JSON.stringify({
            hash: transactionHash,
            successful: true,
            ledger: 321,
            created_at: "2026-06-08T12:00:00Z",
            memo: "x402:test-memo"
          })
        );
      }
      if (href.endsWith(`/transactions/${transactionHash}/operations?limit=200`)) {
        return new Response(
          JSON.stringify({
            _embedded: {
              records: [
                {
                  type: "payment",
                  from: source.publicKey,
                  to: recipient,
                  asset_type: "native",
                  amount: "0.0000001"
                }
              ]
            }
          })
        );
      }
      return new Response("not found", { status: 404 });
    };

    await expect(
      loadX402PaymentFromHorizon({
        transactionHash,
        horizonUrl: "https://horizon-testnet.example",
        fetchImpl: fetchImpl as typeof fetch
      })
    ).resolves.toMatchObject({
      transactionHash,
      successful: true,
      ledger: 321,
      memo: "x402:test-memo",
      operations: [{ source: source.publicKey, destination: recipient, asset: "XLM", amount: "0.0000001" }]
    });
  });

  it("treats unavailable Horizon settlement evidence as verification failure", async () => {
    await expect(
      loadX402PaymentFromHorizon({
        transactionHash: "e".repeat(64),
        horizonUrl: "https://horizon-testnet.example",
        fetchImpl: (async () => {
          throw new Error("network unavailable");
        }) as typeof fetch
      })
    ).resolves.toBeNull();
  });

  it("issues one x402 nonce per paid challenge", async () => {
    const server = await startPaidApiDemo({ recipient });
    try {
      const firstChallenge = await fetch(server.url);
      const firstRequirement = await parseX402Requirement(firstChallenge);
      const invented = proofForRequirement(firstRequirement, "b".repeat(64), "invented_x402_nonce");

      const inventedResponse = await fetch(server.url, {
        headers: { "X-Payment": JSON.stringify(invented) }
      });
      expect(inventedResponse.status).toBe(402);
      await expect(inventedResponse.json()).resolves.toEqual({
        ok: false,
        error: "payment_nonce_not_issued"
      });

      const first = await fetch(server.url, {
        headers: {
          "X-Payment": JSON.stringify(proofForRequirement(firstRequirement, "c".repeat(64)))
        }
      });
      expect(first.status).toBe(200);

      const stale = await fetch(server.url, {
        headers: {
          "X-Payment": JSON.stringify(proofForRequirement(firstRequirement, "d".repeat(64)))
        }
      });
      expect(stale.status).toBe(402);
      await expect(stale.json()).resolves.toEqual({ ok: false, error: "payment_nonce_not_issued" });

      const secondRequirement = await parseX402Requirement(await fetch(server.url));
      expect(secondRequirement.nonce).not.toBe(firstRequirement.nonce);
      const second = await fetch(server.url, {
        headers: {
          "X-Payment": JSON.stringify(proofForRequirement(secondRequirement, "e".repeat(64)))
        }
      });
      expect(second.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("returns a 402 JSON error for issued proofs with malformed amounts", async () => {
    const server = await startPaidApiDemo({ recipient });
    try {
      const challenge = await fetch(server.url);
      const requirement = await parseX402Requirement(challenge);
      const proof = { ...proofForRequirement(requirement, "1".repeat(64)), amount: "bad-amount" };

      const response = await fetch(server.url, { headers: { "X-Payment": JSON.stringify(proof) } });
      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_payment_proof" });
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
      intentsDir: join(root, "intents"),
      idempotencyKey: "delivery-failure-job",
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
      intent: { status: "confirmed", receiptPath: expect.any(String) },
      transaction: { hash: "a".repeat(64), successful: true },
      receiptPath: expect.any(String)
    });
  });

  it("treats fresh challenge nonces as the same idempotent payment job without pretending delivery", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-x402-idempotent-"));
    const url = "https://merchant.example/report";
    const policy = { ...DEFAULT_TESTNET_POLICY, x402: { ...DEFAULT_TESTNET_POLICY.x402, enabled: true, allowDomains: [new URL(url).host] } };
    let challenge = 0;
    let sends = 0;
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const invoke = () => runX402Payment({
      url, source, policy, profile: { name: "testnet", network: "testnet", networkPassphrase: "Test SDF Network ; September 2015", horizonUrl: "https://horizon-testnet.stellar.org", rpcUrl: "https://soroban-testnet.stellar.org", friendbotUrl: "https://friendbot.stellar.org", defaultAsset: "XLM", realFunds: false },
      receiptsDir: join(root, "receipts"), eventLog: join(root, "events.jsonl"), intentsDir: join(root, "intents"), idempotencyKey: "stable-job", command: "test",
      sendPaymentImpl: async () => { sends += 1; return { hash: "b".repeat(64), successful: true, ledger: 456 }; },
      fetchImpl: async (_input, init) => {
        redirectModes.push(init?.redirect);
        if (init?.headers) return new Response("delivered", { status: 200 });
        challenge += 1;
        return new Response(JSON.stringify({ protocol: "stellar-agent-local-x402", version: 1, network: "testnet", asset: "XLM", amount: "0.0000001", recipient, resource: url, nonce: `nonce_${challenge}` }), { status: 402 });
      }
    });
    await expect(invoke()).resolves.toMatchObject({ finalStatus: 200, paidResourceDelivered: true });
    await expect(invoke()).resolves.toMatchObject({ finalStatus: 402, paidResourceDelivered: false, intent: { status: "confirmed" } });
    expect(sends).toBe(1);
    expect(redirectModes.every((mode) => mode === "error")).toBe(true);
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

function proofForRequirement(requirement: Awaited<ReturnType<typeof parseX402Requirement>>, transactionHash: string, nonce = requirement.nonce) {
  return {
    protocol: "stellar-agent-local-x402",
    version: 1,
    transactionHash,
    payer: source.publicKey,
    recipient,
    asset: requirement.asset,
    amount: requirement.amount,
    resource: requirement.resource,
    nonce
  };
}

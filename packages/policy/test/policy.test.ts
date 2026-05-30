import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAINNET_POLICY,
  DEFAULT_TESTNET_POLICY,
  evaluatePaymentRequest,
  parsePolicyYaml,
  policyToYaml
} from "../src/index.js";

const destination = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("policy evaluation", () => {
  it("allows a small Testnet XLM payment", () => {
    const decision = evaluatePaymentRequest(DEFAULT_TESTNET_POLICY, {
      destination,
      amount: "1",
      asset: "XLM",
      network: "testnet"
    });
    expect(decision.status).toBe("allowed");
    expect(decision.matchedRules).toContain("policy_allowed");
  });

  it("denies payments over the hard per-transaction limit", () => {
    const decision = evaluatePaymentRequest(DEFAULT_TESTNET_POLICY, {
      destination,
      amount: "11",
      asset: "XLM",
      network: "testnet"
    });
    expect(decision.status).toBe("denied");
    expect(decision.matchedRules).toContain("amount_over_per_transaction_limit");
  });

  it("requires approval over the auto-approval threshold", () => {
    const decision = evaluatePaymentRequest(DEFAULT_TESTNET_POLICY, {
      destination,
      amount: "6",
      asset: "XLM",
      network: "testnet"
    });
    expect(decision.status).toBe("requires_approval");
    expect(decision.approval?.reason).toBe("amount_above_auto_approval_threshold");
  });

  it("keeps Mainnet approval-required by default", () => {
    const decision = evaluatePaymentRequest(DEFAULT_MAINNET_POLICY, {
      destination,
      amount: "0.01",
      asset: "XLM",
      network: "mainnet"
    });
    expect(decision.realFunds).toBe(true);
    expect(decision.status).toBe("requires_approval");
    expect(decision.matchedRules).toContain("mainnet_requires_approval");
  });

  it("fails closed when spend history is unreadable", () => {
    const decision = evaluatePaymentRequest(
      DEFAULT_TESTNET_POLICY,
      { destination, amount: "1", asset: "XLM", network: "testnet" },
      { unreadable: true }
    );
    expect(decision.status).toBe("denied");
    expect(decision.matchedRules).toContain("spend_history_unreadable");
  });

  it("allows domain-bound x402 requests only when enabled and under price limit", () => {
    const policy = {
      ...DEFAULT_TESTNET_POLICY,
      x402: {
        ...DEFAULT_TESTNET_POLICY.x402,
        enabled: true,
        allowDomains: ["127.0.0.1:3000"],
        maxPricePerRequest: "0.01 XLM"
      }
    };
    expect(
      evaluatePaymentRequest(policy, {
        destination,
        amount: "0.001",
        asset: "XLM",
        network: "testnet",
        domain: "127.0.0.1:3000",
        url: "http://127.0.0.1:3000/paid-report"
      }).status
    ).toBe("allowed");
    expect(
      evaluatePaymentRequest(policy, {
        destination,
        amount: "0.02",
        asset: "XLM",
        network: "testnet",
        domain: "127.0.0.1:3000",
        url: "http://127.0.0.1:3000/paid-report"
      }).matchedRules
    ).toContain("x402_price_over_limit");
  });

  it("round-trips default policy YAML", () => {
    expect(parsePolicyYaml(policyToYaml(DEFAULT_TESTNET_POLICY)).name).toBe("default-testnet-policy");
  });
});

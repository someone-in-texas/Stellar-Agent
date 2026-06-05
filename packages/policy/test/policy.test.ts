import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAINNET_POLICY,
  DEFAULT_TESTNET_POLICY,
  evaluateDefiBlendRequest,
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

  it("denies payments that would exceed history-backed daily and monthly limits", () => {
    const daily = evaluatePaymentRequest(
      DEFAULT_TESTNET_POLICY,
      { destination, amount: "1", asset: "XLM", network: "testnet" },
      { dailyTotal: "100.0000000", monthlyTotal: "1.0000000" }
    );
    expect(daily.status).toBe("denied");
    expect(daily.matchedRules).toContain("daily_total_limit_exceeded");

    const monthly = evaluatePaymentRequest(
      DEFAULT_TESTNET_POLICY,
      { destination, amount: "1", asset: "XLM", network: "testnet" },
      { dailyTotal: "1.0000000", monthlyTotal: "1000.0000000" }
    );
    expect(monthly.status).toBe("denied");
    expect(monthly.matchedRules).toContain("monthly_total_limit_exceeded");
  });

  it("allows zero historical totals while still evaluating the requested payment amount", () => {
    const decision = evaluatePaymentRequest(
      DEFAULT_TESTNET_POLICY,
      { destination, amount: "0.0000001", asset: "XLM", network: "testnet" },
      { dailyTotal: "0.0000000", monthlyTotal: "0.0000000" }
    );
    expect(decision.status).toBe("allowed");
  });

  it("requires approval for new recipients and domains when history lacks prior receipts", () => {
    const policy = {
      ...DEFAULT_TESTNET_POLICY,
      approval: {
        ...DEFAULT_TESTNET_POLICY.approval,
        requireForNewRecipient: true,
        requireForNewDomain: true
      },
      x402: {
        ...DEFAULT_TESTNET_POLICY.x402,
        enabled: true,
        allowDomains: ["api.example.test"]
      }
    };
    const decision = evaluatePaymentRequest(
      policy,
      {
        destination,
        amount: "1",
        asset: "XLM",
        network: "testnet",
        domain: "api.example.test"
      },
      { knownRecipients: [], knownDomains: [] }
    );
    expect(decision.status).toBe("requires_approval");
    expect(decision.matchedRules).toContain("new_recipient_requires_approval");
    expect(decision.matchedRules).toContain("new_domain_requires_approval");
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

  it("allows default Testnet Blend supply-collateral preflight but denies borrow by default", () => {
    const allowed = evaluateDefiBlendRequest(DEFAULT_TESTNET_POLICY, {
      network: "testnet",
      pool: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
      requestTypes: ["supply_collateral"],
      protocolExposureValue: "1",
      healthFactorAfter: null
    });
    expect(allowed.status).toBe("allowed");
    expect(allowed.matchedRules).toContain("defi_blend_request_types_allowed");

    const denied = evaluateDefiBlendRequest(DEFAULT_TESTNET_POLICY, {
      network: "testnet",
      pool: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
      requestTypes: ["borrow"],
      borrowValue: "1",
      protocolExposureValue: "1",
      healthFactorAfter: 2
    });
    expect(denied.status).toBe("denied");
    expect(denied.matchedRules).toContain("defi_blend_request_type_not_allowed");
    expect(denied.matchedRules).toContain("defi_blend_borrow_over_limit");
  });

  it("enforces Blend allowed pools, exposure, and health factor", () => {
    const policy = {
      ...DEFAULT_TESTNET_POLICY,
      defi: {
        blend: {
          ...DEFAULT_TESTNET_POLICY.defi.blend,
          allowedPools: ["CALLOWEDPOOL"],
          maxProtocolExposureValue: "10",
          minimumHealthFactor: 1.5
        }
      }
    };
    const decision = evaluateDefiBlendRequest(policy, {
      network: "testnet",
      pool: "CDENIEDPOOL",
      requestTypes: ["supply_collateral"],
      protocolExposureValue: "11",
      healthFactorAfter: 1.2
    });
    expect(decision.status).toBe("denied");
    expect(decision.matchedRules).toContain("defi_blend_pool_not_allowed");
    expect(decision.matchedRules).toContain("defi_blend_exposure_over_limit");
    expect(decision.matchedRules).toContain("defi_blend_health_factor_too_low");
  });

  it("keeps Mainnet Blend disabled and approval-gated by default", () => {
    const decision = evaluateDefiBlendRequest(DEFAULT_MAINNET_POLICY, {
      network: "mainnet",
      pool: "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD",
      requestTypes: ["supply_collateral"],
      protocolExposureValue: "1",
      healthFactorAfter: 3
    });
    expect(decision.realFunds).toBe(true);
    expect(decision.status).toBe("denied");
    expect(decision.matchedRules).toContain("defi_blend_disabled");
    expect(decision.matchedRules).toContain("defi_blend_mainnet_requires_approval");
  });
});

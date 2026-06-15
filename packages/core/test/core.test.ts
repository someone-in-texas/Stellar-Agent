import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  assertMainnetAgentWalletPaymentPreflight,
  compareAmount,
  createDefaultConfig,
  mainnetAgentWalletConfigFingerprint,
  mainnetAgentWalletIntegrityFailures,
  mainnetAgentWalletRiskBudgetState,
  MainnetAgentWalletConfig,
  parseAmount,
  parseAsset,
  redactSensitive,
  resolvePath,
  serializeError,
  StellarAgentError
} from "../src/index.js";

describe("amount parsing", () => {
  it("normalizes XLM amounts to seven decimals", () => {
    expect(parseAmount("1").value).toBe("1.0000000");
    expect(parseAmount("1.25").stroops).toBe(12_500_000n);
  });

  it("rejects invalid and over-precise amounts", () => {
    expect(() => parseAmount("0")).toThrow("greater than zero");
    expect(() => parseAmount("-1")).toThrow("positive decimal");
    expect(() => parseAmount("1.12345678")).toThrow("at most 7");
  });

  it("compares against zero for Mainnet thresholds", () => {
    expect(compareAmount("0.0000001", "0")).toBe(1);
  });
});

describe("asset parsing", () => {
  it("supports native XLM", () => {
    expect(parseAsset("XLM")).toEqual({ kind: "native", code: "XLM" });
  });

  it("rejects unknown asset formats", () => {
    expect(() => parseAsset("USDC")).toThrow("Asset must be XLM");
  });
});

describe("config and redaction", () => {
  it("creates guarded defaults", () => {
    const config = createDefaultConfig();
    expect(config.activeProfile).toBe("testnet");
    expect(config.profiles.mainnet.realFunds).toBe(true);
    expect(config.profiles.mainnet.enabled).toBe(false);
  });

  it("expands home paths", () => {
    expect(resolvePath("~/stellar-agent-test")).toContain("stellar-agent-test");
  });

  it("redacts secret keys and URL query params", () => {
    const secret = "S".padEnd(56, "A");
    expect(
      redactSensitive({
        secretKey: secret,
        url: "https://example.com/report?token=abc",
        note: `key ${secret}`
      })
    ).toEqual({
      secretKey: "[REDACTED]",
      url: "https://example.com/report?[REDACTED_QUERY]",
      note: "key [REDACTED_SECRET_KEY]"
    });
  });

  it("preserves explicit redaction metadata booleans", () => {
    expect(redactSensitive({ redactions: { secretKeysIncluded: false }, hasSecret: true, secretPrinted: false })).toEqual({
      redactions: { secretKeysIncluded: false },
      hasSecret: true,
      secretPrinted: false
    });
  });

  it("does not redact public Blend bToken and dToken preflight metrics", () => {
    expect(redactSensitive({ expectedTokens: { bTokens: "100", dTokens: "0" }, apiToken: "secret" })).toEqual({
      expectedTokens: { bTokens: "100", dTokens: "0" },
      apiToken: "[REDACTED]"
    });
  });
});

describe("error serialization", () => {
  it("adds fallback hints and docs to structured errors", () => {
    expect(
      serializeError(
        new StellarAgentError({
          code: "INVALID_INPUT",
          message: "Bad input."
        })
      )
    ).toMatchObject({
      code: "INVALID_INPUT",
      message: "Bad input.",
      hint: "Run the command with --help and correct the input.",
      docs: "docs/troubleshooting.md"
    });
  });

  it("serializes schema validation failures as invalid input", () => {
    const result = z.object({ destination: z.string() }).safeParse({ to: "G..." });
    if (result.success) throw new Error("expected schema validation to fail");

    expect(serializeError(result.error)).toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("destination"),
      hint: "Run the command with --help and correct the input.",
      docs: "docs/troubleshooting.md"
    });
  });
});

describe("Mainnet agent-wallet guards", () => {
  const destination = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWHF";
  const publicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  it("fingerprints config without arming metadata or receipt counters", () => {
    const { config, wallet } = armedMainnetAgentWallet();
    const first = mainnetAgentWalletConfigFingerprint(config);
    const changedMetadata: MainnetAgentWalletConfig = {
      ...wallet,
      arming: { ...wallet.arming!, armedAt: "2026-06-02T00:00:00.000Z" },
      spendCounters: {
        updatedAt: "2026-06-02T00:00:00.000Z",
        source: "receipts",
        assets: { XLM: { dailyTotal: "0.0010000" } }
      }
    };

    expect(mainnetAgentWalletConfigFingerprint({ ...config, mainnetAgentWallet: changedMetadata })).toBe(first);
  });

  it("reports stale arming metadata when config or policy inputs change", () => {
    const { config, wallet, configPath, policyPath, policyFingerprint } = armedMainnetAgentWallet();

    expect(
      mainnetAgentWalletIntegrityFailures({ wallet, config, configPath, policyPath, policyFingerprint })
    ).toEqual([]);
    expect(
      mainnetAgentWalletIntegrityFailures({
        wallet,
        config: { ...config, activeProfile: "mainnet" },
        configPath,
        policyPath,
        policyFingerprint: "changed-policy"
      })
    ).toEqual(["policy_changed_after_arming", "config_changed_after_arming"]);
  });

  it("allows preflight only inside the armed risk budget", () => {
    const { config, wallet, configPath, policyPath, policyFingerprint } = armedMainnetAgentWallet();
    const request = {
      source: publicKey,
      destination,
      amount: "0.01",
      asset: "XLM",
      network: "mainnet" as const
    };

    expect(() =>
      assertMainnetAgentWalletPaymentPreflight({
        wallet,
        request,
        config,
        configPath,
        policyPath,
        policyFingerprint,
        spendHistory: { dailyTotal: "0.0100000", monthlyTotal: "0.0100000" },
        balances: [{ asset: "XLM", balance: "0.1000000" }]
      })
    ).not.toThrow();
  });

  it("fails closed for unreadable history, spend caps, and overfunded balances", () => {
    const { config, wallet, configPath, policyPath, policyFingerprint } = armedMainnetAgentWallet();
    const request = {
      source: publicKey,
      destination,
      amount: "0.01",
      asset: "XLM",
      network: "mainnet" as const
    };
    const base = { wallet, request, config, configPath, policyPath, policyFingerprint };

    expect(() =>
      assertMainnetAgentWalletPaymentPreflight({
        ...base,
        spendHistory: { unreadable: true },
        balances: [{ asset: "XLM", balance: "0.1000000" }]
      })
    ).toThrow("spend history could not be read");
    expect(() =>
      assertMainnetAgentWalletPaymentPreflight({
        ...base,
        spendHistory: { dailyTotal: "0.0500000" },
        balances: [{ asset: "XLM", balance: "0.1000000" }]
      })
    ).toThrow("daily risk budget");
    expect(() =>
      assertMainnetAgentWalletPaymentPreflight({
        ...base,
        spendHistory: { dailyTotal: "0.0100000" },
        balances: [{ asset: "XLM", balance: "0.6000000" }]
      })
    ).toThrow("balance exceeds");
  });

  it("reports risk budget state before and after a payment", () => {
    const { wallet } = armedMainnetAgentWallet();
    const state = mainnetAgentWalletRiskBudgetState(
      wallet,
      { dailyTotal: "0.0100000", monthlyTotal: "0.0200000", knownRecipients: [] },
      { destination, amount: "0.01", asset: "XLM", network: "mainnet" }
    );

    expect(state).toMatchObject({
      before: { dailyTotal: "0.0100000" },
      after: {
        dailyTotal: "0.0200000",
        monthlyTotal: "0.0300000",
        knownRecipients: [destination]
      }
    });
  });

  function armedMainnetAgentWallet() {
    const configPath = "/tmp/stellar-agent/config.yaml";
    const policyPath = "/tmp/stellar-agent/policies/default-mainnet.yaml";
    const policyFingerprint = "policy-fingerprint";
    const createdAt = "2026-06-01T00:00:00.000Z";
    const baseWallet: MainnetAgentWalletConfig = {
      schemaVersion: "stellar-agent.mainnetAgentWallet.v1",
      walletName: "mainnet-agent",
      publicKey,
      status: "armed",
      createdAt,
      updatedAt: createdAt,
      riskBudget: {
        maxBalance: "0.5",
        perTxLimit: "0.02",
        dailyLimit: "0.05",
        monthlyLimit: "0.10",
        allowedAssets: ["XLM"],
        allowedDestinations: [destination],
        allowedOperations: ["payment"]
      }
    };
    const config = createDefaultConfig("/tmp/stellar-agent");
    config.mainnetAgentWallet = baseWallet;
    const wallet: MainnetAgentWalletConfig = {
      ...baseWallet,
      arming: {
        armedAt: createdAt,
        configPath,
        configFingerprint: mainnetAgentWalletConfigFingerprint(config),
        policyPath,
        policyFingerprint
      }
    };
    config.mainnetAgentWallet = wallet;
    return { config, wallet, configPath, policyPath, policyFingerprint };
  }
});

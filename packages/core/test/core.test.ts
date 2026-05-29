import { describe, expect, it } from "vitest";
import {
  compareAmount,
  createDefaultConfig,
  parseAmount,
  parseAsset,
  redactSensitive,
  resolvePath
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
});

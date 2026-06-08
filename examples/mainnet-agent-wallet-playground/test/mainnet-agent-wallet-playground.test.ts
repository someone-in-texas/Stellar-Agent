import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAINNET_AGENT_WALLET_WARNING,
  armAgentWallet,
  configureAgentWallet,
  createPlaygroundState,
  disarmAgentWallet,
  preflightSpend,
  recordSimulatedSpend,
  setSimulatedWalletBalance,
  walletStatus
} from "../src/playground.js";

const agent = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const destination = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWHF";
const otherDestination = "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDWHF";
const issuedAsset = "USD:GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEWHF";

describe("examples/mainnet-agent-wallet-playground", () => {
  it("arms and disarms a configured dedicated wallet", async () => {
    const state = fixtureState();
    configureDefaultWallet(state);
    const armed = await armAgentWallet(state);
    expect(armed.status).toBe("armed");
    expect(walletStatus(state)).toMatchObject({
      configured: true,
      status: "armed",
      warning: MAINNET_AGENT_WALLET_WARNING,
      integrity: { ok: true }
    });

    const disarmed = disarmAgentWallet(state);
    expect(disarmed.status).toBe("disarmed");
    await expect(preflightSpend(state, { destination, amount: "0.01" })).rejects.toMatchObject({
      code: "MAINNET_NOT_ENABLED"
    });
  });

  it("preflights an allowed small spend without live Mainnet submission", async () => {
    const state = fixtureState();
    configureDefaultWallet(state);
    await armAgentWallet(state);
    const preflight = await preflightSpend(state, { destination, amount: "0.01" });
    expect(preflight).toMatchObject({
      realFunds: true,
      submitLiveMainnetTransaction: false,
      warning: MAINNET_AGENT_WALLET_WARNING,
      policyDecision: { status: "requires_approval" }
    });
  });

  it("refuses per-transaction cap violations", async () => {
    const state = fixtureState();
    configureDefaultWallet(state);
    await armAgentWallet(state);
    await expect(preflightSpend(state, { destination, amount: "0.03" })).rejects.toMatchObject({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet payment exceeds the per-transaction risk budget."
    });
  });

  it("refuses daily cap exhaustion using receipt-backed spend accounting", async () => {
    const state = fixtureState();
    configureDefaultWallet(state, { perTxLimit: "0.05" });
    await armAgentWallet(state);
    await recordSimulatedSpend(state, { destination, amount: "0.04" });

    await expect(preflightSpend(state, { destination, amount: "0.02" })).rejects.toMatchObject({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet payment would exceed the daily risk budget."
    });
  });

  it("refuses assets outside the allowed asset list", async () => {
    const state = fixtureState();
    configureDefaultWallet(state);
    await armAgentWallet(state);
    await expect(preflightSpend(state, { destination, amount: "0.01", asset: issuedAsset })).rejects.toMatchObject({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet payment asset is not allowed."
    });
  });

  it("refuses destinations outside the allowlist", async () => {
    const state = fixtureState();
    configureDefaultWallet(state);
    await armAgentWallet(state);
    await expect(preflightSpend(state, { destination: otherDestination, amount: "0.01" })).rejects.toMatchObject({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet destination is not allowlisted."
    });
  });

  it("fails closed when receipts become unreadable", async () => {
    const state = fixtureState();
    configureDefaultWallet(state);
    await armAgentWallet(state);
    await mkdir(state.receiptsDir, { recursive: true });
    await writeFile(join(state.receiptsDir, "broken.json"), "{");

    await expect(preflightSpend(state, { destination, amount: "0.01" })).rejects.toMatchObject({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet receipt history is unreadable, so spend preflight fails closed."
    });
  });

  it("fails closed when config or policy fingerprints change after arming", async () => {
    const state = fixtureState();
    configureDefaultWallet(state);
    await armAgentWallet(state);
    state.policy = { ...state.policy, limits: { ...state.policy.limits, dailyTotal: "0.1 XLM" } };
    await expect(preflightSpend(state, { destination, amount: "0.01" })).rejects.toMatchObject({
      code: "POLICY_DENIED",
      details: { failures: expect.arrayContaining(["policy_changed_after_arming"]) }
    });

    const second = fixtureState();
    configureDefaultWallet(second);
    await armAgentWallet(second);
    second.config.output.color = false;
    await expect(preflightSpend(second, { destination, amount: "0.01" })).rejects.toMatchObject({
      code: "POLICY_DENIED",
      details: { failures: expect.arrayContaining(["config_changed_after_arming"]) }
    });
  });

  it("refuses wallet balances above the configured max balance", async () => {
    const state = fixtureState();
    configureDefaultWallet(state, { maxBalance: "0.1" });
    setSimulatedWalletBalance(state, "0.2");
    await expect(armAgentWallet(state)).rejects.toMatchObject({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet balance exceeds the configured risk budget."
    });
  });

  it("writes visible real-funds warnings into simulated receipts", async () => {
    const state = fixtureState();
    configureDefaultWallet(state);
    await armAgentWallet(state);
    const { receipt } = await recordSimulatedSpend(state, { destination, amount: "0.01" });

    expect(receipt.receipt.network.realFunds).toBe(true);
    expect(JSON.stringify(receipt.receipt)).toContain(MAINNET_AGENT_WALLET_WARNING);
    expect(receipt.receipt.operation?.details).toMatchObject({
      submitLiveMainnetTransaction: false,
      warning: MAINNET_AGENT_WALLET_WARNING
    });
  });
});

function fixtureState() {
  return createPlaygroundState(join(tmpdir(), `stellar-agent-mainnet-wallet-${Math.random().toString(36).slice(2)}`));
}

function configureDefaultWallet(
  state: ReturnType<typeof createPlaygroundState>,
  overrides: Partial<Parameters<typeof configureAgentWallet>[1]> = {}
) {
  return configureAgentWallet(state, {
    address: agent,
    allowedDestinations: [destination],
    maxBalance: "1",
    dailyLimit: "0.05",
    perTxLimit: "0.02",
    ...overrides
  });
}

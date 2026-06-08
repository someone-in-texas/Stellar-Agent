import {
  MAINNET_PROFILE,
  MainnetAgentWalletConfig,
  PaymentRequest,
  StellarAgentConfig,
  StellarAgentError,
  amountIsGreaterThan,
  createDefaultConfig,
  formatStroops,
  makeId,
  nowIso,
  parseAmount
} from "@stellar-agent/core";
import { spendHistoryFromReceipts, writeReceipt } from "@stellar-agent/ledger-logger";
import { DEFAULT_MAINNET_POLICY, Policy, evaluatePaymentRequest, policyToYaml } from "@stellar-agent/policy";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAINNET_AGENT_WALLET_WARNING =
  "Mainnet agent-wallet spend is bounded, not safe. This playground never submits live Mainnet transactions by default.";

export interface PlaygroundState {
  config: StellarAgentConfig;
  configPath: string;
  policy: Policy;
  policyPath: string;
  receiptsDir: string;
  eventLog: string;
  simulatedWalletBalance: string;
}

export interface AgentWalletSetup {
  address: string;
  maxBalance: string;
  dailyLimit: string;
  perTxLimit: string;
  monthlyLimit?: string;
  asset?: string;
  allowedDestinations: string[];
}

export interface PreflightResult {
  request: PaymentRequest;
  policyDecision: ReturnType<typeof evaluatePaymentRequest>;
  spendHistory: Awaited<ReturnType<typeof spendHistoryFromReceipts>>;
  warning: string;
  realFunds: true;
  submitLiveMainnetTransaction: false;
}

export function createPlaygroundState(rootDir = ".stellar-agent-mainnet-wallet-playground"): PlaygroundState {
  const root = resolve(rootDir);
  const config = createDefaultConfig(root);
  config.activeProfile = "testnet";
  config.profiles.mainnet = { ...MAINNET_PROFILE, enabled: true };
  return {
    config,
    configPath: join(root, "config.yaml"),
    policy: cloneDefaultMainnetPolicy(),
    policyPath: join(root, "policies", "default-mainnet.yaml"),
    receiptsDir: join(root, "receipts"),
    eventLog: join(root, "logs", "events.jsonl"),
    simulatedWalletBalance: "0.25"
  };
}

export function configureAgentWallet(state: PlaygroundState, setup: AgentWalletSetup): MainnetAgentWalletConfig {
  const now = nowIso();
  const wallet: MainnetAgentWalletConfig = {
    schemaVersion: "stellar-agent.mainnetAgentWallet.v1",
    walletName: "mainnet-agent",
    publicKey: setup.address,
    status: "disarmed",
    createdAt: state.config.mainnetAgentWallet?.createdAt ?? now,
    updatedAt: now,
    riskBudget: {
      maxBalance: normalizeAmount(setup.maxBalance, setup.asset ?? "XLM"),
      perTxLimit: normalizeAmount(setup.perTxLimit, setup.asset ?? "XLM"),
      dailyLimit: normalizeAmount(setup.dailyLimit, setup.asset ?? "XLM"),
      ...(setup.monthlyLimit ? { monthlyLimit: normalizeAmount(setup.monthlyLimit, setup.asset ?? "XLM") } : {}),
      allowedAssets: [setup.asset ?? "XLM"],
      allowedDestinations: setup.allowedDestinations,
      allowedOperations: ["payment"]
    }
  };
  state.config.mainnetAgentWallet = wallet;
  return wallet;
}

export async function armAgentWallet(state: PlaygroundState): Promise<MainnetAgentWalletConfig> {
  const wallet = requireWallet(state);
  if (!wallet.publicKey) {
    throw new StellarAgentError({ code: "WALLET_NOT_FOUND", message: "Mainnet agent wallet needs a public key." });
  }
  if (wallet.riskBudget.allowedDestinations.length === 0) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent wallet requires at least one destination allowlist entry."
    });
  }
  assertBalanceWithinBudget(state, wallet);
  await mkdir(state.receiptsDir, { recursive: true });
  const armedBase: MainnetAgentWalletConfig = {
    ...wallet,
    status: "armed",
    updatedAt: nowIso(),
    spendCounters: await spendCounters(state, wallet),
    arming: undefined
  };
  const configAtArming = { ...state.config, mainnetAgentWallet: armedBase };
  const armed: MainnetAgentWalletConfig = {
    ...armedBase,
    arming: {
      armedAt: nowIso(),
      configPath: state.configPath,
      configFingerprint: configFingerprint(configAtArming),
      policyPath: state.policyPath,
      policyFingerprint: policyFingerprint(state.policy)
    }
  };
  state.config.mainnetAgentWallet = armed;
  return armed;
}

export function disarmAgentWallet(state: PlaygroundState): MainnetAgentWalletConfig {
  const wallet = requireWallet(state);
  const disarmed = { ...wallet, status: "disarmed" as const, updatedAt: nowIso(), arming: undefined };
  state.config.mainnetAgentWallet = disarmed;
  return disarmed;
}

export async function preflightSpend(
  state: PlaygroundState,
  args: { destination: string; amount: string; asset?: string }
): Promise<PreflightResult> {
  const wallet = requireWallet(state);
  if (wallet.status !== "armed") {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Mainnet agent-wallet playground requires the wallet to be armed before spend preflight."
    });
  }
  const failures = armingFailures(state, wallet);
  if (failures.length > 0) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet arming is stale and must be refreshed.",
      details: { failures }
    });
  }
  const asset = args.asset ?? "XLM";
  const request: PaymentRequest = {
    source: wallet.publicKey,
    destination: args.destination,
    amount: normalizeAmount(args.amount, asset),
    asset,
    network: "mainnet"
  };
  assertRiskBudgetAllows(wallet, request);
  const history = await spendHistoryFromReceipts(state.receiptsDir, { profile: "mainnet", asset });
  if (history.unreadable) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet receipt history is unreadable, so spend preflight fails closed."
    });
  }
  assertSpendTotalsAllow(wallet, request, history);
  assertBalanceWithinBudget(state, wallet);
  const policyDecision = evaluatePaymentRequest(state.policy, request, history);
  if (policyDecision.status === "denied") {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet policy denied the spend preflight.",
      details: { policyDecision }
    });
  }
  return {
    request,
    policyDecision,
    spendHistory: history,
    warning: MAINNET_AGENT_WALLET_WARNING,
    realFunds: true,
    submitLiveMainnetTransaction: false
  };
}

export async function recordSimulatedSpend(
  state: PlaygroundState,
  args: { destination: string; amount: string; asset?: string }
) {
  const preflight = await preflightSpend(state, args);
  await mkdir(state.receiptsDir, { recursive: true });
  const receipt = await writeReceipt(state.receiptsDir, {
    command: "examples/mainnet-agent-wallet-playground simulated-spend",
    profile: "mainnet",
    networkPassphrase: MAINNET_PROFILE.networkPassphrase,
    realFunds: true,
    payment: {
      source: preflight.request.source ?? requireWallet(state).publicKey ?? "mainnet-agent",
      destination: preflight.request.destination,
      asset: preflight.request.asset,
      amount: preflight.request.amount
    },
    operation: {
      type: "mainnet-agent-wallet.simulated-payment",
      source: preflight.request.source,
      destination: preflight.request.destination,
      asset: preflight.request.asset,
      amount: preflight.request.amount,
      details: {
        submitLiveMainnetTransaction: false,
        warning: preflight.warning,
        riskBudget: requireWallet(state).riskBudget
      }
    },
    policyDecision: {
      status: preflight.policyDecision.status,
      matchedRules: [...preflight.policyDecision.matchedRules, "mainnet_agent_wallet_preflight_only"]
    },
    transaction: {
      hash: makeId("simulated_mainnet_spend").replace(/[^a-z0-9]/gi, "").padEnd(64, "0").slice(0, 64),
      successful: true
    },
    eventLog: state.eventLog
  });
  const wallet = requireWallet(state);
  state.config.mainnetAgentWallet = { ...wallet, spendCounters: await spendCounters(state, wallet) };
  return { preflight, receipt };
}

export function setSimulatedWalletBalance(state: PlaygroundState, balance: string): void {
  state.simulatedWalletBalance = normalizeAmount(balance);
}

export function armingFailures(state: PlaygroundState, wallet = requireWallet(state)): string[] {
  if (!wallet.arming) return ["arming_metadata_missing"];
  const failures: string[] = [];
  if (wallet.arming.configPath !== state.configPath) failures.push("config_path_changed");
  if (wallet.arming.configFingerprint !== configFingerprint(state.config)) failures.push("config_changed_after_arming");
  if (wallet.arming.policyPath !== state.policyPath) failures.push("policy_path_changed");
  if (wallet.arming.policyFingerprint !== policyFingerprint(state.policy)) failures.push("policy_changed_after_arming");
  return failures;
}

export function walletStatus(state: PlaygroundState) {
  const wallet = state.config.mainnetAgentWallet;
  return {
    configured: Boolean(wallet),
    walletName: wallet?.walletName,
    publicKey: wallet?.publicKey,
    status: wallet?.status ?? "unconfigured",
    warning: MAINNET_AGENT_WALLET_WARNING,
    integrity:
      wallet?.status === "armed"
        ? { ok: armingFailures(state, wallet).length === 0, failures: armingFailures(state, wallet) }
        : { ok: true, failures: [] as string[] },
    riskBudget: wallet?.riskBudget,
    simulatedWalletBalance: state.simulatedWalletBalance
  };
}

async function spendCounters(state: PlaygroundState, wallet: MainnetAgentWalletConfig): Promise<NonNullable<MainnetAgentWalletConfig["spendCounters"]>> {
  const assets = await Promise.all(
    wallet.riskBudget.allowedAssets.map(async (asset) => [
      asset,
      await spendHistoryFromReceipts(state.receiptsDir, { profile: "mainnet", asset })
    ] as const)
  );
  return { updatedAt: nowIso(), source: "receipts", assets: Object.fromEntries(assets) };
}

function assertRiskBudgetAllows(wallet: MainnetAgentWalletConfig, request: PaymentRequest): void {
  if (!wallet.riskBudget.allowedOperations.includes("payment")) {
    throw new StellarAgentError({ code: "POLICY_DENIED", message: "Mainnet agent-wallet does not allow payment operations." });
  }
  if (!wallet.riskBudget.allowedAssets.map((asset) => asset.toUpperCase()).includes(request.asset.toUpperCase())) {
    throw new StellarAgentError({ code: "POLICY_DENIED", message: "Mainnet agent-wallet payment asset is not allowed." });
  }
  if (!wallet.riskBudget.allowedDestinations.includes(request.destination)) {
    throw new StellarAgentError({ code: "POLICY_DENIED", message: "Mainnet agent-wallet destination is not allowlisted." });
  }
  if (amountIsGreaterThan(request.amount, wallet.riskBudget.perTxLimit)) {
    throw new StellarAgentError({ code: "POLICY_DENIED", message: "Mainnet agent-wallet payment exceeds the per-transaction risk budget." });
  }
}

function assertSpendTotalsAllow(
  wallet: MainnetAgentWalletConfig,
  request: PaymentRequest,
  history: Awaited<ReturnType<typeof spendHistoryFromReceipts>>
): void {
  if (amountIsGreaterThan(addAmounts(history.dailyTotal ?? "0", request.amount), wallet.riskBudget.dailyLimit)) {
    throw new StellarAgentError({ code: "POLICY_DENIED", message: "Mainnet agent-wallet payment would exceed the daily risk budget." });
  }
  if (wallet.riskBudget.monthlyLimit && amountIsGreaterThan(addAmounts(history.monthlyTotal ?? "0", request.amount), wallet.riskBudget.monthlyLimit)) {
    throw new StellarAgentError({ code: "POLICY_DENIED", message: "Mainnet agent-wallet payment would exceed the monthly risk budget." });
  }
}

function assertBalanceWithinBudget(state: PlaygroundState, wallet: MainnetAgentWalletConfig): void {
  if (amountIsGreaterThan(state.simulatedWalletBalance, wallet.riskBudget.maxBalance)) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet balance exceeds the configured risk budget.",
      details: { balance: state.simulatedWalletBalance, maxBalance: wallet.riskBudget.maxBalance }
    });
  }
}

function requireWallet(state: PlaygroundState): MainnetAgentWalletConfig {
  if (!state.config.mainnetAgentWallet) {
    throw new StellarAgentError({ code: "WALLET_NOT_FOUND", message: "Configure the dedicated Mainnet agent wallet first." });
  }
  return state.config.mainnetAgentWallet;
}

function normalizeAmount(value: string, asset = "XLM"): string {
  return parseAmount(value, asset).value;
}

function addAmounts(left: string, right: string): string {
  return formatStroops(parseAmountAllowZero(left) + parseAmount(right).stroops);
}

function parseAmountAllowZero(value: string): bigint {
  if (value === "0" || value === "0.0" || value === "0.0000000") return 0n;
  return parseAmount(value).stroops;
}

function configFingerprint(config: StellarAgentConfig): string {
  const clone = JSON.parse(JSON.stringify(config)) as StellarAgentConfig;
  if (clone.mainnetAgentWallet) {
    clone.mainnetAgentWallet.arming = undefined;
    clone.mainnetAgentWallet.spendCounters = undefined;
  }
  return sha256(JSON.stringify(sortJson(clone)));
}

function policyFingerprint(policy: Policy): string {
  return sha256(policyToYaml(policy));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cloneDefaultMainnetPolicy(): Policy {
  return JSON.parse(JSON.stringify(DEFAULT_MAINNET_POLICY)) as Policy;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortJson(child)]));
}

export function loadPlaygroundEnv(filePath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env")): void {
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnvValue(rawValue.trim());
  }
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadPlaygroundEnv();
  const state = createPlaygroundState(process.env.STELLAR_AGENT_PLAYGROUND_ROOT);
  configureAgentWallet(state, {
    address: process.env.AGENT_WALLET_ADDRESS ?? "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    allowedDestinations: [process.env.AGENT_WALLET_DESTINATION ?? "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWHF"],
    maxBalance: process.env.AGENT_WALLET_MAX_BALANCE ?? "1",
    dailyLimit: process.env.AGENT_WALLET_DAILY_LIMIT ?? "0.05",
    perTxLimit: process.env.AGENT_WALLET_PER_TX_LIMIT ?? "0.02"
  });
  await armAgentWallet(state);
  const preflight = await preflightSpend(state, {
    destination: process.env.AGENT_WALLET_DESTINATION ?? "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWHF",
    amount: "0.01"
  });
  console.log(JSON.stringify({ ok: true, status: walletStatus(state), preflight }, null, 2));
}

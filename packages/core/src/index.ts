import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

export const XLM_DECIMALS = 7;
export const STROOPS_PER_XLM = 10_000_000n;

export type NetworkName = "testnet" | "mainnet" | "local";

export interface NetworkProfile {
  name: NetworkName;
  network: "testnet" | "public" | "local";
  networkPassphrase: string;
  horizonUrl: string | null;
  rpcUrl: string | null;
  friendbotUrl: string | null;
  defaultAsset: "XLM";
  enabled?: boolean | undefined;
  requiresExplicitApproval?: boolean | undefined;
  realFunds: boolean;
}

export interface StorageConfig {
  rootDir: string;
  receiptsDir: string;
  ledgersDir: string;
  logsDir: string;
  walletsDir: string;
  policiesDir: string;
  approvalsDir: string;
  scenariosDir: string;
}

export interface StellarAgentConfig {
  version: 1;
  activeProfile: NetworkName;
  profiles: Record<string, NetworkProfile>;
  storage: StorageConfig;
  mainnetAgentWallet?: MainnetAgentWalletConfig | undefined;
  output: {
    color: boolean;
    json: boolean;
    redactSensitiveData: boolean;
  };
}

export interface MainnetAgentWalletRiskBudget {
  maxBalance: string;
  perTxLimit: string;
  dailyLimit: string;
  monthlyLimit?: string | undefined;
  allowedAssets: string[];
  allowedDestinations: string[];
  allowedOperations: string[];
}

export interface MainnetAgentWalletConfig {
  schemaVersion: "stellar-agent.mainnetAgentWallet.v1";
  walletName: string;
  publicKey?: string | undefined;
  status: "unconfigured" | "disarmed" | "armed";
  createdAt: string;
  updatedAt: string;
  riskBudget: MainnetAgentWalletRiskBudget;
  autosign?: {
    enabled: boolean;
    secretKeyEnvVar: string;
    enabledAt: string;
    warningAcknowledgedAt: string;
  } | undefined;
  spendCounters?: {
    updatedAt: string;
    source: "receipts";
    assets: Record<
      string,
      {
        dailyTotal?: string | undefined;
        monthlyTotal?: string | undefined;
        knownRecipients?: string[] | undefined;
        knownDomains?: string[] | undefined;
        unreadable?: boolean | undefined;
      }
    >;
  } | undefined;
  arming?: {
    armedAt: string;
    configPath: string;
    configFingerprint: string;
    policyPath: string;
    policyFingerprint: string;
  } | undefined;
}

export type MainnetAgentWalletSpendHistory = NonNullable<MainnetAgentWalletConfig["spendCounters"]>["assets"][string];

export interface MainnetAgentWalletBalanceLine {
  asset: string;
  balance: string;
}

export const MAINNET_AGENT_WALLET_WARNING =
  "Mainnet agent-wallet spend is bounded, not safe. Local Mainnet auto-signing remains blocked except explicitly enabled agent-wallet autosigning.";

export const MAINNET_AGENT_WALLET_AUTOSIGN_WARNING =
  "Mainnet agent-wallet autosigning can spend real funds within configured limits; any process with the configured secret-key env var can spend from this wallet.";

export type CommandResult<T> = SuccessEnvelope<T> | ErrorEnvelope;

export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
}

export interface ErrorEnvelope {
  ok: false;
  error: SerializedError;
}

export interface SerializedError {
  code: ErrorCode;
  message: string;
  hint?: string;
  docs?: string;
  details?: unknown;
}

export type ErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID"
  | "PROFILE_NOT_FOUND"
  | "MAINNET_NOT_ENABLED"
  | "POLICY_INVALID"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_DENIED"
  | "WALLET_NOT_FOUND"
  | "WALLET_INVALID"
  | "ACCOUNT_NOT_FOUND"
  | "SECRET_KEY_BLOCKED"
  | "FRIENDBOT_UNAVAILABLE"
  | "RPC_UNAVAILABLE"
  | "HORIZON_UNAVAILABLE"
  | "TRANSACTION_BUILD_FAILED"
  | "TRANSACTION_SUBMIT_FAILED"
  | "TRANSACTION_TIMEOUT"
  | "LEDGER_LOOKUP_FAILED"
  | "X402_NOT_IMPLEMENTED"
  | "X402_RESOURCE_UNAVAILABLE"
  | "MPP_NOT_IMPLEMENTED"
  | "MPP_RESOURCE_UNAVAILABLE"
  | "FREIGHTER_NOT_IMPLEMENTED"
  | "STELLAR_CLI_UNAVAILABLE"
  | "INVALID_AMOUNT"
  | "INVALID_ASSET"
  | "INVALID_INPUT"
  | "NOT_IMPLEMENTED"
  | "UNKNOWN_ERROR";

export const EXIT_CODES = {
  success: 0,
  general: 1,
  usage: 2,
  validation: 3,
  policyDenied: 4,
  approval: 5,
  network: 6,
  transaction: 7,
  notImplemented: 8
} as const;

export class StellarAgentError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly docs: string | undefined;
  readonly details: unknown;
  readonly exitCode: number;

  constructor(args: {
    code: ErrorCode;
    message: string;
    hint?: string;
    docs?: string;
    details?: unknown;
    exitCode?: number;
  }) {
    super(args.message);
    this.name = "StellarAgentError";
    this.code = args.code;
    this.hint = args.hint;
    this.docs = args.docs;
    this.details = args.details;
    this.exitCode = args.exitCode ?? exitCodeForError(args.code);
  }
}

export function exitCodeForError(code: ErrorCode): number {
  if (code === "POLICY_DENIED") return EXIT_CODES.policyDenied;
  if (code === "APPROVAL_REQUIRED" || code === "APPROVAL_DENIED") return EXIT_CODES.approval;
  if (code === "CONFIG_INVALID" || code === "POLICY_INVALID") return EXIT_CODES.validation;
  if (code === "CONFIG_NOT_FOUND" || code === "PROFILE_NOT_FOUND" || code === "INVALID_INPUT" || code === "ACCOUNT_NOT_FOUND") {
    return EXIT_CODES.usage;
  }
  if (code.includes("UNAVAILABLE")) return EXIT_CODES.network;
  if (code.startsWith("TRANSACTION_")) return EXIT_CODES.transaction;
  if (code.includes("NOT_IMPLEMENTED")) return EXIT_CODES.notImplemented;
  return EXIT_CODES.general;
}

export function ok<T>(data: T): SuccessEnvelope<T> {
  return { ok: true, data };
}

export function fail(error: StellarAgentError | SerializedError): ErrorEnvelope {
  return {
    ok: false,
    error: error instanceof StellarAgentError ? serializeError(error) : error
  };
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof StellarAgentError) {
    return {
      code: error.code,
      message: error.message,
      hint: error.hint ?? defaultHintForError(error.code),
      docs: error.docs ?? defaultDocsForError(error.code),
      ...(error.details !== undefined ? { details: redactSensitive(error.details) } : {})
    };
  }
  if (error instanceof Error) {
    return {
      code: "UNKNOWN_ERROR",
      message: error.message,
      hint: defaultHintForError("UNKNOWN_ERROR"),
      docs: defaultDocsForError("UNKNOWN_ERROR")
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: "Unknown error.",
    hint: defaultHintForError("UNKNOWN_ERROR"),
    docs: defaultDocsForError("UNKNOWN_ERROR"),
    details: redactSensitive(error)
  };
}

function defaultHintForError(code: ErrorCode): string {
  if (code === "POLICY_DENIED") return "Run stellar-agent policy explain to inspect the matched rules.";
  if (code === "APPROVAL_REQUIRED" || code === "APPROVAL_DENIED") return "Use the local approval flow or adjust the request.";
  if (code === "MAINNET_NOT_ENABLED") return "Run stellar-agent mainnet status and use guarded Mainnet flows only when intended.";
  if (code === "CONFIG_NOT_FOUND" || code === "CONFIG_INVALID") return "Run stellar-agent testnet init or pass --config with a valid config file.";
  if (code === "POLICY_INVALID") return "Run stellar-agent policy check to inspect the policy file.";
  if (code === "WALLET_NOT_FOUND" || code === "WALLET_INVALID") return "Run stellar-agent wallet list or create/import the wallet first.";
  if (code.includes("UNAVAILABLE")) return "Check network access and run stellar-agent testnet doctor --live.";
  if (code.startsWith("TRANSACTION_")) return "Check wallet funding, fee strategy, destination, and the transaction hash before retrying.";
  if (code === "INVALID_AMOUNT") return "Use a positive decimal string with at most 7 decimal places.";
  if (code === "INVALID_ASSET") return "Use XLM or CODE:G... issuer asset format.";
  if (code === "INVALID_INPUT") return "Run the command with --help and correct the input.";
  if (code.includes("NOT_IMPLEMENTED")) return "Use the documented Testnet-supported commands for this release.";
  return "Rerun with --verbose for more context and check docs/troubleshooting.md.";
}

function defaultDocsForError(code: ErrorCode): string {
  if (code === "POLICY_DENIED") return "docs/troubleshooting.md#policy-denied";
  if (code === "APPROVAL_REQUIRED" || code === "APPROVAL_DENIED") return "docs/mainnet-safety.md#local-approval-bridge";
  if (code === "MAINNET_NOT_ENABLED") return "docs/troubleshooting.md#mainnet-disabled";
  if (code === "CONFIG_NOT_FOUND" || code === "CONFIG_INVALID") return "docs/troubleshooting.md#invalid-wallet";
  if (code === "POLICY_INVALID") return "docs/troubleshooting.md#policy-denied";
  if (code === "WALLET_NOT_FOUND" || code === "WALLET_INVALID") return "docs/troubleshooting.md#invalid-wallet";
  if (code.includes("UNAVAILABLE")) return "docs/troubleshooting.md#rpc-or-horizon-unavailable";
  if (code.startsWith("TRANSACTION_")) return "docs/troubleshooting.md#transaction-timeout";
  if (code === "INVALID_AMOUNT" || code === "INVALID_ASSET" || code === "INVALID_INPUT") return "docs/troubleshooting.md";
  if (code.includes("NOT_IMPLEMENTED")) return "docs/quickstart-testnet.md";
  return "docs/troubleshooting.md";
}

export type NativeAsset = { kind: "native"; code: "XLM" };
export type IssuedAsset = { kind: "issued"; code: string; issuer: string };
export type StellarAsset = NativeAsset | IssuedAsset;

const gAddressPattern = /^G[A-Z2-7]{55}$/;
const sSecretPattern = /^S[A-Z2-7]{55}$/;

export function parseAsset(input: string): StellarAsset {
  const value = input.trim().toUpperCase();
  if (value === "XLM") return { kind: "native", code: "XLM" };

  const [code, issuer, extra] = value.split(":");
  if (!code || !issuer || extra !== undefined || !/^[A-Z0-9]{1,12}$/.test(code)) {
    throw new StellarAgentError({
      code: "INVALID_ASSET",
      message: "Asset must be XLM or CODE:G... issuer format.",
      exitCode: EXIT_CODES.usage
    });
  }
  if (!gAddressPattern.test(issuer)) {
    throw new StellarAgentError({
      code: "INVALID_ASSET",
      message: "Issued asset issuer must be a Stellar public key.",
      exitCode: EXIT_CODES.usage
    });
  }
  return { kind: "issued", code, issuer };
}

export function assetToString(asset: StellarAsset): string {
  return asset.kind === "native" ? "XLM" : `${asset.code}:${asset.issuer}`;
}

export interface ParsedAmount {
  asset: string;
  value: string;
  stroops: bigint;
}

export function parseAmount(input: string, asset = "XLM"): ParsedAmount {
  const trimmed = input.trim();
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) {
    throw new StellarAgentError({
      code: "INVALID_AMOUNT",
      message: "Amount must be a positive decimal string.",
      exitCode: EXIT_CODES.usage
    });
  }

  const [wholeRaw, fractionRaw = ""] = trimmed.split(".");
  if (fractionRaw.length > XLM_DECIMALS) {
    throw new StellarAgentError({
      code: "INVALID_AMOUNT",
      message: "Stellar amounts support at most 7 decimal places.",
      exitCode: EXIT_CODES.usage
    });
  }

  const whole = BigInt(wholeRaw ?? "0");
  const fraction = BigInt(fractionRaw.padEnd(XLM_DECIMALS, "0"));
  const stroops = whole * STROOPS_PER_XLM + fraction;
  if (stroops <= 0n) {
    throw new StellarAgentError({
      code: "INVALID_AMOUNT",
      message: "Amount must be greater than zero.",
      exitCode: EXIT_CODES.usage
    });
  }

  return { asset, value: formatStroops(stroops), stroops };
}

export function formatStroops(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const fraction = (stroops % STROOPS_PER_XLM).toString().padStart(XLM_DECIMALS, "0");
  return `${whole}.${fraction}`;
}

export function compareAmount(a: string, b: string): -1 | 0 | 1 {
  const left = parseComparableAmount(a);
  const right = parseComparableAmount(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function amountIsGreaterThan(a: string, b: string): boolean {
  return compareAmount(a, b) === 1;
}

function parseComparableAmount(input: string): bigint {
  const trimmed = input.trim();
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) {
    throw new StellarAgentError({
      code: "INVALID_AMOUNT",
      message: "Amount must be a decimal string.",
      exitCode: EXIT_CODES.usage
    });
  }
  const [wholeRaw, fractionRaw = ""] = trimmed.split(".");
  if (fractionRaw.length > XLM_DECIMALS) {
    throw new StellarAgentError({
      code: "INVALID_AMOUNT",
      message: "Stellar amounts support at most 7 decimal places.",
      exitCode: EXIT_CODES.usage
    });
  }
  return BigInt(wholeRaw ?? "0") * STROOPS_PER_XLM + BigInt(fractionRaw.padEnd(XLM_DECIMALS, "0"));
}

export function expandHome(pathValue: string): string {
  if (pathValue === "~") return homedir();
  if (pathValue.startsWith("~/")) return resolve(homedir(), pathValue.slice(2));
  return pathValue;
}

export function resolvePath(pathValue: string, baseDir = process.cwd()): string {
  const expanded = expandHome(pathValue);
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

export function defaultStorage(rootDir = "~/.stellar-agent"): StorageConfig {
  return {
    rootDir,
    receiptsDir: `${rootDir}/receipts`,
    ledgersDir: `${rootDir}/ledgers`,
    logsDir: `${rootDir}/logs`,
    walletsDir: `${rootDir}/wallets`,
    policiesDir: `${rootDir}/policies`,
    approvalsDir: `${rootDir}/approvals`,
    scenariosDir: `${rootDir}/scenarios`
  };
}

export const TESTNET_PROFILE: NetworkProfile = {
  name: "testnet",
  network: "testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
  defaultAsset: "XLM",
  realFunds: false
};

export const MAINNET_PROFILE: NetworkProfile = {
  name: "mainnet",
  network: "public",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  horizonUrl: "https://horizon.stellar.org",
  rpcUrl: null,
  friendbotUrl: null,
  defaultAsset: "XLM",
  enabled: false,
  requiresExplicitApproval: true,
  realFunds: true
};

export function createDefaultConfig(rootDir = process.env.STELLAR_AGENT_HOME ?? "~/.stellar-agent"): StellarAgentConfig {
  return {
    version: 1,
    activeProfile: "testnet",
    profiles: {
      testnet: TESTNET_PROFILE,
      mainnet: MAINNET_PROFILE
    },
    storage: defaultStorage(rootDir),
    output: {
      color: true,
      json: false,
      redactSensitiveData: true
    }
  };
}

export function mainnetAgentWalletConfigFingerprint(config: StellarAgentConfig): string {
  const clone = JSON.parse(JSON.stringify(config)) as StellarAgentConfig;
  if (clone.mainnetAgentWallet) {
    clone.mainnetAgentWallet.arming = undefined;
    clone.mainnetAgentWallet.spendCounters = undefined;
  }
  return sha256(JSON.stringify(sortJson(clone)));
}

export function mainnetAgentWalletIntegrityFailures(args: {
  wallet: MainnetAgentWalletConfig;
  config: StellarAgentConfig;
  configPath: string;
  policyPath: string;
  policyFingerprint: string;
}): string[] {
  const failures: string[] = [];
  if (!args.wallet.arming) {
    failures.push("arming_metadata_missing");
    return failures;
  }
  if (args.wallet.arming.configPath !== args.configPath) failures.push("config_path_changed");
  if (args.wallet.arming.policyPath !== args.policyPath) failures.push("policy_path_changed");
  if (args.wallet.arming.policyFingerprint !== args.policyFingerprint) failures.push("policy_changed_after_arming");
  if (args.wallet.arming.configFingerprint !== mainnetAgentWalletConfigFingerprint(args.config)) {
    failures.push("config_changed_after_arming");
  }
  return failures;
}

export function assertMainnetAgentWalletPaymentPreflight(args: {
  wallet: MainnetAgentWalletConfig;
  request: PaymentRequest;
  config: StellarAgentConfig;
  configPath: string;
  policyPath: string;
  policyFingerprint: string;
  spendHistory: MainnetAgentWalletSpendHistory;
  balances?: MainnetAgentWalletBalanceLine[] | undefined;
}): void {
  const { wallet, request } = args;
  if (wallet.status !== "armed") {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Mainnet agent-wallet payment workflows require the wallet to be armed.",
      hint: "Run stellar-agent mainnet agent-wallet arm --i-understand-real-funds after setting strict limits.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
  const failures = mainnetAgentWalletIntegrityFailures(args);
  if (failures.length > 0) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet arming is stale and must be refreshed.",
      hint: "Review the config and policy changes, then disarm and arm the wallet again.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet",
      details: { failures }
    });
  }
  assertMainnetAgentWalletRiskBudgetAllows(wallet, request);
  if (args.spendHistory.unreadable) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet spend history could not be read, so payment fails closed.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
  const amount = parseAmount(request.amount, request.asset).value;
  if (amountGreaterThanForAsset(addAmountValues(args.spendHistory.dailyTotal ?? "0", amount, request.asset), wallet.riskBudget.dailyLimit, request.asset)) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet payment would exceed the daily risk budget.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
  if (
    wallet.riskBudget.monthlyLimit &&
    amountGreaterThanForAsset(addAmountValues(args.spendHistory.monthlyTotal ?? "0", amount, request.asset), wallet.riskBudget.monthlyLimit, request.asset)
  ) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet payment would exceed the monthly risk budget.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
  if (args.balances) {
    assertMainnetAgentWalletBalanceWithinBudget(wallet, args.balances);
  }
}

export function assertMainnetAgentWalletRiskBudgetAllows(wallet: MainnetAgentWalletConfig, request: PaymentRequest): void {
  if (!wallet.riskBudget.allowedOperations.includes("payment")) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet policy does not allow payment operations.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
  const requestedAsset = request.asset.toUpperCase();
  if (!mainnetAgentWalletAssetAllowed(requestedAsset, wallet.riskBudget.allowedAssets)) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet payment asset is not allowed.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet",
      details: { requestedAsset, allowedAssets: wallet.riskBudget.allowedAssets }
    });
  }
  if (!wallet.riskBudget.allowedDestinations.includes(request.destination)) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet destination is not allowlisted.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
  const amount = parseAmount(request.amount, request.asset).value;
  if (amountGreaterThanForAsset(amount, wallet.riskBudget.perTxLimit, request.asset)) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet payment exceeds the per-transaction risk budget.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
}

export function assertMainnetAgentWalletBalanceWithinBudget(
  wallet: MainnetAgentWalletConfig,
  balances: MainnetAgentWalletBalanceLine[]
): void {
  if (!wallet.publicKey) {
    throw new StellarAgentError({ code: "WALLET_NOT_FOUND", message: "Mainnet agent wallet public key is missing." });
  }
  for (const asset of wallet.riskBudget.allowedAssets) {
    const matchingBalances = balances.filter((line) => mainnetAgentWalletAssetAllowed(line.asset, [asset]));
    for (const line of matchingBalances.length > 0 ? matchingBalances : [{ asset, balance: "0" }]) {
      if (!amountGreaterThanForAsset(line.balance, wallet.riskBudget.maxBalance, line.asset)) continue;
      throw new StellarAgentError({
        code: "POLICY_DENIED",
        message: "Mainnet agent-wallet balance exceeds the configured risk budget.",
        docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet",
        details: { asset: line.asset, balance: line.balance, maxBalance: wallet.riskBudget.maxBalance }
      });
    }
  }
}

export function mainnetAgentWalletRiskBudgetState(
  wallet: MainnetAgentWalletConfig | undefined,
  before: MainnetAgentWalletSpendHistory,
  payment: PaymentRequest
): { limits: MainnetAgentWalletRiskBudget; before: MainnetAgentWalletSpendHistory; after: MainnetAgentWalletSpendHistory } | undefined {
  if (!wallet) return undefined;
  return {
    limits: wallet.riskBudget,
    before,
    after: incrementMainnetAgentWalletSpendHistory(before, payment)
  };
}

export function mainnetAgentWalletAssetAllowed(asset: string, allowedAssets: string[]): boolean {
  const normalized = asset.toUpperCase();
  return allowedAssets.some((allowed) => {
    const normalizedAllowed = allowed.toUpperCase();
    return normalized === normalizedAllowed || normalized.startsWith(`${normalizedAllowed}:`);
  });
}

function incrementMainnetAgentWalletSpendHistory(
  before: MainnetAgentWalletSpendHistory,
  payment: PaymentRequest
): MainnetAgentWalletSpendHistory {
  const amount = parseAmount(payment.amount, payment.asset).value;
  return {
    ...before,
    dailyTotal: addAmountValues(before.dailyTotal ?? "0", amount, payment.asset),
    monthlyTotal: addAmountValues(before.monthlyTotal ?? "0", amount, payment.asset),
    knownRecipients: Array.from(new Set([...(before.knownRecipients ?? []), payment.destination])),
    knownDomains: payment.domain
      ? Array.from(new Set([...(before.knownDomains ?? []), payment.domain]))
      : before.knownDomains
  };
}

function amountGreaterThanForAsset(left: string, right: string, asset: string): boolean {
  return parseNonnegativeStroops(left, asset) > parseNonnegativeStroops(right, asset);
}

function addAmountValues(left: string, right: string, asset: string): string {
  return formatStroops(parseNonnegativeStroops(left, asset) + parseNonnegativeStroops(right, asset));
}

function parseNonnegativeStroops(value: string, asset: string): bigint {
  if (value === "0" || value === "0.0" || value === "0.0000000") return 0n;
  return parseAmount(stripAssetSuffix(value), asset).stroops;
}

function stripAssetSuffix(value: string): string {
  return value.trim().split(/\s+/)[0] ?? value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortJson(child)]));
}

export const networkProfileSchema = z.object({
  name: z.enum(["testnet", "mainnet", "local"]),
  network: z.enum(["testnet", "public", "local"]),
  networkPassphrase: z.string().min(1),
  horizonUrl: z.string().url().nullable(),
  rpcUrl: z.string().url().nullable(),
  friendbotUrl: z.string().url().nullable(),
  defaultAsset: z.literal("XLM"),
  enabled: z.boolean().optional(),
  requiresExplicitApproval: z.boolean().optional(),
  realFunds: z.boolean()
});

export const storageConfigSchema = z.object({
  rootDir: z.string().min(1),
  receiptsDir: z.string().min(1),
  ledgersDir: z.string().min(1),
  logsDir: z.string().min(1),
  walletsDir: z.string().min(1),
  policiesDir: z.string().min(1),
  approvalsDir: z.string().min(1),
  scenariosDir: z.string().min(1)
});

export const mainnetAgentWalletRiskBudgetSchema = z.object({
  maxBalance: z.string().min(1),
  perTxLimit: z.string().min(1),
  dailyLimit: z.string().min(1),
  monthlyLimit: z.string().min(1).optional(),
  allowedAssets: z.array(z.string().min(1)).default(["XLM"]),
  allowedDestinations: z.array(z.string().min(1)).default([]),
  allowedOperations: z.array(z.string().min(1)).default(["payment"])
});

export const mainnetAgentWalletConfigSchema = z.object({
  schemaVersion: z.literal("stellar-agent.mainnetAgentWallet.v1"),
  walletName: z.string().min(1),
  publicKey: z.string().regex(gAddressPattern).optional(),
  status: z.enum(["unconfigured", "disarmed", "armed"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  riskBudget: mainnetAgentWalletRiskBudgetSchema,
  autosign: z
    .object({
      enabled: z.boolean(),
      secretKeyEnvVar: z.string().min(1),
      enabledAt: z.string().datetime(),
      warningAcknowledgedAt: z.string().datetime()
    })
    .optional(),
  spendCounters: z
    .object({
      updatedAt: z.string().datetime(),
      source: z.literal("receipts"),
      assets: z.record(
        z.object({
          dailyTotal: z.string().optional(),
          monthlyTotal: z.string().optional(),
          knownRecipients: z.array(z.string()).optional(),
          knownDomains: z.array(z.string()).optional(),
          unreadable: z.boolean().optional()
        })
      )
    })
    .optional(),
  arming: z
    .object({
      armedAt: z.string().datetime(),
      configPath: z.string().min(1),
      configFingerprint: z.string().min(1),
      policyPath: z.string().min(1),
      policyFingerprint: z.string().min(1)
    })
    .optional()
});

export const configSchema = z.object({
  version: z.literal(1),
  activeProfile: z.enum(["testnet", "mainnet", "local"]),
  profiles: z.record(networkProfileSchema),
  storage: storageConfigSchema,
  mainnetAgentWallet: mainnetAgentWalletConfigSchema.optional(),
  output: z.object({
    color: z.boolean(),
    json: z.boolean(),
    redactSensitiveData: z.boolean()
  })
});

export const testnetWalletSchema = z.object({
  schemaVersion: z.literal("stellar-agent.wallet.v1"),
  name: z.string().min(1),
  network: z.literal("testnet"),
  publicKey: z.string().regex(gAddressPattern),
  secretKey: z.string().regex(sSecretPattern),
  createdAt: z.string().datetime(),
  source: z.literal("generated-testnet")
});

export type TestnetWallet = z.infer<typeof testnetWalletSchema>;

export const publicWalletSchema = z.object({
  schemaVersion: z.literal("stellar-agent.publicWallet.v1"),
  name: z.string().min(1),
  network: z.enum(["testnet", "mainnet", "local"]),
  publicKey: z.string().regex(gAddressPattern),
  importedAt: z.string().datetime(),
  source: z.literal("watch-only")
});

export type PublicWallet = z.infer<typeof publicWalletSchema>;

export type WalletPublicView =
  | Omit<TestnetWallet, "secretKey"> & { hasSecret: true; source: "generated-testnet" }
  | (PublicWallet & { hasSecret: false });

export const paymentRequestSchema = z.object({
  source: z.string().optional(),
  destination: z.string().regex(gAddressPattern),
  amount: z.string().min(1),
  asset: z.string().default("XLM"),
  memo: z.string().max(28).optional(),
  network: z.enum(["testnet", "mainnet", "local"]).default("testnet"),
  domain: z.string().optional(),
  url: z.string().url().optional(),
  agentWalletAutosign: z.boolean().optional()
});

export type PaymentRequest = z.infer<typeof paymentRequestSchema>;

const sensitiveKeyPattern = /secret|private|seed|password|api[_-]?key|token/i;
const secretLikePattern = /\bS[A-Z2-7]{55}\b/g;
const urlWithQueryPattern = /(https?:\/\/[^\s?#]+)\?([^\s]+)/g;
const publicTokenMetricKeys = new Set([
  "expectedTokens",
  "bTokens",
  "dTokens",
  "supplyBTokens",
  "collateralBTokens",
  "liabilityDTokens",
  "claimedTokens"
]);
const publicSensitiveBooleanKeys = new Set(["secretKeysIncluded", "hasSecret", "secretPrinted"]);

export function redactSensitive<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value
      .replace(secretLikePattern, "[REDACTED_SECRET_KEY]")
      .replace(urlWithQueryPattern, "$1?[REDACTED_QUERY]") as T;
  }
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item)) as T;
  if (typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      redacted[key] =
        publicSensitiveBooleanKeys.has(key) && typeof child === "boolean"
          ? child
          : sensitiveKeyPattern.test(key) && !publicTokenMetricKeys.has(key)
            ? "[REDACTED]"
            : redactSensitive(child);
    }
    return redacted as T;
  }
  return value;
}

export function redactWallet(wallet: TestnetWallet): Omit<TestnetWallet, "secretKey"> & {
  secretKey: "[REDACTED]";
} {
  return { ...wallet, secretKey: "[REDACTED]" };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${random}`;
}

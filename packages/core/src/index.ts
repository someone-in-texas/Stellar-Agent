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
  output: {
    color: boolean;
    json: boolean;
    redactSensitiveData: boolean;
  };
}

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
  | "SECRET_KEY_BLOCKED"
  | "FRIENDBOT_UNAVAILABLE"
  | "RPC_UNAVAILABLE"
  | "HORIZON_UNAVAILABLE"
  | "TRANSACTION_BUILD_FAILED"
  | "TRANSACTION_SUBMIT_FAILED"
  | "TRANSACTION_TIMEOUT"
  | "LEDGER_LOOKUP_FAILED"
  | "X402_NOT_IMPLEMENTED"
  | "MPP_NOT_IMPLEMENTED"
  | "FREIGHTER_NOT_IMPLEMENTED"
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
  if (code === "CONFIG_NOT_FOUND" || code === "PROFILE_NOT_FOUND" || code === "INVALID_INPUT") {
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
      ...(error.hint ? { hint: error.hint } : {}),
      ...(error.docs ? { docs: error.docs } : {}),
      ...(error.details !== undefined ? { details: redactSensitive(error.details) } : {})
    };
  }
  if (error instanceof Error) {
    return { code: "UNKNOWN_ERROR", message: error.message };
  }
  return { code: "UNKNOWN_ERROR", message: "Unknown error.", details: redactSensitive(error) };
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

export const configSchema = z.object({
  version: z.literal(1),
  activeProfile: z.enum(["testnet", "mainnet", "local"]),
  profiles: z.record(networkProfileSchema),
  storage: storageConfigSchema,
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

export const paymentRequestSchema = z.object({
  source: z.string().optional(),
  destination: z.string().regex(gAddressPattern),
  amount: z.string().min(1),
  asset: z.string().default("XLM"),
  memo: z.string().max(28).optional(),
  network: z.enum(["testnet", "mainnet", "local"]).default("testnet"),
  domain: z.string().optional(),
  url: z.string().url().optional()
});

export type PaymentRequest = z.infer<typeof paymentRequestSchema>;

const sensitiveKeyPattern = /secret|private|seed|password|api[_-]?key|token/i;
const secretLikePattern = /\bS[A-Z2-7]{55}\b/g;
const urlWithQueryPattern = /(https?:\/\/[^\s?#]+)\?([^\s]+)/g;

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
      redacted[key] = sensitiveKeyPattern.test(key) ? "[REDACTED]" : redactSensitive(child);
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

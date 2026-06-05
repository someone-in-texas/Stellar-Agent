import {
  MAINNET_PROFILE,
  PaymentRequest,
  StellarAgentError,
  amountIsGreaterThan,
  parseAmount,
  parseAsset,
  paymentRequestSchema,
  redactSensitive
} from "@stellar-agent/core";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export type PolicyDecisionStatus = "allowed" | "denied" | "requires_approval";
export type DefiBlendRequestType =
  | "supply"
  | "withdraw"
  | "supply_collateral"
  | "withdraw_collateral"
  | "borrow"
  | "repay";

export interface PolicyDecision {
  status: PolicyDecisionStatus;
  network: "testnet" | "mainnet" | "local";
  realFunds: boolean;
  matchedRules: string[];
  reasons: string[];
  approval?: {
    required: boolean;
    reason: string;
  };
}

export interface SpendHistory {
  dailyTotal?: string;
  monthlyTotal?: string;
  knownRecipients?: string[];
  knownDomains?: string[];
  unreadable?: boolean;
}

export interface DefiBlendPolicyRequest {
  network: "testnet" | "mainnet" | "local";
  pool: string;
  requestTypes: DefiBlendRequestType[];
  borrowValue?: string;
  protocolExposureValue?: string;
  healthFactorAfter?: number | null;
}

const defiBlendRequestTypeSchema = z.enum([
  "supply",
  "withdraw",
  "supply_collateral",
  "withdraw_collateral",
  "borrow",
  "repay"
]);

const defiPolicySchema = z
  .object({
    blend: z
      .object({
        enabled: z.boolean().default(false),
        allowedPools: z.array(z.string().min(1)).default([]),
        allowedRequestTypes: z.array(defiBlendRequestTypeSchema).default([]),
        maxBorrowValue: z.string().min(1).default("0"),
        maxProtocolExposureValue: z.string().min(1).default("0"),
        minimumHealthFactor: z.number().positive().default(1.25),
        requireSimulation: z.boolean().default(true)
      })
      .default({
        enabled: false,
        allowedPools: [],
        allowedRequestTypes: [],
        maxBorrowValue: "0",
        maxProtocolExposureValue: "0",
        minimumHealthFactor: 1.25,
        requireSimulation: true
      })
  })
  .default({
    blend: {
      enabled: false,
      allowedPools: [],
      allowedRequestTypes: [],
      maxBorrowValue: "0",
      maxProtocolExposureValue: "0",
      minimumHealthFactor: 1.25,
      requireSimulation: true
    }
  });

export const policySchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  network: z.enum(["testnet", "mainnet", "local"]),
  assets: z.object({
    allow: z.array(z.string().min(1)).default(["XLM"])
  }),
  limits: z.object({
    perTransaction: z.string().min(1),
    dailyTotal: z.string().min(1),
    monthlyTotal: z.string().min(1)
  }),
  approval: z.object({
    requireForAllPayments: z.boolean().default(false),
    requireForNewRecipient: z.boolean().default(false),
    requireForNewDomain: z.boolean().default(false),
    requireAbove: z.string().min(1)
  }),
  x402: z
    .object({
      enabled: z.boolean().default(false),
      allowDomains: z.array(z.string()).default([]),
      maxPricePerRequest: z.string().min(1).default("1 XLM"),
      bindPaymentToUrl: z.boolean().default(true),
      denyRedirectPaymentChanges: z.boolean().default(true)
    })
    .default({
      enabled: false,
      allowDomains: [],
      maxPricePerRequest: "1 XLM",
      bindPaymentToUrl: true,
      denyRedirectPaymentChanges: true
    }),
  safety: z
    .object({
      simulationRequired: z.boolean().default(false),
      explainTransactionRequired: z.boolean().default(true),
      blockBlindSigning: z.boolean().default(true),
      blockOpaqueTransactions: z.boolean().default(true)
    })
    .optional(),
  defi: defiPolicySchema,
  privacy: z.object({
    redactUrlQueryParamsInLogs: z.boolean().default(true),
    blockPiiInReason: z.boolean().default(true),
    blockedMemoPatterns: z.array(z.string()).default(["ssn", "password", "secret", "api_key"])
  }),
  logging: z.object({
    writeReceipts: z.boolean().default(true),
    writeEventLog: z.boolean().default(true)
  })
});

export type Policy = z.infer<typeof policySchema>;

export const DEFAULT_TESTNET_POLICY: Policy = {
  version: 1,
  name: "default-testnet-policy",
  network: "testnet",
  assets: { allow: ["XLM"] },
  limits: {
    perTransaction: "10 XLM",
    dailyTotal: "100 XLM",
    monthlyTotal: "1000 XLM"
  },
  approval: {
    requireForAllPayments: false,
    requireForNewRecipient: false,
    requireForNewDomain: false,
    requireAbove: "5 XLM"
  },
  x402: {
    enabled: false,
    allowDomains: [],
    maxPricePerRequest: "1 XLM",
    bindPaymentToUrl: true,
    denyRedirectPaymentChanges: true
  },
  defi: {
    blend: {
      enabled: true,
      allowedPools: ["*"],
      allowedRequestTypes: ["supply", "withdraw", "supply_collateral", "withdraw_collateral", "repay"],
      maxBorrowValue: "0",
      maxProtocolExposureValue: "1000",
      minimumHealthFactor: 1.5,
      requireSimulation: true
    }
  },
  privacy: {
    redactUrlQueryParamsInLogs: true,
    blockPiiInReason: true,
    blockedMemoPatterns: ["ssn", "password", "secret", "api_key"]
  },
  logging: {
    writeReceipts: true,
    writeEventLog: true
  }
};

export const DEFAULT_MAINNET_POLICY: Policy = {
  version: 1,
  name: "default-mainnet-policy",
  network: "mainnet",
  assets: { allow: ["XLM", "USDC"] },
  limits: {
    perTransaction: "0.05 XLM",
    dailyTotal: "0.25 XLM",
    monthlyTotal: "1 XLM"
  },
  approval: {
    requireForAllPayments: true,
    requireForNewRecipient: true,
    requireForNewDomain: true,
    requireAbove: "0 XLM"
  },
  x402: {
    enabled: false,
    allowDomains: [],
    maxPricePerRequest: "0.05 XLM",
    bindPaymentToUrl: true,
    denyRedirectPaymentChanges: true
  },
  safety: {
    simulationRequired: true,
    explainTransactionRequired: true,
    blockBlindSigning: true,
    blockOpaqueTransactions: true
  },
  defi: {
    blend: {
      enabled: false,
      allowedPools: [],
      allowedRequestTypes: [],
      maxBorrowValue: "0",
      maxProtocolExposureValue: "0",
      minimumHealthFactor: 2,
      requireSimulation: true
    }
  },
  privacy: {
    redactUrlQueryParamsInLogs: true,
    blockPiiInReason: true,
    blockedMemoPatterns: ["ssn", "password", "secret", "api_key"]
  },
  logging: {
    writeReceipts: true,
    writeEventLog: true
  }
};

export function parsePolicyYaml(source: string): Policy {
  try {
    return policySchema.parse(parseYaml(source));
  } catch (error) {
    throw new StellarAgentError({
      code: "POLICY_INVALID",
      message: "Policy file is invalid.",
      hint: "Run stellar-agent policy check to inspect validation failures.",
      docs: "docs/troubleshooting.md#policy-denied",
      details: error
    });
  }
}

export function policyToYaml(policy: Policy): string {
  return stringifyYaml(policy);
}

export function defaultPolicyForNetwork(network: "testnet" | "mainnet" | "local"): Policy {
  if (network === "mainnet") return DEFAULT_MAINNET_POLICY;
  return DEFAULT_TESTNET_POLICY;
}

export function evaluatePaymentRequest(
  policyInput: Policy,
  requestInput: PaymentRequest,
  history: SpendHistory = {}
): PolicyDecision {
  const policy = policySchema.parse(policyInput);
  const request = paymentRequestSchema.parse(requestInput);
  const decision: PolicyDecision = {
    status: "allowed",
    network: policy.network,
    realFunds: policy.network === "mainnet" || MAINNET_PROFILE.name === policy.network,
    matchedRules: [],
    reasons: []
  };

  const deny = (rule: string, reason: string) => {
    decision.status = "denied";
    decision.matchedRules.push(rule);
    decision.reasons.push(reason);
  };

  const requireApproval = (rule: string, reason: string) => {
    if (decision.status !== "denied") {
      decision.status = "requires_approval";
      decision.approval ??= { required: true, reason: rule };
    }
    decision.matchedRules.push(rule);
    decision.reasons.push(reason);
  };

  const note = (rule: string, reason: string) => {
    decision.matchedRules.push(rule);
    decision.reasons.push(reason);
  };

  let normalizedAmount: string;
  try {
    normalizedAmount = parseAmount(stripAssetSuffix(request.amount), request.asset).value;
    parseAsset(request.asset);
  } catch (error) {
    deny("invalid_payment_request", error instanceof Error ? error.message : "Invalid payment request.");
    return sanitizeDecision(policy, decision);
  }

  const requestedAsset = request.asset.toUpperCase();
  if (!policy.assets.allow.map((asset) => asset.toUpperCase()).includes(requestedAsset)) {
    deny("asset_not_allowed", `Asset ${requestedAsset} is not allowed by policy.`);
  } else {
    note("asset_allowed", `Asset ${requestedAsset} is allowed by policy.`);
  }

  if (amountIsGreaterThan(normalizedAmount, stripAssetSuffix(policy.limits.perTransaction))) {
    deny("amount_over_per_transaction_limit", "Payment exceeds the per-transaction policy limit.");
  } else {
    note("amount_under_hard_limit", "Payment is under the per-transaction limit.");
  }

  if (history.unreadable) {
    deny("spend_history_unreadable", "Local spend history could not be read, so payment fails closed.");
  }

  if (
    history.dailyTotal &&
    amountIsGreaterThan(
      addAmountStrings(history.dailyTotal, normalizedAmount),
      stripAssetSuffix(policy.limits.dailyTotal)
    )
  ) {
    deny("daily_total_limit_exceeded", "Payment would exceed the daily total policy limit.");
  }

  if (
    history.monthlyTotal &&
    amountIsGreaterThan(
      addAmountStrings(history.monthlyTotal, normalizedAmount),
      stripAssetSuffix(policy.limits.monthlyTotal)
    )
  ) {
    deny("monthly_total_limit_exceeded", "Payment would exceed the monthly total policy limit.");
  }

  if (containsBlockedMemo(request.memo, policy)) {
    deny("memo_blocked_sensitive_pattern", "Payment memo contains a blocked sensitive pattern.");
  }

  if (request.domain) {
    if (!policy.x402.enabled) {
      deny("x402_or_domain_payments_disabled", "Domain-bound payments are disabled by policy.");
    } else if (
      policy.x402.allowDomains.length > 0 &&
      !policy.x402.allowDomains.includes(request.domain)
    ) {
      deny("domain_not_allowlisted", "The requested payment domain is not allowlisted.");
    } else if (amountIsGreaterThan(normalizedAmount, stripAssetSuffix(policy.x402.maxPricePerRequest))) {
      deny("x402_price_over_limit", "The requested x402 payment exceeds the max price per request.");
    } else {
      note("x402_domain_allowed", "Domain-bound payment is enabled and within the x402 price limit.");
    }
  }

  if (policy.approval.requireForAllPayments) {
    requireApproval("approval_required_for_all_payments", "Policy requires approval for all payments.");
  }

  if (amountIsGreaterThan(normalizedAmount, stripAssetSuffix(policy.approval.requireAbove))) {
    requireApproval(
      "amount_above_auto_approval_threshold",
      "Payment is above the auto-approval threshold."
    );
  }

  if (
    policy.approval.requireForNewRecipient &&
    !history.knownRecipients?.includes(request.destination)
  ) {
    requireApproval("new_recipient_requires_approval", "Recipient has no prior approved receipt.");
  }

  if (request.domain && policy.approval.requireForNewDomain && !history.knownDomains?.includes(request.domain)) {
    requireApproval("new_domain_requires_approval", "Domain has no prior approved receipt.");
  }

  if (policy.network === "mainnet") {
    requireApproval("mainnet_requires_approval", "Mainnet payments require explicit approval.");
  }

  if (decision.status === "allowed") {
    note("policy_allowed", "Policy allows this payment without additional approval.");
  }

  return sanitizeDecision(policy, decision);
}

export function evaluateDefiBlendRequest(policyInput: Policy, request: DefiBlendPolicyRequest): PolicyDecision {
  const policy = policySchema.parse(policyInput);
  const decision: PolicyDecision = {
    status: "allowed",
    network: policy.network,
    realFunds: policy.network === "mainnet" || request.network === "mainnet",
    matchedRules: [],
    reasons: []
  };
  const blend = policy.defi.blend;
  const deny = (rule: string, reason: string) => {
    decision.status = "denied";
    decision.matchedRules.push(rule);
    decision.reasons.push(reason);
  };
  const requireApproval = (rule: string, reason: string) => {
    if (decision.status !== "denied") {
      decision.status = "requires_approval";
      decision.approval ??= { required: true, reason: rule };
    }
    decision.matchedRules.push(rule);
    decision.reasons.push(reason);
  };
  const note = (rule: string, reason: string) => {
    decision.matchedRules.push(rule);
    decision.reasons.push(reason);
  };

  if (!blend.enabled) {
    deny("defi_blend_disabled", "Blend DeFi requests are disabled by policy.");
  } else {
    note("defi_blend_enabled", "Blend DeFi requests are enabled by policy.");
  }

  const allowedPools = blend.allowedPools.map((pool) => pool.toUpperCase());
  if (!allowedPools.includes("*") && !allowedPools.includes(request.pool.toUpperCase())) {
    deny("defi_blend_pool_not_allowed", "Blend pool is not allowed by policy.");
  } else {
    note("defi_blend_pool_allowed", "Blend pool is allowed by policy.");
  }

  for (const requestType of request.requestTypes) {
    if (!blend.allowedRequestTypes.includes(requestType)) {
      deny("defi_blend_request_type_not_allowed", `Blend request type ${requestType} is not allowed by policy.`);
    }
  }
  if (request.requestTypes.every((requestType) => blend.allowedRequestTypes.includes(requestType))) {
    note("defi_blend_request_types_allowed", "Blend request types are allowed by policy.");
  }

  const borrowValue = parsePolicyNumber(request.borrowValue ?? "0", "borrow value");
  const maxBorrowValue = parsePolicyNumber(blend.maxBorrowValue, "max borrow value");
  if (borrowValue > maxBorrowValue) {
    deny("defi_blend_borrow_over_limit", "Blend borrow value exceeds the policy limit.");
  }

  const exposureValue = parsePolicyNumber(request.protocolExposureValue ?? "0", "protocol exposure value");
  const maxExposureValue = parsePolicyNumber(blend.maxProtocolExposureValue, "max protocol exposure value");
  if (exposureValue > maxExposureValue) {
    deny("defi_blend_exposure_over_limit", "Blend protocol exposure would exceed the policy limit.");
  }

  if (request.healthFactorAfter !== undefined && request.healthFactorAfter !== null) {
    if (request.healthFactorAfter < blend.minimumHealthFactor) {
      deny("defi_blend_health_factor_too_low", "Blend health factor would be below the policy minimum.");
    } else {
      note("defi_blend_health_factor_ok", "Blend health factor is above the policy minimum.");
    }
  }

  if (decision.realFunds) {
    requireApproval("defi_blend_mainnet_requires_approval", "Mainnet Blend requests require explicit approval.");
  }

  if (decision.status === "allowed") {
    note("policy_allowed", "Blend DeFi request is allowed by policy.");
  }

  return sanitizeDecision(policy, decision);
}

function sanitizeDecision(policy: Policy, decision: PolicyDecision): PolicyDecision {
  if (!policy.privacy.redactUrlQueryParamsInLogs) return decision;
  return {
    ...decision,
    reasons: decision.reasons.map((reason) => redactSensitive(reason))
  };
}

function containsBlockedMemo(memo: string | undefined, policy: Policy): boolean {
  if (!memo) return false;
  const lowered = memo.toLowerCase();
  return policy.privacy.blockedMemoPatterns.some((pattern) => lowered.includes(pattern.toLowerCase()));
}

function parsePolicyNumber(input: string, label: string): number {
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0) {
    throw new StellarAgentError({
      code: "POLICY_INVALID",
      message: `Invalid ${label} in policy.`,
      docs: "docs/troubleshooting.md#policy-denied"
    });
  }
  return value;
}

function stripAssetSuffix(amount: string): string {
  return amount.trim().split(/\s+/)[0] ?? amount;
}

function addAmountStrings(a: string, b: string): string {
  const left = parseNonNegativeAmount(stripAssetSuffix(a));
  const right = parseNonNegativeAmount(stripAssetSuffix(b));
  const sum = left + right;
  const whole = sum / 10_000_000n;
  const fraction = (sum % 10_000_000n).toString().padStart(7, "0");
  return `${whole}.${fraction}`;
}

function parseNonNegativeAmount(input: string): bigint {
  const trimmed = input.trim();
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) {
    throw new StellarAgentError({
      code: "INVALID_AMOUNT",
      message: "Amount must be a decimal string."
    });
  }
  const [wholeRaw, fractionRaw = ""] = trimmed.split(".");
  if (fractionRaw.length > 7) {
    throw new StellarAgentError({
      code: "INVALID_AMOUNT",
      message: "Stellar amounts support at most 7 decimal places."
    });
  }
  return BigInt(wholeRaw ?? "0") * 10_000_000n + BigInt(fractionRaw.padEnd(7, "0"));
}

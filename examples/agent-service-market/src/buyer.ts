import { TestnetWallet, fail, ok, StellarAgentError } from "@stellar-agent/core";
import { latestReceipt } from "@stellar-agent/ledger-logger";
import { DEFAULT_TESTNET_POLICY, Policy } from "@stellar-agent/policy";
import { SpendHistory } from "@stellar-agent/policy";
import { runX402Payment } from "@stellar-agent/x402-client";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ServiceDirectory, ServiceListing } from "./seller.js";

export const buyerWallet: TestnetWallet = {
  schemaVersion: "stellar-agent.wallet.v1",
  name: "buyer-agent",
  network: "testnet",
  publicKey: "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  secretKey: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  createdAt: "2026-06-01T00:00:00.000Z",
  source: "generated-testnet"
};

export async function discoverSellerServices(directoryUrl: string, fetchImpl: typeof fetch = fetch): Promise<ServiceDirectory> {
  const response = await fetchImpl(directoryUrl);
  if (!response.ok) {
    throw new StellarAgentError({
      code: "X402_RESOURCE_UNAVAILABLE",
      message: "Could not load seller service directory."
    });
  }
  const directory = (await response.json()) as ServiceDirectory;
  if (!Array.isArray(directory.services) || directory.services.length === 0) {
    throw new StellarAgentError({ code: "INVALID_INPUT", message: "Seller directory did not list any services." });
  }
  return directory;
}

export function buyerPolicyForService(service: ServiceListing, overrides: Partial<Policy> = {}): Policy {
  return {
    ...DEFAULT_TESTNET_POLICY,
    ...overrides,
    limits: {
      ...DEFAULT_TESTNET_POLICY.limits,
      perTransaction: "0.001 XLM",
      dailyTotal: "0.002 XLM",
      monthlyTotal: "0.01 XLM",
      ...(overrides.limits ?? {})
    },
    x402: {
      ...DEFAULT_TESTNET_POLICY.x402,
      enabled: true,
      allowDomains: [new URL(service.endpoint).host],
      maxPricePerRequest: "0.001 XLM",
      ...(overrides.x402 ?? {})
    }
  };
}

export async function buyDiscoveredService(args: {
  directoryUrl: string;
  serviceId?: string;
  rootDir?: string;
  policy?: Policy;
  spendHistory?: SpendHistory;
}) {
  const directory = await discoverSellerServices(args.directoryUrl);
  const service = directory.services.find((candidate) => candidate.id === (args.serviceId ?? "premium-summary"));
  if (!service) {
    throw new StellarAgentError({ code: "INVALID_INPUT", message: "Requested seller service was not found." });
  }
  const root = resolve(args.rootDir ?? process.env.STELLAR_AGENT_MARKET_ROOT ?? ".stellar-agent-service-market");
  const receiptsDir = join(root, "receipts");
  const eventLog = join(root, "logs", "events.jsonl");
  await mkdir(receiptsDir, { recursive: true });
  const result = await runX402Payment({
    url: service.endpoint,
    source: buyerWallet,
    policy: args.policy ?? buyerPolicyForService(service),
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
    receiptsDir,
    eventLog,
    command: "examples/agent-service-market buyer",
    spendHistory: args.spendHistory,
    sendPaymentImpl: async () => ({
      hash: "market".padEnd(64, "0"),
      ledger: 54321,
      successful: true,
      feeCharged: "100"
    })
  });
  return {
    directory,
    service,
    result,
    latestReceipt: await latestReceipt(receiptsDir)
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const directoryUrl = process.argv[2] ?? "http://127.0.0.1:8790/.well-known/agent-service.json";
  try {
    console.log(JSON.stringify(ok(await buyDiscoveredService({ directoryUrl })), null, 2));
  } catch (error) {
    const normalized =
      error instanceof StellarAgentError
        ? error
        : new StellarAgentError({
            code: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : "Unknown buyer error."
          });
    console.log(JSON.stringify(fail(normalized), null, 2));
    process.exitCode = normalized.exitCode;
  }
}

import { StellarAgentError, TestnetWallet, fail, ok } from "@stellar-agent/core";
import { latestReceipt } from "@stellar-agent/ledger-logger";
import { DEFAULT_TESTNET_POLICY, Policy } from "@stellar-agent/policy";
import { runX402Payment } from "@stellar-agent/x402-client";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const exampleWallet: TestnetWallet = {
  schemaVersion: "stellar-agent.wallet.v1",
  name: "buyer-agent",
  network: "testnet",
  publicKey: "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  secretKey: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  createdAt: "2026-06-01T00:00:00.000Z",
  source: "generated-testnet"
};

export function allowX402DomainPolicy(domain: string, overrides: Partial<Policy> = {}): Policy {
  return {
    ...DEFAULT_TESTNET_POLICY,
    ...overrides,
    x402: {
      ...DEFAULT_TESTNET_POLICY.x402,
      enabled: true,
      allowDomains: [domain],
      maxPricePerRequest: "0.001 XLM",
      ...(overrides.x402 ?? {})
    }
  };
}

export async function payForResource(args: {
  url: string;
  rootDir?: string;
  policy?: Policy;
  dryRun?: boolean;
}) {
  const root = resolve(args.rootDir ?? process.env.STELLAR_AGENT_EXAMPLE_ROOT ?? ".stellar-agent-x402-example");
  const receiptsDir = join(root, "receipts");
  const eventLog = join(root, "logs", "events.jsonl");
  await mkdir(receiptsDir, { recursive: true });
  const domain = new URL(args.url).host;
  const result = await runX402Payment({
    url: args.url,
    source: exampleWallet,
    policy: args.policy ?? allowX402DomainPolicy(domain),
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
    command: "examples/x402-paid-api client",
    dryRun: args.dryRun,
    sendPaymentImpl: async () => ({
      hash: "x402".padEnd(64, "0"),
      ledger: 12345,
      successful: true,
      feeCharged: "100"
    })
  });
  const latest = await latestReceipt(receiptsDir);
  return { result, latestReceipt: latest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] ?? "http://127.0.0.1:8787/paid";
  try {
    console.log(
      JSON.stringify(
        ok({
          url,
          ...(await payForResource({ url }))
        }),
        null,
        2
      )
    );
  } catch (error) {
    const normalized =
      error instanceof StellarAgentError
        ? error
        : new StellarAgentError({
            code: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : "Unknown x402 example client error."
          });
    console.log(JSON.stringify(fail(normalized), null, 2));
    process.exitCode = normalized.exitCode;
  }
}

import {
  NetworkProfile,
  StellarAgentConfig,
  StellarAgentError,
  TESTNET_PROFILE,
  TestnetWallet,
  createDefaultConfig,
  parseAmount,
  redactWallet,
  resolvePath,
  testnetWalletSchema
} from "@stellar-agent/core";
import { appendEvent, writeReceipt } from "@stellar-agent/ledger-logger";
import {
  DEFAULT_TESTNET_POLICY,
  Policy,
  evaluatePaymentRequest,
  policyToYaml
} from "@stellar-agent/policy";
import {
  createTestnetWallet,
  fundWithFriendbot,
  getBalances,
  sendNativePayment
} from "@stellar-agent/stellar";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify } from "yaml";

export interface TestnetHarness {
  config: StellarAgentConfig;
  profile: NetworkProfile;
  ensureInitialized(options?: { fund?: boolean; overwritePolicy?: boolean }): Promise<TestnetInitResult>;
  loadWallet(name: "agent" | "merchant" | "auditor"): Promise<TestnetWallet>;
  runPolicyDeniedScenario(): Promise<{ decision: ReturnType<typeof evaluatePaymentRequest> }>;
  runApprovalRequiredScenario(options?: {
    approveTestnet?: boolean;
    autoDeny?: boolean;
  }): Promise<{ decision: ReturnType<typeof evaluatePaymentRequest>; receiptPath?: string }>;
  runBasicPayment(options?: { amount?: string; memo?: string; dryRun?: boolean }): Promise<BasicPaymentResult>;
}

export interface TestnetInitResult {
  rootDir: string;
  wallets: Record<string, ReturnType<typeof redactWallet>>;
  funded: boolean;
  policyPath: string;
  configPath: string;
}

export interface BasicPaymentResult {
  receiptPath?: string;
  transaction?: {
    hash: string;
    ledger?: number;
    successful: boolean;
    feeCharged?: string;
  };
  decision: ReturnType<typeof evaluatePaymentRequest>;
  dryRun: boolean;
}

export function createTestnetHarness(config = createDefaultConfig()): TestnetHarness {
  const profile = TESTNET_PROFILE;
  const resolvedConfig = resolveConfigPaths(config);

  return {
    config: resolvedConfig,
    profile,
    async ensureInitialized(options = {}) {
      return initTestnetWorkspace(resolvedConfig, options);
    },
    async loadWallet(name) {
      return loadWallet(resolvedConfig, name);
    },
    async runPolicyDeniedScenario() {
      await appendScenarioEvent(resolvedConfig, "policy_decision", "started");
      const merchant = await loadWallet(resolvedConfig, "merchant");
      const decision = evaluatePaymentRequest(DEFAULT_TESTNET_POLICY, {
        destination: merchant.publicKey,
        amount: "11",
        asset: "XLM",
        network: "testnet"
      });
      await appendScenarioEvent(resolvedConfig, "policy_decision", decision.status, { decision });
      return { decision };
    },
    async runApprovalRequiredScenario(options = {}) {
      const agent = await loadWallet(resolvedConfig, "agent");
      const merchant = await loadWallet(resolvedConfig, "merchant");
      const decision = evaluatePaymentRequest(DEFAULT_TESTNET_POLICY, {
        source: agent.publicKey,
        destination: merchant.publicKey,
        amount: "6",
        asset: "XLM",
        network: "testnet"
      });
      await appendScenarioEvent(resolvedConfig, "policy_decision", decision.status, { decision });
      if (decision.status !== "requires_approval" || options.autoDeny || !options.approveTestnet) {
        return { decision };
      }
      const payment = await runPayment(resolvedConfig, DEFAULT_TESTNET_POLICY, {
        amount: "6",
        memo: "approval scenario"
      });
      return payment.receiptPath ? { decision, receiptPath: payment.receiptPath } : { decision };
    },
    async runBasicPayment(options = {}) {
      return runPayment(resolvedConfig, DEFAULT_TESTNET_POLICY, options);
    }
  };
}

export async function initTestnetWorkspace(
  config = createDefaultConfig(),
  options: { fund?: boolean; overwritePolicy?: boolean } = {}
): Promise<TestnetInitResult> {
  const resolved = resolveConfigPaths(config);
  await Promise.all(Object.values(resolved.storage).map((path) => mkdir(path, { recursive: true })));

  const wallets: Record<string, ReturnType<typeof redactWallet>> = {};
  for (const name of ["agent", "merchant", "auditor"] as const) {
    const wallet = await ensureWallet(resolved, name);
    wallets[name] = redactWallet(wallet);
    if (options.fund !== false && (name === "agent" || name === "merchant")) {
      await fundWithFriendbot(wallet.publicKey, TESTNET_PROFILE);
    }
  }

  const policyPath = join(resolved.storage.policiesDir, "default-testnet.yaml");
  if (options.overwritePolicy) {
    await writeFile(policyPath, policyToYaml(DEFAULT_TESTNET_POLICY), { mode: 0o600 });
  } else {
    await writeIfMissing(policyPath, policyToYaml(DEFAULT_TESTNET_POLICY), 0o600);
  }

  const configPath = join(resolved.storage.rootDir, "config.yaml");
  await writeIfMissing(configPath, stringify(resolved), 0o600);
  await writeIfMissing(
    join(resolved.storage.rootDir, "README.md"),
    "# Stellar Agent local Testnet workspace\n\nThis directory stores Testnet-only wallets, policies, logs, and receipts. Never reuse these keys on Mainnet.\n",
    0o600
  );

  return {
    rootDir: resolved.storage.rootDir,
    wallets,
    funded: options.fund !== false,
    policyPath,
    configPath
  };
}

async function runPayment(
  config: StellarAgentConfig,
  policy: Policy,
  options: { amount?: string; memo?: string; dryRun?: boolean } = {}
): Promise<BasicPaymentResult> {
  const agent = await loadWallet(config, "agent");
  const merchant = await loadWallet(config, "merchant");
  const amount = parseAmount(options.amount ?? "1").value;
  const request = {
    source: agent.publicKey,
    destination: merchant.publicKey,
    amount,
    asset: "XLM",
    memo: options.memo ?? "stellar-agent smoke test",
    network: "testnet" as const
  };
  const decision = evaluatePaymentRequest(policy, request);
  const eventLog = join(config.storage.logsDir, "events.jsonl");
  await appendEvent(eventLog, {
    event: "policy_decision",
    status: decision.status,
    command: "testnet smoke-test",
    profile: "testnet",
    data: { request, decision }
  });

  if (decision.status === "denied") {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Payment request was denied by policy.",
      hint: "Run policy explain to inspect the matched rules.",
      docs: "docs/troubleshooting.md#policy-denied"
    });
  }
  if (decision.status === "requires_approval") {
    throw new StellarAgentError({
      code: "APPROVAL_REQUIRED",
      message: "Payment requires approval.",
      hint: "Use an explicit approval flow before submitting the payment.",
      docs: "docs/mainnet-safety.md"
    });
  }

  if (options.dryRun) {
    return { decision, dryRun: true };
  }

  const transaction = await sendNativePayment({
    source: agent,
    destination: merchant.publicKey,
    amount,
    memo: request.memo,
    profile: TESTNET_PROFILE
  });
  await appendEvent(eventLog, {
    event: "transaction_confirmed",
    status: "successful",
    command: "testnet smoke-test",
    profile: "testnet",
    data: transaction
  });
  const { path: receiptPath } = await writeReceipt(config.storage.receiptsDir, {
    command: "testnet smoke-test",
    profile: "testnet",
    networkPassphrase: TESTNET_PROFILE.networkPassphrase,
    realFunds: false,
    payment: {
      source: agent.publicKey,
      destination: merchant.publicKey,
      asset: "XLM",
      amount,
      memo: request.memo
    },
    policyDecision: decision,
    transaction,
    ...(transaction.ledger === undefined ? {} : { ledger: { confirmedLedger: transaction.ledger } }),
    eventLog
  });
  await appendEvent(eventLog, {
    event: "receipt_written",
    status: "success",
    command: "testnet smoke-test",
    profile: "testnet",
    data: { receiptPath }
  });
  return { decision, transaction, receiptPath, dryRun: false };
}

export async function ensureWallet(
  config: StellarAgentConfig,
  name: "agent" | "merchant" | "auditor"
): Promise<TestnetWallet> {
  const path = walletPath(config, name);
  try {
    return await loadWallet(config, name);
  } catch (error) {
    if (!(error instanceof StellarAgentError) || error.code !== "WALLET_NOT_FOUND") throw error;
  }
  const wallet = createTestnetWallet(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(wallet, null, 2)}\n`, { mode: 0o600 });
  return wallet;
}

export async function loadWallet(
  config: StellarAgentConfig,
  name: "agent" | "merchant" | "auditor"
): Promise<TestnetWallet> {
  const path = walletPath(config, name);
  try {
    const raw = await readFile(path, "utf8");
    return testnetWalletSchema.parse(JSON.parse(raw));
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new StellarAgentError({
        code: "WALLET_NOT_FOUND",
        message: `Testnet wallet '${name}' was not found.`,
        hint: "Run stellar-agent testnet init first.",
        docs: "docs/quickstart-testnet.md"
      });
    }
    throw new StellarAgentError({
      code: "WALLET_INVALID",
      message: `Testnet wallet '${name}' is invalid.`,
      docs: "docs/troubleshooting.md#invalid-wallet",
      details: error
    });
  }
}

export async function walletBalances(config: StellarAgentConfig, name: "agent" | "merchant" | "auditor") {
  const wallet = await loadWallet(config, name);
  return getBalances(wallet.publicKey, TESTNET_PROFILE);
}

function walletPath(config: StellarAgentConfig, name: string): string {
  return join(config.storage.walletsDir, `testnet-${name}.json`);
}

function resolveConfigPaths(config: StellarAgentConfig): StellarAgentConfig {
  const storageEntries = Object.entries(config.storage).map(([key, value]) => [key, resolvePath(value)]);
  return {
    ...config,
    storage: Object.fromEntries(storageEntries) as StellarAgentConfig["storage"]
  };
}

async function writeIfMissing(path: string, body: string, mode: number): Promise<void> {
  try {
    await readFile(path, "utf8");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { mode });
  }
}

async function appendScenarioEvent(
  config: StellarAgentConfig,
  event: "policy_decision",
  status: string,
  data?: unknown
): Promise<void> {
  await appendEvent(join(config.storage.logsDir, "events.jsonl"), {
    event,
    status,
    command: "testnet scenario",
    profile: "testnet",
    data
  });
}

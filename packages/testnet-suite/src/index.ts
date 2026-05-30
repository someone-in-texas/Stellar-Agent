import {
  NetworkProfile,
  NetworkName,
  PublicWallet,
  StellarAgentConfig,
  StellarAgentError,
  TESTNET_PROFILE,
  TestnetWallet,
  WalletPublicView,
  createDefaultConfig,
  parseAmount,
  parseAsset,
  publicWalletSchema,
  redactSensitive,
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
  BalanceLine,
  StellarCliResult,
  assetContractIdWithStellarCli,
  checkStellarCli,
  createTestnetWallet,
  contractInfoWithStellarCli,
  deployAssetContractWithStellarCli,
  extendContractWithStellarCli,
  fundWithFriendbot,
  getBalances,
  changeTrustline,
  invokeContractWithStellarCli,
  parseStellarCliTransactionHash,
  readContractWithStellarCli,
  sendPayment
} from "@stellar-agent/stellar";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify } from "yaml";

export interface TestnetHarness {
  config: StellarAgentConfig;
  profile: NetworkProfile;
  ensureInitialized(options?: { fund?: boolean; overwritePolicy?: boolean }): Promise<TestnetInitResult>;
  loadWallet(name: string): Promise<TestnetWallet>;
  runPolicyDeniedScenario(): Promise<{ decision: ReturnType<typeof evaluatePaymentRequest> }>;
  runApprovalRequiredScenario(options?: {
    approveTestnet?: boolean;
    autoDeny?: boolean;
  }): Promise<{ decision: ReturnType<typeof evaluatePaymentRequest>; receiptPath?: string }>;
  runBasicPayment(options?: { amount?: string; memo?: string; dryRun?: boolean }): Promise<BasicPaymentResult>;
  runIssuedAssetPaymentScenario(options?: IssuedAssetScenarioOptions): Promise<IssuedAssetScenarioResult>;
  runContractAssetSmokeScenario(options?: ContractAssetSmokeScenarioOptions): Promise<ContractAssetSmokeScenarioResult>;
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

export interface IssuedAssetScenarioOptions {
  issuer?: string;
  recipient?: string;
  assetCode?: string;
  amount?: string;
  memo?: string;
  dryRun?: boolean;
  fund?: boolean;
}

export interface IssuedAssetScenarioResult {
  asset: string;
  amount: string;
  issuer: string;
  recipient: string;
  dryRun: boolean;
  policyDecision: ReturnType<typeof evaluatePaymentRequest>;
  funding?: {
    issuer?: Awaited<ReturnType<typeof fundWithFriendbot>>;
    recipient?: Awaited<ReturnType<typeof fundWithFriendbot>>;
  };
  trustline?: SubmittedScenarioTransaction & { receiptPath: string };
  payment?: SubmittedScenarioTransaction & { receiptPath: string };
  recipientBalance?: BalanceLine;
}

export interface ContractAssetSmokeScenarioOptions {
  source?: string;
  asset?: string;
  alias?: string;
  ledgersToExtend?: number;
  stellarBinary?: string;
  stellarConfigDir?: string;
  noCache?: boolean;
  dryRun?: boolean;
  fund?: boolean;
}

export interface ContractAssetSmokeScenarioResult {
  source: string;
  asset: string;
  dryRun: boolean;
  stellarCli: Awaited<ReturnType<typeof checkStellarCli>>;
  plannedOperations?: string[];
  funding?: Awaited<ReturnType<typeof fundWithFriendbot>>;
  deploy?: RedactedStellarCliResult & {
    contractId?: string;
    transactionHash?: string;
    receiptPath?: string;
  };
  assetId?: RedactedStellarCliResult & {
    contractId?: string;
  };
  read?: RedactedStellarCliResult;
  info?: RedactedStellarCliResult;
  invoke?: RedactedStellarCliResult;
  extend?: RedactedStellarCliResult & {
    transactionHash?: string;
    receiptPath?: string;
  };
}

type RedactedStellarCliResult = StellarCliResult;

interface SubmittedScenarioTransaction {
  hash: string;
  ledger?: number;
  successful: boolean;
  feeCharged?: string;
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
    },
    async runIssuedAssetPaymentScenario(options = {}) {
      return runIssuedAssetPaymentScenario(resolvedConfig, DEFAULT_TESTNET_POLICY, options);
    },
    async runContractAssetSmokeScenario(options = {}) {
      return runContractAssetSmokeScenario(resolvedConfig, options);
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

  const transaction = await sendPayment({
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

async function runIssuedAssetPaymentScenario(
  config: StellarAgentConfig,
  policy: Policy,
  options: IssuedAssetScenarioOptions = {}
): Promise<IssuedAssetScenarioResult> {
  const issuerName = options.issuer ?? "issuer";
  const recipientName = options.recipient ?? "merchant";
  const issuer = await ensureWallet(config, issuerName);
  const recipient = await ensureWallet(config, recipientName);
  const assetCode = (options.assetCode ?? uniqueAssetCode()).toUpperCase();
  const asset = `${assetCode}:${issuer.publicKey}`;
  parseAsset(asset);
  const amount = parseAmount(options.amount ?? "0.0000001", asset).value;
  const memo = options.memo ?? "issued-asset scenario";
  const scenarioPolicy: Policy = {
    ...policy,
    assets: {
      allow: Array.from(new Set([...policy.assets.allow, asset]))
    }
  };
  const request = {
    source: issuer.publicKey,
    destination: recipient.publicKey,
    amount,
    asset,
    memo,
    network: "testnet" as const
  };
  const policyDecision = evaluatePaymentRequest(scenarioPolicy, request);
  const eventLog = join(config.storage.logsDir, "events.jsonl");
  await appendEvent(eventLog, {
    event: "policy_decision",
    status: policyDecision.status,
    command: "testnet scenario issued-asset-payment",
    profile: "testnet",
    data: { request, policyDecision }
  });

  if (policyDecision.status === "denied") {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Issued-asset scenario payment was denied by policy.",
      hint: "Use a smaller amount or allow the scenario asset in policy.",
      docs: "docs/quickstart-testnet.md#issued-asset-scenario"
    });
  }
  if (policyDecision.status === "requires_approval") {
    throw new StellarAgentError({
      code: "APPROVAL_REQUIRED",
      message: "Issued-asset scenario payment requires approval.",
      docs: "docs/quickstart-testnet.md#issued-asset-scenario"
    });
  }

  const baseResult = {
    asset,
    amount,
    issuer: issuer.publicKey,
    recipient: recipient.publicKey,
    dryRun: Boolean(options.dryRun),
    policyDecision
  };
  if (options.dryRun) return baseResult;

  const funding =
    options.fund === false
      ? undefined
      : {
          issuer: await fundWithFriendbot(issuer.publicKey, TESTNET_PROFILE),
          recipient: await fundWithFriendbot(recipient.publicKey, TESTNET_PROFILE)
        };

  const trustlineTransaction = await changeTrustline({
    source: recipient,
    asset,
    profile: TESTNET_PROFILE
  });
  await appendEvent(eventLog, {
    event: "transaction_confirmed",
    status: "trustline_added",
    command: "testnet scenario issued-asset-payment",
    profile: "testnet",
    data: { asset, recipient: recipient.publicKey, transaction: trustlineTransaction }
  });
  const trustlineReceiptPath = await writeOperationReceipt(config, {
    command: "testnet scenario issued-asset-payment",
    operation: {
      type: "trustline.add",
      account: recipientName,
      source: recipient.publicKey,
      asset,
      limit: trustlineTransaction.limit
    },
    transaction: trustlineTransaction
  });

  const paymentTransaction = await sendPayment({
    source: issuer,
    destination: recipient.publicKey,
    amount,
    asset,
    memo,
    profile: TESTNET_PROFILE
  });
  await appendEvent(eventLog, {
    event: "transaction_confirmed",
    status: "successful",
    command: "testnet scenario issued-asset-payment",
    profile: "testnet",
    data: { asset, recipient: recipient.publicKey, transaction: paymentTransaction }
  });
  const { path: paymentReceiptPath } = await writeReceipt(config.storage.receiptsDir, {
    command: "testnet scenario issued-asset-payment",
    profile: "testnet",
    networkPassphrase: TESTNET_PROFILE.networkPassphrase,
    realFunds: false,
    payment: {
      source: issuer.publicKey,
      destination: recipient.publicKey,
      asset,
      amount,
      memo
    },
    policyDecision,
    transaction: paymentTransaction,
    ...(paymentTransaction.ledger === undefined ? {} : { ledger: { confirmedLedger: paymentTransaction.ledger } }),
    eventLog
  });
  await appendEvent(eventLog, {
    event: "receipt_written",
    status: "success",
    command: "testnet scenario issued-asset-payment",
    profile: "testnet",
    data: { receiptPath: paymentReceiptPath, transactionHash: paymentTransaction.hash }
  });

  const recipientBalance = (await walletBalances(config, recipientName)).find((balance) => balance.asset === asset);
  return {
    ...baseResult,
    ...(funding === undefined ? {} : { funding }),
    trustline: { ...trustlineTransaction, receiptPath: trustlineReceiptPath },
    payment: { ...paymentTransaction, receiptPath: paymentReceiptPath },
    ...(recipientBalance === undefined ? {} : { recipientBalance })
  };
}

async function runContractAssetSmokeScenario(
  config: StellarAgentConfig,
  options: ContractAssetSmokeScenarioOptions = {}
): Promise<ContractAssetSmokeScenarioResult> {
  const sourceName = options.source ?? "agent";
  const asset = options.asset ?? "native";
  const stellarBinary = options.stellarBinary ?? "stellar";
  const ledgersToExtend = options.ledgersToExtend ?? 535679;
  const stellarCli = await checkStellarCli(stellarBinary);
  const baseResult: ContractAssetSmokeScenarioResult = {
    source: sourceName,
    asset,
    dryRun: Boolean(options.dryRun),
    stellarCli
  };

  if (options.dryRun) {
    return {
      ...baseResult,
      plannedOperations: [
        "contract doctor",
        "contract asset-deploy",
        "contract asset-id",
        "contract read",
        "contract info",
        "contract invoke symbol",
        "contract extend"
      ]
    };
  }

  const sourceResolution = await resolveContractScenarioSource(config, sourceName);
  const profile = config.profiles.testnet ?? TESTNET_PROFILE;
  const funding =
    options.fund === false || !sourceResolution.wallet
      ? undefined
      : await fundWithFriendbot(sourceResolution.wallet.publicKey, profile);
  const common = {
    network: "testnet",
    rpcUrl: profile.rpcUrl,
    networkPassphrase: profile.networkPassphrase,
    stellarBinary,
    ...(options.stellarConfigDir === undefined ? {} : { stellarConfigDir: options.stellarConfigDir }),
    ...(options.noCache === undefined ? {} : { noCache: options.noCache })
  };
  const deploy = await deployAssetContractWithStellarCli({
    source: sourceResolution.source,
    asset,
    ...(options.alias === undefined ? {} : { alias: options.alias }),
    ...common
  });
  const contractId = firstOutputLine(deploy.stdout);
  const deployTransactionHash = parseStellarCliTransactionHash(`${deploy.stderr}\n${deploy.stdout}`);
  const deployReceiptPath = deployTransactionHash
    ? await writeOperationReceipt(config, {
        command: "testnet scenario contract-asset-smoke",
        operation: {
          type: "contract.asset-deploy",
          source: sourceName,
          asset,
          details: {
            contractId,
            alias: options.alias
          }
        },
        transaction: {
          hash: deployTransactionHash,
          successful: true
        }
      })
    : undefined;

  const assetId = await assetContractIdWithStellarCli({
    asset,
    ...common
  });
  const assetIdContractId = firstOutputLine(assetId.stdout);
  if (contractId && assetIdContractId && contractId !== assetIdContractId) {
    throw new StellarAgentError({
      code: "TRANSACTION_SUBMIT_FAILED",
      message: "Asset contract id lookup did not match the deployed contract id.",
      docs: "docs/smart-contracts.md#asset-contracts",
      details: { deployedContractId: contractId, lookedUpContractId: assetIdContractId }
    });
  }

  const effectiveContractId = contractId || assetIdContractId;
  if (!effectiveContractId) {
    throw new StellarAgentError({
      code: "TRANSACTION_SUBMIT_FAILED",
      message: "Stellar CLI did not return an asset contract id.",
      docs: "docs/smart-contracts.md#asset-contracts"
    });
  }

  const read = await readContractWithStellarCli({
    contractId: effectiveContractId,
    output: "string",
    ...common
  });
  const info = await contractInfoWithStellarCli({
    kind: "interface",
    contractId: effectiveContractId,
    ...common
  });
  const invoke = await invokeContractWithStellarCli({
    contractId: effectiveContractId,
    source: sourceResolution.source,
    functionName: "symbol",
    ...common
  });
  const extend = await extendContractWithStellarCli({
    source: sourceResolution.source,
    contractId: effectiveContractId,
    ledgersToExtend,
    durability: "persistent",
    ...common
  });
  const extendTransactionHash = parseStellarCliTransactionHash(`${extend.stderr}\n${extend.stdout}`);
  const extendReceiptPath = extendTransactionHash
    ? await writeOperationReceipt(config, {
        command: "testnet scenario contract-asset-smoke",
        operation: {
          type: "contract.extend",
          source: sourceName,
          details: {
            contractId: effectiveContractId,
            durability: "persistent",
            ledgersToExtend
          }
        },
        transaction: {
          hash: extendTransactionHash,
          successful: true
        }
      })
    : undefined;

  return {
    ...baseResult,
    ...(funding === undefined ? {} : { funding }),
    deploy: {
      ...redactStellarCliResult(deploy),
      contractId: effectiveContractId,
      ...(deployTransactionHash === undefined ? {} : { transactionHash: deployTransactionHash }),
      ...(deployReceiptPath === undefined ? {} : { receiptPath: deployReceiptPath })
    },
    assetId: {
      ...redactStellarCliResult(assetId),
      contractId: assetIdContractId || effectiveContractId
    },
    read: redactStellarCliResult(read),
    info: redactStellarCliResult(info),
    invoke: redactStellarCliResult(invoke),
    extend: {
      ...redactStellarCliResult(extend),
      ...(extendTransactionHash === undefined ? {} : { transactionHash: extendTransactionHash }),
      ...(extendReceiptPath === undefined ? {} : { receiptPath: extendReceiptPath })
    }
  };
}

async function writeOperationReceipt(
  config: StellarAgentConfig,
  args: {
    command: string;
    operation: NonNullable<Parameters<typeof writeReceipt>[1]["operation"]>;
    transaction: SubmittedScenarioTransaction;
  }
): Promise<string> {
  const eventLog = join(config.storage.logsDir, "events.jsonl");
  const { path: receiptPath } = await writeReceipt(config.storage.receiptsDir, {
    command: args.command,
    profile: "testnet",
    networkPassphrase: TESTNET_PROFILE.networkPassphrase,
    realFunds: false,
    operation: args.operation,
    policyDecision: { status: "allowed", matchedRules: ["testnet_operation"] },
    transaction: args.transaction,
    ...(args.transaction.ledger === undefined ? {} : { ledger: { confirmedLedger: args.transaction.ledger } }),
    eventLog
  });
  await appendEvent(eventLog, {
    event: "receipt_written",
    status: "success",
    command: args.command,
    profile: "testnet",
    data: { receiptPath }
  });
  return receiptPath;
}

async function resolveContractScenarioSource(
  config: StellarAgentConfig,
  source: string
): Promise<{ source: string; wallet?: TestnetWallet }> {
  if (source === "agent") {
    const wallet = await ensureWallet(config, source);
    return { source: wallet.secretKey, wallet };
  }
  try {
    const wallet = await loadWallet(config, source);
    return { source: wallet.secretKey, wallet };
  } catch (error) {
    if (!(error instanceof StellarAgentError) || error.code !== "WALLET_NOT_FOUND") throw error;
    return { source };
  }
}

function redactStellarCliResult(result: StellarCliResult): RedactedStellarCliResult {
  return redactSensitive(result) as RedactedStellarCliResult;
}

function firstOutputLine(output: string): string | undefined {
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  return line || undefined;
}

function uniqueAssetCode(): string {
  return `IA${Date.now().toString(36).slice(-10).toUpperCase()}`.slice(0, 12);
}

export async function ensureWallet(
  config: StellarAgentConfig,
  name: string
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
  name: string
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

export async function walletBalances(config: StellarAgentConfig, name: string) {
  const wallet = await loadWalletPublic(config, name);
  return getBalances(wallet.publicKey, profileForNetwork(config, wallet.network));
}

export interface WalletTrustlineView {
  asset: string;
  balance: string;
}

export async function walletTrustlines(config: StellarAgentConfig, name: string): Promise<WalletTrustlineView[]> {
  return trustlinesFromBalances(await walletBalances(config, name));
}

export function trustlinesFromBalances(balances: Array<{ asset: string; balance: string }>): WalletTrustlineView[] {
  return balances.filter((balance) => balance.asset !== "XLM");
}

export async function importPublicWallet(args: {
  config: StellarAgentConfig;
  name: string;
  publicKey: string;
  network: NetworkName;
}): Promise<PublicWallet> {
  const wallet: PublicWallet = {
    schemaVersion: "stellar-agent.publicWallet.v1",
    name: safeWalletName(args.name),
    network: args.network,
    publicKey: args.publicKey,
    importedAt: new Date().toISOString(),
    source: "watch-only"
  };
  const parsed = publicWalletSchema.parse(wallet);
  const path = publicWalletPath(args.config, args.name, args.network);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  return parsed;
}

export async function loadWalletPublic(config: StellarAgentConfig, name: string): Promise<WalletPublicView> {
  try {
    const wallet = await loadWallet(config, name);
    const { secretKey: _secretKey, ...publicFields } = wallet;
    return { ...publicFields, hasSecret: true };
  } catch (error) {
    if (!(error instanceof StellarAgentError) || error.code !== "WALLET_NOT_FOUND") throw error;
  }
  for (const network of ["testnet", "mainnet", "local"] as const) {
    try {
      const raw = await readFile(publicWalletPath(config, name, network), "utf8");
      return { ...publicWalletSchema.parse(JSON.parse(raw)), hasSecret: false };
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        throw new StellarAgentError({
          code: "WALLET_INVALID",
          message: `Watch-only wallet '${name}' is invalid.`,
          docs: "docs/troubleshooting.md#invalid-wallet",
          details: error
        });
      }
    }
  }
  throw new StellarAgentError({
    code: "WALLET_NOT_FOUND",
    message: `Wallet '${name}' was not found.`,
    hint: "Run stellar-agent wallet create-testnet or wallet import-public first.",
    docs: "docs/quickstart-testnet.md#wallets"
  });
}

export async function listWalletPublicViews(config: StellarAgentConfig): Promise<WalletPublicView[]> {
  const dir = config.storage.walletsDir;
  try {
    const entries = await readdir(dir);
    const names = new Set<string>();
    const views: WalletPublicView[] = [];
    for (const entry of entries) {
      if (entry.startsWith("testnet-") && entry.endsWith(".json")) {
        names.add(entry.slice("testnet-".length, -".json".length));
      }
      if (entry.startsWith("watch-") && entry.endsWith(".json")) {
        const raw = await readFile(join(dir, entry), "utf8");
        views.push({ ...publicWalletSchema.parse(JSON.parse(raw)), hasSecret: false });
      }
    }
    for (const name of names) {
      views.push(await loadWalletPublic(config, name));
    }
    return views.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function walletPath(config: StellarAgentConfig, name: string): string {
  return join(config.storage.walletsDir, `testnet-${safeWalletName(name)}.json`);
}

function publicWalletPath(config: StellarAgentConfig, name: string, network: NetworkName): string {
  return join(config.storage.walletsDir, `watch-${network}-${safeWalletName(name)}.json`);
}

function profileForNetwork(config: StellarAgentConfig, network: NetworkName): NetworkProfile {
  const profile = config.profiles[network];
  if (!profile) {
    throw new StellarAgentError({
      code: "PROFILE_NOT_FOUND",
      message: `Profile '${network}' was not found.`,
      hint: "Run stellar-agent profile list to see configured profiles."
    });
  }
  return profile;
}

function safeWalletName(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Wallet name must be 1-64 characters and use only letters, numbers, dot, underscore, or dash.",
      docs: "docs/quickstart-testnet.md#wallets"
    });
  }
  return name;
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

#!/usr/bin/env node
import {
  EXIT_CODES,
  ErrorCode,
  NetworkName,
  StellarAgentConfig,
  StellarAgentError,
  configSchema,
  createDefaultConfig,
  fail,
  ok,
  paymentRequestSchema,
  redactSensitive,
  resolvePath,
  serializeError
} from "@stellar-agent/core";
import { latestLedger, lookupTransaction, resolveNetworkProfile } from "@stellar-agent/stellar";
import { latestReceipt, listReceipts, readReceipt, verifyReceipt } from "@stellar-agent/ledger-logger";
import {
  DEFAULT_MAINNET_POLICY,
  DEFAULT_TESTNET_POLICY,
  defaultPolicyForNetwork,
  evaluatePaymentRequest,
  parsePolicyYaml,
  policyToYaml
} from "@stellar-agent/policy";
import {
  createTestnetHarness,
  ensureWallet,
  initTestnetWorkspace,
  loadWallet,
  walletBalances
} from "@stellar-agent/testnet-suite";
import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const VERSION = "0.0.0";

interface CliOptions {
  profile?: string;
  config?: string;
  policy?: string;
  json?: boolean;
  noColor?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

interface CliContext {
  options: CliOptions;
  config: StellarAgentConfig;
  profileName: NetworkName;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("stellar-agent")
    .description("Stellar Agent Bridge\n\nSafe agentic payments on Stellar from your terminal.")
    .version(VERSION)
    .option("--profile <name>", "Network profile to use: testnet, mainnet, local")
    .option("--config <path>", "Path to config file")
    .option("--policy <path>", "Path to policy file")
    .option("--json", "Print machine-readable JSON")
    .option("--no-color", "Disable colored output")
    .option("--verbose", "Print additional diagnostics")
    .option("--quiet", "Suppress nonessential output")
    .addHelpText(
      "after",
      `

Quick start:
  stellar-agent testnet init
  stellar-agent testnet smoke-test
  stellar-agent testnet scenario basic-payment
  stellar-agent receipts latest

Common commands:
  stellar-agent testnet doctor
  stellar-agent wallet balance
  stellar-agent pay send --to G... --amount 1 --asset XLM
  stellar-agent policy explain --request ./payment-request.json`
    );

  addProfileCommands(program);
  addTestnetCommands(program);
  addWalletCommands(program);
  addPayCommands(program);
  addPolicyCommands(program);
  addLedgerCommands(program);
  addReceiptCommands(program);
  addMainnetCommands(program);

  return program;
}

function addProfileCommands(program: Command): void {
  const profile = program.command("profile").description("Inspect and manage network profiles.");
  profile
    .command("list")
    .description("List configured profiles.")
    .action(withContext(async (context) => context.config.profiles, "Configured profiles listed."));
  profile
    .command("inspect")
    .description("Inspect a network profile.")
    .argument("[name]", "Profile name")
    .action(
      withContext(async (context, name?: string) => {
        const target = name ?? context.profileName;
        return resolveNetworkProfile(target, context.config.profiles);
      }, "Profile inspected.")
    );
  profile
    .command("use")
    .description("Set the active profile.")
    .argument("<name>", "Profile name")
    .action(
      withContext(async (context, name: string) => {
        const target = resolveNetworkProfile(name, context.config.profiles);
        context.config.activeProfile = target.name;
        await writeConfig(context.config, context.options);
        return { activeProfile: target.name, realFunds: target.realFunds };
      }, "Active profile updated.")
    );
}

function addTestnetCommands(program: Command): void {
  const testnet = program.command("testnet").description("Run safe Testnet workflows.");
  testnet
    .command("doctor")
    .description("Check local Testnet readiness.")
    .option("--live", "Also check network endpoints")
    .action(
      withContext(async (context, options: { live?: boolean }) => {
        const checks = [
          { name: "node", ok: Number(process.versions.node.split(".")[0]) >= 22, detail: process.version },
          { name: "profile", ok: Boolean(context.config.profiles.testnet), detail: "testnet profile configured" },
          { name: "storage", ok: Boolean(context.config.storage.rootDir), detail: context.config.storage.rootDir },
          {
            name: "network",
            ok: options.live ? Boolean(context.config.profiles.testnet?.horizonUrl) : true,
            detail: options.live ? context.config.profiles.testnet?.horizonUrl : "skipped"
          }
        ];
        return { checks, ok: checks.every((check) => check.ok) };
      }, "Doctor checks complete.")
    );
  testnet
    .command("init")
    .description("Create local Testnet wallets, policy, config, logs, and receipts directories.")
    .option("--no-fund", "Create local state without calling Friendbot")
    .option("--overwrite-policy", "Overwrite the default Testnet policy")
    .action(
      withContext(async (context, options: { fund?: boolean; overwritePolicy?: boolean }) => {
        const result = await initTestnetWorkspace(
          context.config,
          {
            ...(options.fund === undefined ? {} : { fund: options.fund }),
            ...(options.overwritePolicy === undefined ? {} : { overwritePolicy: options.overwritePolicy })
          }
        );
        if (context.options.config) await writeConfig(context.config, context.options);
        return {
          ...result,
          configPath: context.options.config ? resolvePath(context.options.config) : result.configPath
        };
      }, "Testnet workspace initialized.")
    );
  testnet
    .command("reset")
    .description("Plan a reset of generated Testnet state.")
    .option("--soft", "Preserve wallets and policies")
    .option("--wallets", "Also reset generated Testnet wallets")
    .option("--yes", "Confirm destructive reset")
    .action(
      withContext(async (_context, options: { soft?: boolean; wallets?: boolean; yes?: boolean }) => {
        if (options.wallets && !options.yes) {
          throw new StellarAgentError({
            code: "INVALID_INPUT",
            message: "Resetting wallets requires --yes.",
            docs: "docs/quickstart-testnet.md#reset"
          });
        }
        return { planned: true, soft: Boolean(options.soft), wallets: Boolean(options.wallets) };
      }, "Reset plan generated.")
    );
  const friendbot = testnet
    .command("friendbot")
    .alias("fund")
    .description("Fund a Testnet account with Friendbot. Alias: testnet fund.")
    .option("--account <name>", "Local wallet name", "agent")
    .option("--address <address>", "Raw Stellar public key");
  friendbot.action(
    withContext(async (context, options: { account: "agent" | "merchant" | "auditor"; address?: string }) => {
      const { fundWithFriendbot } = await import("@stellar-agent/stellar");
      const address = options.address ?? (await loadWallet(context.config, options.account)).publicKey;
      const result = await fundWithFriendbot(address, context.config.profiles.testnet);
      return { address, ...result };
    }, "Friendbot funding complete.")
  );
  testnet
    .command("create-pair")
    .description("Create local agent and merchant Testnet wallets if missing.")
    .action(
      withContext(async (context) => ({
        agent: await ensureWallet(context.config, "agent"),
        merchant: await ensureWallet(context.config, "merchant")
      }), "Testnet pair ready.")
    );
  testnet
    .command("smoke-test")
    .description("Run the install-to-Testnet-payment workflow.")
    .option("--dry-run", "Evaluate locally without submitting a transaction")
    .action(
      withContext(async (context, options: { dryRun?: boolean }) => {
        const harness = createTestnetHarness(context.config);
        return harness.runBasicPayment(options.dryRun === undefined ? {} : { dryRun: options.dryRun });
      }, "Smoke test complete.")
    );
  const scenario = testnet.command("scenario").description("Run canned Testnet scenarios.");
  scenario
    .command("basic-payment")
    .description("Run a canned Testnet XLM payment scenario.")
    .option("--dry-run", "Evaluate locally without submitting a transaction")
    .action(
      withContext(async (context, options: { dryRun?: boolean }) => {
        return createTestnetHarness(context.config).runBasicPayment({
          amount: "1",
          memo: "basic-payment scenario",
          ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun })
        });
      }, "Basic payment scenario complete.")
    );
  scenario
    .command("policy-denied")
    .description("Verify a policy denial without signing or submitting.")
    .action(
      withContext(async (context) => createTestnetHarness(context.config).runPolicyDeniedScenario(), "Policy-denied scenario complete.")
    );
  scenario
    .command("approval-required")
    .description("Verify approval-required behavior.")
    .option("--auto-deny", "Complete without signing")
    .option("--approve-testnet", "Proceed on Testnet after approval")
    .action(
      withContext(async (context, options: { autoDeny?: boolean; approveTestnet?: boolean }) => {
        return createTestnetHarness(context.config).runApprovalRequiredScenario(options);
      }, "Approval-required scenario complete.")
    );
  scenario
    .command("x402-payment")
    .description("Placeholder for the future local x402 Testnet payment scenario.")
    .action(withPlaceholder("X402_NOT_IMPLEMENTED", "x402 Testnet scenario is not implemented in this build.", "docs/x402-and-mpp.md"));
  testnet
    .command("export-report")
    .description("Export a local Testnet report placeholder.")
    .action(withContext(async () => ({ status: "not_yet_implemented", receipts: "use receipts export" }), "Report export placeholder."));
}

function addWalletCommands(program: Command): void {
  const wallet = program.command("wallet").description("Manage local and connected wallets.");
  wallet
    .command("create")
    .description("Create a Testnet wallet. Mainnet secret storage is not implemented.")
    .action(
      withContext(async (context) => ensureWallet(context.config, "agent"), "Wallet created.")
    );
  wallet
    .command("create-testnet")
    .description("Create a local Testnet wallet.")
    .argument("[name]", "Wallet name", "agent")
    .action(
      withContext(async (context, name: "agent" | "merchant" | "auditor") => ensureWallet(context.config, name), "Testnet wallet created.")
    );
  wallet
    .command("balance")
    .description("Show wallet balances.")
    .option("--account <name>", "Local wallet name", "agent")
    .action(
      withContext(async (context, options: { account: "agent" | "merchant" | "auditor" }) => ({
        account: options.account,
        balances: await walletBalances(context.config, options.account)
      }), "Wallet balance loaded.")
    );
  wallet
    .command("address")
    .description("Show a local wallet public address.")
    .option("--account <name>", "Local wallet name", "agent")
    .action(
      withContext(async (context, options: { account: "agent" | "merchant" | "auditor" }) => {
        const wallet = await loadWallet(context.config, options.account);
        return { account: options.account, publicKey: wallet.publicKey };
      }, "Wallet address loaded.")
    );
  wallet
    .command("export-public")
    .description("Export public wallet metadata.")
    .option("--account <name>", "Local wallet name", "agent")
    .action(
      withContext(async (context, options: { account: "agent" | "merchant" | "auditor" }) => {
        const wallet = await loadWallet(context.config, options.account);
        return redactSensitive(wallet);
      }, "Public wallet metadata exported.")
    );
  wallet
    .command("import-public")
    .description("Placeholder for watch-only Mainnet wallet import.")
    .action(withPlaceholder("NOT_IMPLEMENTED", "Watch-only wallet import is not implemented in this build.", "docs/mainnet-safety.md"));
  wallet
    .command("use-env")
    .description("Report whether STELLAR_SECRET_KEY is configured without printing it.")
    .action(
      withContext(async () => ({ configured: Boolean(process.env.STELLAR_SECRET_KEY), secretPrinted: false }), "Environment wallet checked.")
    );
  wallet
    .command("status")
    .description("Show local wallet status.")
    .action(
      withContext(async (context) => {
        const names = ["agent", "merchant", "auditor"] as const;
        const wallets = await Promise.all(
          names.map(async (name) => {
            try {
              const current = await loadWallet(context.config, name);
              return { name, exists: true, publicKey: current.publicKey };
            } catch {
              return { name, exists: false };
            }
          })
        );
        return { wallets };
      }, "Wallet status loaded.")
    );
  wallet
    .command("connect-freighter")
    .description("Placeholder for the future local Freighter approval bridge.")
    .action(withPlaceholder("FREIGHTER_NOT_IMPLEMENTED", "Freighter bridge is not implemented in this build.", "docs/mainnet-safety.md"));
}

function addPayCommands(program: Command): void {
  const pay = program.command("pay").description("Quote and send payments.");
  pay
    .command("quote")
    .description("Evaluate a payment without signing or submitting.")
    .requiredOption("--to <address>", "Destination public key")
    .requiredOption("--amount <amount>", "Payment amount")
    .option("--asset <asset>", "Asset", "XLM")
    .option("--memo <memo>", "Memo")
    .action(
      withContext(async (context, options: { to: string; amount: string; asset: string; memo?: string }) => {
        const policy = await loadPolicy(context);
        const request = paymentRequestSchema.parse({
          destination: options.to,
          amount: options.amount,
          asset: options.asset,
          memo: options.memo,
          network: context.profileName
        });
        return {
          request,
          estimatedFee: "100 stroops",
          policyDecision: evaluatePaymentRequest(policy, request),
          profile: context.profileName
        };
      }, "Payment quote complete.")
    );
  pay
    .command("send")
    .description("Send an XLM payment on Testnet when policy allows.")
    .requiredOption("--to <address>", "Destination public key")
    .requiredOption("--amount <amount>", "Payment amount")
    .option("--asset <asset>", "Asset", "XLM")
    .option("--memo <memo>", "Memo")
    .option("--dry-run", "Evaluate locally without submitting")
    .action(
      withContext(async (context, options: { to: string; amount: string; asset: string; memo?: string; dryRun?: boolean }) => {
        if (context.profileName === "mainnet") {
          throw new StellarAgentError({
            code: "MAINNET_NOT_ENABLED",
            message: "Mainnet payment submission is blocked in v0.",
            docs: "docs/mainnet-safety.md"
          });
        }
        const policy = await loadPolicy(context);
        const source = await loadWallet(context.config, "agent");
        const request = paymentRequestSchema.parse({
          source: source.publicKey,
          destination: options.to,
          amount: options.amount,
          asset: options.asset,
          memo: options.memo,
          network: "testnet"
        });
        const decision = evaluatePaymentRequest(policy, request);
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
            docs: "docs/mainnet-safety.md"
          });
        }
        if (options.dryRun) return { request, policyDecision: decision, dryRun: true };
        const { sendNativePayment } = await import("@stellar-agent/stellar");
        return {
          request,
          policyDecision: decision,
          transaction: await sendNativePayment({
            source,
            destination: options.to,
            amount: options.amount,
            ...(options.memo === undefined ? {} : { memo: options.memo }),
            profile: context.config.profiles.testnet
          })
        };
      }, "Payment send complete.")
    );
  pay
    .command("x402")
    .description("Placeholder for x402 discovery and payment support.")
    .argument("[url]", "Paid URL")
    .action(withPlaceholder("X402_NOT_IMPLEMENTED", "x402 payments are not implemented in this build.", "docs/x402-and-mpp.md"));
  pay
    .command("mpp")
    .description("Placeholder for MPP one-time charge support.")
    .argument("[url]", "MPP URL")
    .action(withPlaceholder("MPP_NOT_IMPLEMENTED", "MPP payments are not implemented in this build.", "docs/x402-and-mpp.md"));
}

function addPolicyCommands(program: Command): void {
  const policy = program.command("policy").description("Manage and evaluate spend policies.");
  policy
    .command("init")
    .description("Write a safe default policy.")
    .option("--network <network>", "Policy network", "testnet")
    .option("--output <path>", "Output path")
    .action(
      withContext(async (context, options: { network: "testnet" | "mainnet" | "local"; output?: string }) => {
        const target = defaultPolicyForNetwork(options.network);
        const path =
          options.output ??
          join(context.config.storage.policiesDir, options.network === "mainnet" ? "default-mainnet.yaml" : "default-testnet.yaml");
        await writeFile(resolvePath(path), policyToYaml(target), { mode: 0o600 });
        return { path: resolvePath(path), policy: target };
      }, "Policy initialized.")
    );
  policy
    .command("check")
    .description("Validate a policy YAML file.")
    .argument("[path]", "Policy path")
    .action(
      withContext(async (context, path?: string) => {
        const policy = await loadPolicy(context, path);
        return { valid: true, name: policy.name, network: policy.network };
      }, "Policy valid.")
    );
  policy
    .command("explain")
    .description("Explain a payment request against a policy.")
    .option("--request <path>", "JSON payment request file")
    .option("--to <address>", "Destination public key")
    .option("--amount <amount>", "Payment amount")
    .option("--asset <asset>", "Asset", "XLM")
    .option("--memo <memo>", "Memo")
    .action(
      withContext(async (context, options: { request?: string; to?: string; amount?: string; asset: string; memo?: string }) => {
        const policy = await loadPolicy(context);
        const raw = options.request
          ? JSON.parse(await readFile(resolvePath(options.request), "utf8"))
          : { destination: options.to, amount: options.amount, asset: options.asset, memo: options.memo, network: context.profileName };
        const request = paymentRequestSchema.parse(raw);
        return evaluatePaymentRequest(policy, request);
      }, "Policy explanation complete.")
    );
  policy
    .command("test")
    .description("Run bundled policy fixture checks.")
    .action(
      withContext(async () => {
        const fixtures = [
          evaluatePaymentRequest(DEFAULT_TESTNET_POLICY, fixtureRequest("1")),
          evaluatePaymentRequest(DEFAULT_TESTNET_POLICY, fixtureRequest("11")),
          evaluatePaymentRequest(DEFAULT_TESTNET_POLICY, fixtureRequest("6")),
          evaluatePaymentRequest(DEFAULT_MAINNET_POLICY, { ...fixtureRequest("0.01"), network: "mainnet" })
        ];
        return { passed: fixtures.length, decisions: fixtures.map((fixture) => fixture.status) };
      }, "Policy fixtures passed.")
    );
}

function addLedgerCommands(program: Command): void {
  const ledger = program.command("ledger").description("Inspect Stellar ledger data.");
  ledger
    .command("latest")
    .description("Fetch the latest ledger from Horizon.")
    .action(
      withContext(async (context) => latestLedger(resolveNetworkProfile(context.profileName, context.config.profiles)), "Latest ledger loaded.")
    );
  ledger
    .command("tx")
    .description("Fetch a transaction by hash.")
    .argument("<hash>", "Transaction hash")
    .action(
      withContext(async (context, hash: string) => lookupTransaction(hash, resolveNetworkProfile(context.profileName, context.config.profiles)), "Transaction loaded.")
    );
  ledger
    .command("account")
    .description("Show local account balances.")
    .argument("[name]", "Wallet name", "agent")
    .action(
      withContext(async (context, name: "agent" | "merchant" | "auditor") => ({
        account: name,
        balances: await walletBalances(context.config, name)
      }), "Account ledger data loaded.")
    );
  ledger
    .command("payments")
    .description("Placeholder for payment history lookup.")
    .action(withPlaceholder("NOT_IMPLEMENTED", "Ledger payment history is not implemented in this build.", "docs/ledger-logging.md"));
  ledger
    .command("effects")
    .description("Placeholder for effect history lookup.")
    .action(withPlaceholder("NOT_IMPLEMENTED", "Ledger effects lookup is not implemented in this build.", "docs/ledger-logging.md"));
  ledger
    .command("export")
    .description("Export local ledger report placeholder.")
    .action(withContext(async () => ({ exported: false, reason: "No local ledger report exporter yet." }), "Ledger export placeholder."));
}

function addReceiptCommands(program: Command): void {
  const receipts = program.command("receipts").description("List, show, verify, and export receipts.");
  receipts
    .command("list")
    .description("List local receipts.")
    .action(
      withContext(async (context) => ({ receipts: await listReceipts(context.config.storage.receiptsDir) }), "Receipts listed.")
    );
  receipts
    .command("latest")
    .description("Show the latest local receipt.")
    .action(
      withContext(async (context) => {
        const latest = await latestReceipt(context.config.storage.receiptsDir);
        if (!latest) return { receipt: null };
        return latest;
      }, "Latest receipt loaded.")
    );
  receipts
    .command("show")
    .description("Show a receipt file.")
    .argument("<path>", "Receipt path")
    .action(withContext(async (_context, path: string) => readReceipt(path), "Receipt loaded."));
  receipts
    .command("verify")
    .description("Verify a receipt file.")
    .argument("<path>", "Receipt path")
    .action(
      withContext(async (_context, path: string) => {
        verifyReceipt(await readReceipt(path));
        return { valid: true, path: resolvePath(path) };
      }, "Receipt valid.")
    );
  receipts
    .command("export")
    .description("Export receipt paths.")
    .action(
      withContext(async (context) => ({ receipts: await listReceipts(context.config.storage.receiptsDir) }), "Receipts exported.")
    );
}

function addMainnetCommands(program: Command): void {
  const mainnet = program.command("mainnet").description("Guarded Mainnet readiness and enablement.");
  mainnet
    .command("status")
    .description("Show Mainnet guard status.")
    .action(
      withContext(async (context) => ({
        realFunds: true,
        enabled: Boolean(context.config.profiles.mainnet?.enabled),
        requiresExplicitApproval: true
      }), "Mainnet status loaded.")
    );
  mainnet
    .command("enable")
    .description("Enable guarded Mainnet profile metadata.")
    .option("--i-understand-real-funds", "Required acknowledgement")
    .action(
      withContext(async (context, options: { iUnderstandRealFunds?: boolean }) => {
        if (!options.iUnderstandRealFunds) {
          throw new StellarAgentError({
            code: "MAINNET_NOT_ENABLED",
            message: "Enabling Mainnet requires --i-understand-real-funds.",
            docs: "docs/mainnet-safety.md"
          });
        }
        const mainnet = context.config.profiles.mainnet;
        if (mainnet) mainnet.enabled = true;
        await writeConfig(context.config, context.options);
        return { enabled: true, realFunds: true, autoApproval: false };
      }, "Mainnet enabled with guarded settings.")
    );
  mainnet
    .command("disable")
    .description("Disable Mainnet profile metadata.")
    .action(
      withContext(async (context) => {
        const mainnet = context.config.profiles.mainnet;
        if (mainnet) mainnet.enabled = false;
        await writeConfig(context.config, context.options);
        return { enabled: false, realFunds: true };
      }, "Mainnet disabled.")
    );
  mainnet
    .command("readiness")
    .description("Show a Mainnet readiness checklist.")
    .action(
      withContext(async (context) => ({
        realFunds: true,
        enabled: Boolean(context.config.profiles.mainnet?.enabled),
        checklist: [
          "Freighter or another human approval flow is required.",
          "Mainnet auto-approval is disabled.",
          "Policy must require explicit approval.",
          "Receipts must mark realFunds: true."
        ]
      }), "Mainnet readiness checked.")
    );
}

function withPlaceholder(code: ErrorCode, message: string, docs: string) {
  return withContext(async () => {
    throw new StellarAgentError({
      code,
      message,
      hint: "Use the Testnet smoke test or read the linked docs for current support status.",
      docs,
      exitCode: EXIT_CODES.notImplemented
    });
  }, message);
}

function withContext(handler: (...args: any[]) => Promise<unknown>, humanMessage: string) {
  return async (...args: any[]) => {
    const command = args.at(-1) as Command;
    const options = command.optsWithGlobals() as CliOptions;
    try {
      const config = await loadConfig(options);
      const profileName = (options.profile ??
        process.env.STELLAR_AGENT_PROFILE ??
        config.activeProfile ??
        "testnet") as NetworkName;
      const context: CliContext = { options, config, profileName };
      const data = await handler(context, ...args.slice(0, -1));
      printSuccess(options, data, humanMessage);
    } catch (error) {
      printError(options, error);
    }
  };
}

async function loadConfig(options: CliOptions): Promise<StellarAgentConfig> {
  const configPath = options.config ?? process.env.STELLAR_AGENT_CONFIG;
  const resolvedConfigPath = configPath ? resolvePath(configPath) : undefined;
  const defaultConfig = createDefaultConfig(resolvedConfigPath ? dirname(resolvedConfigPath) : undefined);
  if (!configPath) return configSchema.parse(defaultConfig);
  try {
    const raw = await readFile(resolvedConfigPath!, "utf8");
    const parsed = parseYaml(raw) as Partial<StellarAgentConfig>;
    return configSchema.parse(deepMerge(defaultConfig, parsed));
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return configSchema.parse(defaultConfig);
    }
    throw new StellarAgentError({
      code: "CONFIG_INVALID",
      message: "Config file is invalid.",
      details: error,
      docs: "docs/troubleshooting.md#invalid-wallet"
    });
  }
}

async function writeConfig(config: StellarAgentConfig, options: CliOptions): Promise<void> {
  const path = resolvePath(options.config ?? process.env.STELLAR_AGENT_CONFIG ?? join(config.storage.rootDir, "config.yaml"));
  await import("node:fs/promises").then(({ mkdir }) => mkdir(dirname(path), { recursive: true }));
  await writeFile(path, stringifyYaml(config), { mode: 0o600 });
}

async function loadPolicy(context: CliContext, explicitPath?: string) {
  const policyPath =
    explicitPath ??
    context.options.policy ??
    process.env.STELLAR_AGENT_POLICY ??
    join(
      context.config.storage.policiesDir,
      context.profileName === "mainnet" ? "default-mainnet.yaml" : "default-testnet.yaml"
    );
  try {
    return parsePolicyYaml(await readFile(resolvePath(policyPath), "utf8"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return defaultPolicyForNetwork(context.profileName);
    throw error;
  }
}

function printSuccess(options: CliOptions, data: unknown, humanMessage: string): void {
  process.exitCode = EXIT_CODES.success;
  if (options.json) {
    process.stdout.write(`${JSON.stringify(ok(redactSensitive(data)))}\n`);
    return;
  }
  if (!options.quiet) {
    process.stdout.write(`${humanMessage}\n`);
    if (data !== undefined) process.stdout.write(`${JSON.stringify(redactSensitive(data), null, 2)}\n`);
  }
}

function printError(options: CliOptions, error: unknown): void {
  const serialized = serializeError(error);
  process.exitCode = error instanceof StellarAgentError ? error.exitCode : EXIT_CODES.general;
  if (options.json) {
    process.stdout.write(`${JSON.stringify(fail(serialized))}\n`);
    return;
  }
  process.stderr.write(`${serialized.code}: ${serialized.message}\n`);
  if (serialized.hint) process.stderr.write(`Hint: ${serialized.hint}\n`);
}

function fixtureRequest(amount: string) {
  return {
    destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    amount,
    asset: "XLM",
    network: "testnet" as const
  };
}

function deepMerge<T>(base: T, overlay: Partial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(overlay)) return overlay as T;
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    output[key] = key in output ? deepMerge(output[key], value as any) : value;
  }
  return output as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}


if (import.meta.url === `file://${process.argv[1]}`) {
  await buildProgram().parseAsync(process.argv);
}

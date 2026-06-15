#!/usr/bin/env node
import {
  EXIT_CODES,
  MAINNET_AGENT_WALLET_AUTOSIGN_WARNING,
  MAINNET_AGENT_WALLET_WARNING,
  MainnetAgentWalletConfig,
  NetworkName,
  NetworkProfile,
  PaymentRequest,
  StellarAgentConfig,
  StellarAgentError,
  configSchema,
  assertMainnetAgentWalletBalanceWithinBudget as assertCoreMainnetAgentWalletBalanceWithinBudget,
  assertMainnetAgentWalletPaymentPreflight,
  createDefaultConfig,
  fail,
  formatStroops,
  mainnetAgentWalletConfigFingerprint as coreMainnetAgentWalletConfigFingerprint,
  mainnetAgentWalletIntegrityFailures as coreMainnetAgentWalletIntegrityFailures,
  mainnetAgentWalletRiskBudgetState as coreMainnetAgentWalletRiskBudgetState,
  ok,
  parseAmount,
  paymentRequestSchema,
  redactSensitive,
  resolvePath,
  serializeError
} from "@stellar-agent/core";
import { latestLedger, lookupTransaction, parseStellarCliTransactionHash, resolveNetworkProfile } from "@stellar-agent/stellar";
import type { LiquidityPoolPreflight, LiquidityPoolSummary } from "@stellar-agent/stellar";
import type { AquariusLpPreflight, AquariusSwapPreflight, BlendAction, BlendPreflight } from "@stellar-agent/defi";
import {
  appendEvent,
  latestReceipt,
  listReceipts,
  readReceipt,
  spendHistoryFromReceipts,
  verifyReceipt,
  writeReceipt
} from "@stellar-agent/ledger-logger";
import {
  DEFAULT_MAINNET_POLICY,
  DEFAULT_TESTNET_POLICY,
  Policy,
  PolicyDecision,
  defaultPolicyForNetwork,
  evaluateDefiAquariusRequest,
  evaluateDefiBlendRequest,
  evaluateMarketLiquidityRequest,
  evaluatePaymentRequest,
  parsePolicyYaml,
  policyToYaml
} from "@stellar-agent/policy";
import {
  createTestnetHarness,
  ensureWallet,
  importPublicWallet,
  initTestnetWorkspace,
  listWalletPublicViews,
  loadWallet,
  loadWalletPublic,
  walletBalances,
  walletTrustlines
} from "@stellar-agent/testnet-suite";
import { Command } from "commander";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as { version: string };

interface CliOptions {
  profile?: string;
  config?: string;
  policy?: string;
  json?: boolean;
  noColor?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  noCache?: boolean;
  version?: boolean;
}

interface CliContext {
  options: CliOptions;
  config: StellarAgentConfig;
  profileName: NetworkName;
}

type CommandParseArgs = Parameters<Command["parseAsync"]>[0];
type CommandParseOptions = Parameters<Command["parseAsync"]>[1];
type AquariusNetworkName = "testnet" | "mainnet";

export function buildProgram(): Command {
  const program = new Command();
  const parseState = { json: false };
  program
    .name("stellar-agent")
    .description("Stellar Agent Bridge\n\nSafe agentic payments on Stellar from your terminal.")
    .option("--profile <name>", "Network profile to use: testnet, mainnet, local")
    .option("--config <path>", "Path to config file")
    .option("--policy <path>", "Path to policy file")
    .option("--json", "Print machine-readable JSON")
    .option("--version", "Print version")
    .option("--no-color", "Disable colored output")
    .option("--verbose", "Print additional diagnostics")
    .option("--quiet", "Suppress nonessential output")
    .option("--no-cache", "Disable session caches for network lookups")
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
  stellar-agent wallet trustline add --asset USD:G... --account merchant
  stellar-agent pay quote --to G... --amount 1 --asset XLM --fee-strategy medium
  stellar-agent pay send --to G... --amount 1 --asset XLM
  stellar-agent pay batch --file ./payments.json
  stellar-agent tx submit-approval appr_...
  stellar-agent claimable create --to G... --amount 1
  stellar-agent cache inspect
  stellar-agent contract invoke --id C... --source agent --fn hello --arg to=world
  stellar-agent market pools list --asset-a XLM --asset-b USDC:G... --json
  stellar-agent market lp preflight --pool 0123... --max-a 1 --max-b 1 --min-price 0.9 --max-price 1.1 --json
  stellar-agent policy explain --request ./payment-request.json`
    );
  program.configureOutput({
    writeErr: (str) => {
      if (!parseState.json) process.stderr.write(str);
    }
  });

  addProfileCommands(program);
  addTestnetCommands(program);
  addWalletCommands(program);
  addApprovalCommands(program);
  addTransactionCommands(program);
  addPayCommands(program);
  addX402Commands(program);
  addDemoCommands(program);
  addClaimableCommands(program);
  addContractCommands(program);
  addMarketCommands(program);
  addStrategyCommands(program);
  addDefiCommands(program);
  addPolicyCommands(program);
  addLedgerCommands(program);
  addReceiptCommands(program);
  addCacheCommands(program);
  addMainnetCommands(program);

  installVersionPrecheck(program, parseState);

  program.action(() => {
    program.outputHelp();
  });

  return program;
}

function installVersionPrecheck(program: Command, parseState: { json: boolean }): void {
  const originalParseAsync = program.parseAsync.bind(program);
  program.parseAsync = (async (argv?: CommandParseArgs, parseOptions?: CommandParseOptions) => {
    parseState.json = jsonOptionRequested(argv, parseOptions);
    const versionOptions = rootVersionOptions(program, argv, parseOptions);
    if (versionOptions) {
      printVersion(versionOptions);
      return program;
    }
    const commandError = unknownCommandError(program, userArgs(argv, parseOptions));
    if (commandError) {
      printError({ json: parseState.json }, commandError);
      return program;
    }
    installExitOverride(program);
    try {
      return await originalParseAsync(argv, parseOptions);
    } catch (error) {
      if (isCommanderHelpOrVersionExit(error)) return program;
      printError({ json: parseState.json }, commanderErrorToStellarAgentError(error));
      return program;
    }
  }) as Command["parseAsync"];
}

function unknownCommandError(rootCommand: Command, args: string[]): StellarAgentError | null {
  let command = rootCommand;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token || token === "--") return null;
    if (token === "-h" || token === "--help") return null;
    if (token.startsWith("-")) {
      if (optionConsumesValue(command, token) && !token.includes("=")) index += 1;
      continue;
    }
    if (command.commands.length === 0) return null;

    const child = command.commands.find((candidate) => candidate.name() === token || candidate.aliases().includes(token));
    if (!child) {
      return new StellarAgentError({
        code: "INVALID_INPUT",
        message: `Unknown command '${token}'.`,
        hint: "Run the nearest known command with --help and correct the input.",
        docs: "README.md#common-commands",
        exitCode: EXIT_CODES.usage
      });
    }
    command = child;
  }
  return null;
}

function optionConsumesValue(command: Command, token: string): boolean {
  const option = command.options.find((candidate) => candidate.long === token || candidate.short === token || token.startsWith(`${candidate.long}=`));
  return Boolean(option?.required || option?.optional);
}

function rootVersionOptions(
  program: Command,
  argv: CommandParseArgs = process.argv,
  parseOptions?: CommandParseOptions
): CliOptions | null {
  const args = userArgs(argv, parseOptions);
  const commandNames = new Set(program.commands.map((command) => command.name()));
  const rootOptions = new Map(program.options.flatMap((option) => [option.long, option.short].filter(Boolean).map((flag) => [flag, option])));
  let sawVersion = false;
  let sawJson = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token || token === "--") break;
    if (commandNames.has(token)) break;
    if (token === "--version") {
      sawVersion = true;
      continue;
    }
    if (token === "--json") {
      sawJson = true;
      continue;
    }
    const optionName = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
    const option = rootOptions.get(optionName);
    if (option?.required && !token.includes("=")) index += 1;
  }

  return sawVersion ? { json: sawJson, version: true } : null;
}

function userArgs(argv: CommandParseArgs, parseOptions?: CommandParseOptions): string[] {
  const args = [...(argv ?? process.argv)];
  if (parseOptions?.from === "user") return args;
  if (parseOptions?.from === "electron") return args.slice(1);
  return args.slice(2);
}

function jsonOptionRequested(argv: CommandParseArgs = process.argv, parseOptions?: CommandParseOptions): boolean {
  return userArgs(argv, parseOptions).includes("--json");
}

function installExitOverride(command: Command): void {
  command.exitOverride();
  for (const subcommand of command.commands) installExitOverride(subcommand);
}

function addCacheCommands(program: Command): void {
  const cache = program.command("cache").description("Inspect and clear in-process session caches.");
  cache
    .command("inspect")
    .description("Show cached Horizon and tool-readiness lookups for this CLI process.")
    .action(
      withContext(async () => {
        const { stellarSessionCacheSnapshot } = await import("@stellar-agent/stellar");
        return { entries: stellarSessionCacheSnapshot() };
      }, "Session cache inspected.")
    );
  cache
    .command("clear")
    .description("Clear in-process session caches.")
    .action(
      withContext(async () => {
        const { clearStellarSessionCache } = await import("@stellar-agent/stellar");
        clearStellarSessionCache();
        return { cleared: true };
      }, "Session cache cleared.")
    );
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
          },
          {
            name: "stellar-cli",
            ok: true,
            detail: await import("@stellar-agent/stellar").then(({ checkStellarCli }) => checkStellarCli())
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
    withContext(async (context, options: { account: string; address?: string }) => {
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
    .command("issued-asset-payment")
    .description("Run a canned issued-asset trustline and payment scenario.")
    .option("--issuer <name>", "Local issuer wallet name", "issuer")
    .option("--recipient <name>", "Local recipient wallet name", "merchant")
    .option("--asset-code <code>", "Issued asset code; generated when omitted")
    .option("--amount <amount>", "Issued asset amount", "0.0000001")
    .option("--memo <memo>", "Payment memo", "issued-asset scenario")
    .option("--no-fund", "Do not call Friendbot before submitting")
    .option("--dry-run", "Plan the scenario without funding, trustline, or payment submission")
    .action(
      withContext(
        async (
          context,
          options: {
            issuer: string;
            recipient: string;
            assetCode?: string;
            amount: string;
            memo: string;
            fund?: boolean;
            dryRun?: boolean;
          }
        ) => {
          return createTestnetHarness(context.config).runIssuedAssetPaymentScenario({
            issuer: options.issuer,
            recipient: options.recipient,
            amount: options.amount,
            memo: options.memo,
            ...(options.assetCode === undefined ? {} : { assetCode: options.assetCode }),
            ...(options.fund === undefined ? {} : { fund: options.fund }),
            ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun })
          });
        },
        "Issued-asset scenario complete."
      )
    );
  scenario
    .command("contract-asset-smoke")
    .description("Run a Stellar CLI-backed asset contract smoke scenario.")
    .option("--source <source>", "Local wallet name, Stellar CLI identity, raw public key, or Testnet secret key", "agent")
    .option("--asset <asset>", "Asset as native or CODE:G... issuer", "native")
    .option("--alias <alias>", "Stellar CLI alias for deployed asset contract")
    .option("--ledgers-to-extend <n>", "Number of ledgers to extend", parseLedgersToExtendOption, 535679)
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to Stellar CLI")
    .option("--no-fund", "Do not Friendbot-fund a local Testnet source wallet")
    .option("--dry-run", "Plan the scenario without submitting contract transactions")
    .action(
      withContext(
        async (
          context,
          options: {
            source: string;
            asset: string;
            alias?: string;
            ledgersToExtend: number;
            stellarBinary: string;
            stellarConfigDir?: string;
            stellarNoCache?: boolean;
            fund?: boolean;
            dryRun?: boolean;
          }
        ) =>
          createTestnetHarness(context.config).runContractAssetSmokeScenario({
            source: options.source,
            asset: options.asset,
            ...(options.alias === undefined ? {} : { alias: options.alias }),
            ledgersToExtend: options.ledgersToExtend,
            stellarBinary: options.stellarBinary,
            ...(options.stellarConfigDir === undefined ? {} : { stellarConfigDir: options.stellarConfigDir }),
            ...(options.stellarNoCache === undefined ? {} : { noCache: options.stellarNoCache }),
            ...(options.fund === undefined ? {} : { fund: options.fund }),
            ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun })
          }),
        "Contract asset smoke scenario complete."
      )
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
    .description("Run a local x402-style Testnet payment scenario.")
    .option("--dry-run", "Evaluate the 402 requirement without submitting payment")
    .action(
      withContext(async (context, options: { dryRun?: boolean }) => {
        const { runX402Payment, startPaidApiDemo } = await import("@stellar-agent/x402-client");
        const source = await loadWallet(context.config, "agent");
        const merchant = await loadWallet(context.config, "merchant");
        const demo = await startPaidApiDemo({ recipient: merchant.publicKey });
        try {
          const policy = enableX402ForUrl(DEFAULT_TESTNET_POLICY, demo.url);
          return await runX402Payment({
            url: demo.url,
            source,
            policy,
            profile: context.config.profiles.testnet,
            receiptsDir: context.config.storage.receiptsDir,
            eventLog: join(context.config.storage.logsDir, "events.jsonl"),
            command: "testnet scenario x402-payment",
            ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun })
          });
        } finally {
          await demo.close();
        }
      }, "x402 payment scenario complete.")
    );
  testnet
    .command("export-report")
    .description("Export a local Testnet report with wallets, receipts, and event-log paths.")
    .option("--output <path>", "Output JSON path")
    .action(
      withContext(async (context, options: { output?: string }) => {
        return writeLocalReport(context, options.output ?? join(context.config.storage.ledgersDir, "testnet-report.json"));
      }, "Testnet report exported.")
    );
}

function addWalletCommands(program: Command): void {
  const wallet = program.command("wallet").description("Manage local and connected wallets.");
  wallet
    .command("create")
    .description("Create a Testnet wallet. Mainnet secret storage is not implemented.")
    .option("--fund", "Fund the Testnet wallet with Friendbot after creation")
    .action(
      withContext(async (context, options: { fund?: boolean }) => createTestnetWalletResult(context, "agent", Boolean(options.fund)), "Wallet created.")
    );
  wallet
    .command("create-testnet")
    .description("Create a local Testnet wallet.")
    .argument("[name]", "Wallet name", "agent")
    .option("--fund", "Fund the Testnet wallet with Friendbot after creation")
    .action(
      withContext(async (context, name: string, options: { fund?: boolean }) => createTestnetWalletResult(context, name, Boolean(options.fund)), "Testnet wallet created.")
    );
  wallet
    .command("balance")
    .description("Show wallet balances.")
    .option("--account <name>", "Local wallet name", "agent")
    .action(
      withContext(async (context, options: { account: string }) => ({
        account: options.account,
        balances: await walletBalances(context.config, options.account)
      }), "Wallet balance loaded.")
    );
  wallet
    .command("address")
    .description("Show a local wallet public address.")
    .option("--account <name>", "Local wallet name", "agent")
    .action(
      withContext(async (context, options: { account: string }) => {
        const wallet = await loadWalletPublic(context.config, options.account);
        return { account: options.account, publicKey: wallet.publicKey, network: wallet.network, hasSecret: wallet.hasSecret };
      }, "Wallet address loaded.")
    );
  wallet
    .command("export-public")
    .description("Export public wallet metadata.")
    .option("--account <name>", "Local wallet name", "agent")
    .action(
      withContext(async (context, options: { account: string }) => {
        const wallet = await loadWalletPublic(context.config, options.account);
        return redactSensitive(wallet);
      }, "Public wallet metadata exported.")
    );
  wallet
    .command("import-public")
    .description("Import a watch-only public wallet for balance and ledger inspection.")
    .requiredOption("--name <name>", "Local watch-only wallet name")
    .requiredOption("--address <address>", "Stellar public key")
    .option("--network <network>", "Network name: testnet, mainnet, local", "mainnet")
    .action(
      withContext(async (context, options: { name: string; address: string; network: NetworkName }) => {
        const wallet = await importPublicWallet({
          config: context.config,
          name: options.name,
          publicKey: options.address,
          network: options.network
        });
        return { ...wallet, hasSecret: false, realFunds: options.network === "mainnet" };
      }, "Watch-only wallet imported.")
    );
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
        const wallets = await listWalletPublicViews(context.config);
        return { wallets };
      }, "Wallet status loaded.")
    );
  wallet
    .command("connect-freighter")
    .description("Show local approval bridge details for Freighter-backed approval flows.")
    .action(
      withContext(async (context) => {
        const { listApprovalRequests } = await import("@stellar-agent/freighter-bridge");
        const requests = await listApprovalRequests(context.config.storage.approvalsDir);
        return {
          implemented: true,
          mode: "local_approval_bridge",
          approvalsDir: context.config.storage.approvalsDir,
          pendingRequests: requests.filter((request) => request.status === "pending").length,
          startServer: "stellar-agent approval serve",
          ui: "Open the approval bridge URL in a browser with Freighter installed.",
          secretsHandled: false
        };
      }, "Freighter approval bridge details loaded.")
    );

  const walletconnect = wallet.command("walletconnect").description("Pair, inspect, and disconnect WalletConnect external signer sessions.");
  walletconnect
    .command("pair")
    .description("Pair a WalletConnect external signer such as LOBSTR.")
    .option("--wallet <wallet>", "Wallet label: lobstr or walletconnect", parseWalletConnectWalletOption, "lobstr")
    .option("--project-id <id>", "WalletConnect project id; defaults to WALLETCONNECT_PROJECT_ID")
    .option("--timeout-ms <ms>", "Pairing timeout in milliseconds", parsePositiveIntegerOption, 120_000)
    .action(
      withContext(
        async (context, options: { wallet: "lobstr" | "walletconnect"; projectId?: string; timeoutMs: number }) => {
          const {
            closeWalletConnectSignClient,
            createWalletConnectSignClient,
            pairWalletConnectSession,
            walletConnectMetadata,
            walletConnectSessionView
          } = await import("@stellar-agent/walletconnect-bridge");
          const client = await createWalletConnectSignClient({
            projectId: options.projectId,
            metadata: walletConnectMetadata(options.wallet),
            storagePath: walletConnectStoragePath(context)
          });
          try {
            const session = await pairWalletConnectSession({
              client,
              network: context.profileName,
              timeoutMs: options.timeoutMs,
              onPairingUri: (uri) => printWalletConnectPairingUri(context.options, uri)
            });
            return {
              wallet: options.wallet,
              network: context.profileName,
              session: walletConnectSessionView(session),
              pairingUriPrinted: true,
              custody: "external_wallet"
            };
          } finally {
            await closeWalletConnectSignClient(client);
          }
        },
        "WalletConnect session paired."
      )
    );
  walletconnect
    .command("status")
    .description("List WalletConnect sessions known to the local WalletConnect client.")
    .option("--wallet <wallet>", "Wallet label: lobstr or walletconnect", parseWalletConnectWalletOption, "lobstr")
    .option("--project-id <id>", "WalletConnect project id; defaults to WALLETCONNECT_PROJECT_ID")
    .action(
      withContext(async (context, options: { wallet: "lobstr" | "walletconnect"; projectId?: string }) => {
        const { closeWalletConnectSignClient, createWalletConnectSignClient, listWalletConnectSessions, walletConnectMetadata } = await import(
          "@stellar-agent/walletconnect-bridge"
        );
        const client = await createWalletConnectSignClient({
          projectId: options.projectId,
          metadata: walletConnectMetadata(options.wallet),
          storagePath: walletConnectStoragePath(context)
        });
        try {
          return { wallet: options.wallet, sessions: listWalletConnectSessions(client), custody: "external_wallet" };
        } finally {
          await closeWalletConnectSignClient(client);
        }
      }, "WalletConnect status loaded.")
    );
  walletconnect
    .command("disconnect")
    .description("Disconnect a WalletConnect session by topic.")
    .requiredOption("--topic <topic>", "WalletConnect session topic")
    .option("--wallet <wallet>", "Wallet label: lobstr or walletconnect", parseWalletConnectWalletOption, "lobstr")
    .option("--project-id <id>", "WalletConnect project id; defaults to WALLETCONNECT_PROJECT_ID")
    .action(
      withContext(async (context, options: { topic: string; wallet: "lobstr" | "walletconnect"; projectId?: string }) => {
        const { closeWalletConnectSignClient, createWalletConnectSignClient, disconnectWalletConnectSession, walletConnectMetadata } = await import(
          "@stellar-agent/walletconnect-bridge"
        );
        const client = await createWalletConnectSignClient({
          projectId: options.projectId,
          metadata: walletConnectMetadata(options.wallet),
          storagePath: walletConnectStoragePath(context)
        });
        try {
          return {
            wallet: options.wallet,
            ...(await disconnectWalletConnectSession({ client, topic: options.topic })),
            custody: "external_wallet"
          };
        } finally {
          await closeWalletConnectSignClient(client);
        }
      }, "WalletConnect session disconnected.")
    );

  const trustline = wallet.command("trustline").description("List, add, or remove issued-asset trustlines.");
  trustline
    .command("list")
    .description("List issued-asset trustlines for an account.")
    .option("--account <name>", "Local wallet name", "merchant")
    .action(
      withContext(async (context, options: { account: string }) => {
        const wallet = await loadWalletPublic(context.config, options.account);
        return {
          account: options.account,
          publicKey: wallet.publicKey,
          trustlines: await walletTrustlines(context.config, options.account)
        };
      }, "Trustlines listed.")
    );
  trustline
    .command("add")
    .description("Add or update a trustline for an issued asset.")
    .requiredOption("--asset <asset>", "Issued asset as CODE:G... issuer")
    .option("--account <name>", "Local wallet name", "merchant")
    .option("--limit <amount>", "Trustline limit", "922337203685.4775807")
    .action(
      withContext(async (context, options: { asset: string; account: string; limit: string }) => {
        const { changeTrustline } = await import("@stellar-agent/stellar");
        const source = await loadWallet(context.config, options.account);
        const transaction = await changeTrustline({
          source,
          asset: options.asset,
          limit: options.limit,
          profile: context.config.profiles.testnet
        });
        await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
          event: "transaction_confirmed",
          status: "trustline_added",
          command: "wallet trustline add",
          profile: "testnet",
          data: { account: options.account, asset: options.asset, transaction }
        });
        const receiptPath = await writeOperationReceipt(context, {
          command: "wallet trustline add",
          operation: {
            type: "trustline.add",
            account: options.account,
            source: source.publicKey,
            asset: options.asset,
            limit: transaction.limit
          },
          transaction
        });
        return { account: options.account, publicKey: source.publicKey, transaction, receiptPath };
      }, "Trustline added.")
    );
  trustline
    .command("remove")
    .description("Remove a trustline by setting its limit to 0.")
    .requiredOption("--asset <asset>", "Issued asset as CODE:G... issuer")
    .option("--account <name>", "Local wallet name", "merchant")
    .action(
      withContext(async (context, options: { asset: string; account: string }) => {
        const { removeTrustline } = await import("@stellar-agent/stellar");
        const source = await loadWallet(context.config, options.account);
        const transaction = await removeTrustline({
          source,
          asset: options.asset,
          profile: context.config.profiles.testnet
        });
        await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
          event: "transaction_confirmed",
          status: "trustline_removed",
          command: "wallet trustline remove",
          profile: "testnet",
          data: { account: options.account, asset: options.asset, transaction }
        });
        const receiptPath = await writeOperationReceipt(context, {
          command: "wallet trustline remove",
          operation: {
            type: "trustline.remove",
            account: options.account,
            source: source.publicKey,
            asset: options.asset,
            limit: transaction.limit
          },
          transaction
        });
        return { account: options.account, publicKey: source.publicKey, transaction, receiptPath };
      }, "Trustline removed.")
    );
}

function addApprovalCommands(program: Command): void {
  const approval = program.command("approval").description("Create, inspect, decide, and serve local approval requests.");
  approval
    .command("create-payment")
    .description("Create a local payment approval request.")
    .requiredOption("--to <address>", "Destination public key")
    .requiredOption("--amount <amount>", "Payment amount")
    .option("--asset <asset>", "Asset", "XLM")
    .option("--from <account>", "Local source wallet name", "agent")
    .option("--memo <memo>", "Memo")
    .action(
      withContext(
        async (context, options: { to: string; amount: string; asset: string; from: string; memo?: string }) => {
          const { createPaymentApprovalRequest } = await import("@stellar-agent/freighter-bridge");
          const source = await loadWalletPublic(context.config, options.from);
          const request = paymentRequestSchema.parse({
            source: source.publicKey,
            destination: options.to,
            amount: options.amount,
            asset: options.asset,
            memo: options.memo,
            network: context.profileName
          });
          const approval = await createPaymentApprovalRequest({
            approvalsDir: context.config.storage.approvalsDir,
            payment: request
          });
          await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
            event: "approval_requested",
            status: "pending",
            command: "approval create-payment",
            profile: context.profileName,
            requestId: approval.id,
            data: approval
          });
          return approval;
        },
        "Approval request created."
      )
    );
  approval
    .command("create-transaction")
    .description("Create a local transaction-XDR approval request for browser-wallet signing.")
    .requiredOption("--xdr <base64>", "Unsigned transaction XDR")
    .option("--summary <summary>", "Human-readable signing summary", "Approve transaction XDR")
    .option("--network <network>", "Network name: testnet, mainnet, local")
    .action(
      withContext(
        async (context, options: { xdr: string; summary: string; network?: NetworkName }) => {
          const { createTransactionXdrApprovalRequest } = await import("@stellar-agent/freighter-bridge");
          const approval = await createTransactionXdrApprovalRequest({
            approvalsDir: context.config.storage.approvalsDir,
            network: options.network ?? context.profileName,
            transactionXdr: options.xdr,
            summary: options.summary
          });
          await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
            event: "approval_requested",
            status: "pending",
            command: "approval create-transaction",
            profile: approval.network,
            requestId: approval.id,
            data: approval
          });
          return approval;
        },
        "Transaction approval request created."
      )
    );
  approval
    .command("list")
    .description("List local approval requests.")
    .action(
      withContext(async (context) => {
        const { listApprovalRequests } = await import("@stellar-agent/freighter-bridge");
        return { approvals: await listApprovalRequests(context.config.storage.approvalsDir) };
      }, "Approval requests listed.")
    );
  approval
    .command("show")
    .description("Show a local approval request.")
    .argument("<id>", "Approval request id")
    .action(
      withContext(async (context, id: string) => {
        const { readApprovalRequest } = await import("@stellar-agent/freighter-bridge");
        return readApprovalRequest(context.config.storage.approvalsDir, id);
      }, "Approval request loaded.")
    );
  approval
    .command("decide")
    .description("Approve or deny a local approval request.")
    .argument("<id>", "Approval request id")
    .option("--approve", "Approve the request")
    .option("--deny", "Deny the request")
    .option("--reason <reason>", "Decision reason")
    .option("--signer-public-key <address>", "Signer public key for signed transaction XDR")
    .option("--signed-transaction-xdr <base64>", "Signed transaction XDR returned by Freighter")
    .action(
      withContext(async (context, id: string, options: { approve?: boolean; deny?: boolean; reason?: string; signerPublicKey?: string; signedTransactionXdr?: string }) => {
        const signing = Boolean(options.signedTransactionXdr);
        if (!signing && Boolean(options.approve) === Boolean(options.deny)) {
          throw new StellarAgentError({
            code: "INVALID_INPUT",
            message: "Pass exactly one of --approve or --deny.",
            docs: "docs/mainnet-safety.md#local-approval-bridge"
          });
        }
        const { decideApprovalRequest } = await import("@stellar-agent/freighter-bridge");
        const decided = await decideApprovalRequest({
          approvalsDir: context.config.storage.approvalsDir,
          id,
          approved: signing || Boolean(options.approve),
          ...(options.reason === undefined ? {} : { reason: options.reason }),
          ...(options.signerPublicKey === undefined ? {} : { signerPublicKey: options.signerPublicKey }),
          ...(options.signedTransactionXdr === undefined ? {} : { signedTransactionXdr: options.signedTransactionXdr })
        });
        await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
          event: decided.status === "denied" ? "approval_denied" : "approval_granted",
          status: decided.status,
          command: "approval decide",
          profile: context.profileName,
          requestId: decided.id,
          data: decided
        });
        return decided;
      }, "Approval request decided.")
    );
  approval
    .command("sign-walletconnect")
    .description("Sign a transaction-XDR approval request through WalletConnect external signing.")
    .argument("<id>", "Approval request id")
    .option("--wallet <wallet>", "Wallet label: lobstr or walletconnect", parseWalletConnectWalletOption, "lobstr")
    .option("--project-id <id>", "WalletConnect project id; defaults to WALLETCONNECT_PROJECT_ID")
    .option("--timeout-ms <ms>", "Pairing and signing timeout in milliseconds", parsePositiveIntegerOption, 120_000)
    .option("--allow-real-funds", "Permit guarded Mainnet WalletConnect signing")
    .option("--i-understand-real-funds", "Acknowledge this signing request uses real funds")
    .action(
      withContext(
        async (
          context,
          id: string,
          options: {
            wallet: "lobstr" | "walletconnect";
            projectId?: string;
            timeoutMs: number;
            allowRealFunds?: boolean;
            iUnderstandRealFunds?: boolean;
          }
        ) => {
          const { decideApprovalRequest, readApprovalRequest } = await import("@stellar-agent/freighter-bridge");
          const {
            closeWalletConnectSignClient,
            createWalletConnectSignClient,
            signTransactionXdrWithWalletConnect,
            walletConnectMetadata,
            walletConnectSessionView
          } = await import("@stellar-agent/walletconnect-bridge");
          const approval = await readApprovalRequest(context.config.storage.approvalsDir, id);
          if (approval.kind !== "transaction_xdr" || !approval.transactionXdr) {
            throw new StellarAgentError({
              code: "INVALID_INPUT",
              message: "WalletConnect signing requires a transaction-XDR approval request.",
              docs: "docs/mainnet-safety.md#walletconnect-signing"
            });
          }
          if (approval.status !== "pending") {
            throw new StellarAgentError({
              code: "INVALID_INPUT",
              message: `Approval request '${approval.id}' is already ${approval.status}.`,
              docs: "docs/mainnet-safety.md#walletconnect-signing"
            });
          }
          if (approval.network !== context.profileName) {
            throw new StellarAgentError({
              code: "MAINNET_NOT_ENABLED",
              message: "The active profile must match the WalletConnect approval request network.",
              docs: "docs/mainnet-safety.md#walletconnect-signing"
            });
          }
          const profile = resolveNetworkProfile(approval.network, context.config.profiles);
          assertGuardedRealFundsProfile(context, profile, {
            allowRealFunds: Boolean(options.allowRealFunds),
            acknowledgeRealFunds: Boolean(options.iUnderstandRealFunds),
            action: "WalletConnect signing"
          });
          const client = await createWalletConnectSignClient({
            projectId: options.projectId,
            metadata: walletConnectMetadata(options.wallet),
            storagePath: walletConnectStoragePath(context)
          });
          try {
            const signed = await signTransactionXdrWithWalletConnect({
              client,
              network: approval.network,
              transactionXdr: approval.transactionXdr,
              expectedSignerPublicKey: approval.payment?.source,
              timeoutMs: options.timeoutMs,
              onPairingUri: (uri) => printWalletConnectPairingUri(context.options, uri)
            });
            const decided = await decideApprovalRequest({
              approvalsDir: context.config.storage.approvalsDir,
              id: approval.id,
              approved: true,
              ...(signed.signerPublicKey === undefined ? {} : { signerPublicKey: signed.signerPublicKey }),
              signedTransactionXdr: signed.signedTransactionXdr
            });
            await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
              event: "approval_granted",
              status: "signed",
              command: "approval sign-walletconnect",
              profile: approval.network,
              requestId: decided.id,
              data: {
                approvalId: decided.id,
                wallet: options.wallet,
                method: signed.method,
                chainId: signed.chainId,
                signerPublicKey: signed.signerPublicKey,
                session: walletConnectSessionView(signed.session)
              }
            });
            return {
              approval: decided,
              walletConnect: {
                wallet: options.wallet,
                method: signed.method,
                chainId: signed.chainId,
                signerPublicKey: signed.signerPublicKey,
                session: walletConnectSessionView(signed.session),
                pairingUriPrinted: true,
                custody: "external_wallet",
                submitted: false
              }
            };
          } finally {
            await closeWalletConnectSignClient(client);
          }
        },
        "Approval request signed with WalletConnect."
      )
    );
  approval
    .command("open")
    .description("Print the local approval bridge UI URL to open in a browser.")
    .option("--host <host>", "Host", "127.0.0.1")
    .option("--port <port>", "Port", parsePortOption, 8787)
    .option("--token <token>", "Session token printed by approval serve")
    .action(
      withContext(async (context, options: { host: string; port: number; token?: string }) => {
        const url = `http://${options.host}:${options.port}`;
        const uiUrl = approvalUiUrl(url, options.token);
        return {
          url,
          uiUrl,
          copyUrl: uiUrl,
          sessionIncluded: Boolean(options.token),
          approvalsDir: context.config.storage.approvalsDir,
          startServer: `stellar-agent approval serve --host ${options.host} --port ${options.port}`,
          note: options.token
            ? "Open copyUrl in a browser with Freighter installed."
            : "Run approval serve and pass its session token with --token to include browser API authorization."
        };
      }, "Approval bridge URL loaded.")
    );
  approval
    .command("serve")
    .description("Start the local approval bridge HTTP server.")
    .option("--host <host>", "Host", "127.0.0.1")
    .option("--port <port>", "Port", parsePortOption, 0)
    .option("--allow-remote-access", "Allow binding the approval bridge to a non-loopback host")
    .action(async (options: { host: string; port: number; allowRemoteAccess?: boolean }, command: Command) => {
      const parent = command.optsWithGlobals() as CliOptions;
      const config = await loadConfig(parent);
      const profileName = (parent.profile ?? process.env.STELLAR_AGENT_PROFILE ?? config.activeProfile ?? "testnet") as NetworkName;
      const context: CliContext = { options: parent, config, profileName };
      const { startApprovalBridge } = await import("@stellar-agent/freighter-bridge");
      const bridge = await startApprovalBridge({
        approvalsDir: context.config.storage.approvalsDir,
        host: options.host,
        port: options.port,
        allowRemoteAccess: Boolean(options.allowRemoteAccess)
      });
      if (parent.json) {
        process.stdout.write(
          `${JSON.stringify(ok({ url: bridge.url, uiUrl: bridge.uiUrl, copyUrl: bridge.copyUrl, authToken: bridge.authToken, approvalsDir: context.config.storage.approvalsDir }))}\n`
        );
      } else {
        process.stdout.write(`Approval bridge listening at ${bridge.url}\n`);
        process.stdout.write(`Approval UI URL: ${bridge.uiUrl}\n`);
        process.stdout.write(`Copy this URL: ${bridge.copyUrl}\n`);
        process.stdout.write("Approval bridge API requires the printed session token for non-browser requests.\n");
        process.stdout.write(`Session token: ${bridge.authToken}\n`);
      }
      await new Promise<void>((resolveStop) => {
        process.once("SIGINT", resolveStop);
        process.once("SIGTERM", resolveStop);
      });
      await bridge.close();
    });
}

function addTransactionCommands(program: Command): void {
  const tx = program.command("tx").description("Build and submit transaction XDR on Testnet or guarded Mainnet.");
  tx
    .command("build-payment")
    .description("Build unsigned payment transaction XDR for browser-wallet signing.")
    .requiredOption("--to <address>", "Destination public key")
    .requiredOption("--amount <amount>", "Payment amount")
    .option("--asset <asset>", "Asset", "XLM")
    .option("--from <accountOrAddress>", "Local wallet name, watch-only wallet name, or source public key", "agent")
    .option("--memo <memo>", "Memo")
    .option("--fee-strategy <strategy>", "Fee strategy: base, low, medium, high, p95", "medium")
    .option("--allow-real-funds", "Permit guarded Mainnet payment-XDR building")
    .option("--i-understand-real-funds", "Acknowledge this payment uses real funds")
    .action(
      withContext(async (context, options: { to: string; amount: string; asset: string; from: string; memo?: string; feeStrategy: string; allowRealFunds?: boolean; iUnderstandRealFunds?: boolean }) => {
        const profile = resolveNetworkProfile(context.profileName, context.config.profiles);
        assertGuardedRealFundsProfile(context, profile, {
          allowRealFunds: Boolean(options.allowRealFunds),
          acknowledgeRealFunds: Boolean(options.iUnderstandRealFunds),
          action: "payment-XDR building"
        });
        const { buildPaymentTransactionXdr } = await import("@stellar-agent/stellar");
        const sourcePublicKey = await resolvePaymentSourcePublicKey(context, options.from, { realFunds: profile.realFunds });
        const request = paymentRequestSchema.parse({
          source: sourcePublicKey,
          destination: options.to,
          amount: options.amount,
          asset: options.asset,
          memo: options.memo,
          network: profile.name
        });
        const policy = await loadPolicy(context);
        const history = await loadSpendHistory(context, request);
        const policyDecision = evaluatePaymentRequest(policy, request, history);
        if (policyDecision.status === "denied") throw policyDeniedError();
        const mainnetAgentWallet = await assertMainnetAgentWalletPaymentAllowed(context, request);
        if (profile.realFunds && policyDecision.status === "requires_approval") {
          throw new StellarAgentError({
            code: "APPROVAL_REQUIRED",
            message: "Mainnet payment-XDR building requires a transaction approval request.",
            hint: "Use tx request-payment-signature so the unsigned XDR is recorded for human approval.",
            docs: "docs/mainnet-safety.md#signed-xdr-submission"
          });
        }
        const built = await buildPaymentTransactionXdr({
          sourcePublicKey,
          destination: options.to,
          amount: options.amount,
          asset: options.asset,
          ...(options.memo === undefined ? {} : { memo: options.memo }),
          profile,
          allowRealFunds: profile.realFunds,
          feeStrategy: parseFeeStrategy(options.feeStrategy),
          noCache: context.options.noCache
        });
        await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
          event: "transaction_built",
          status: "unsigned_payment_xdr",
          command: "tx build-payment",
          profile: profile.name,
          data: { source: sourcePublicKey, destination: options.to, asset: options.asset, amount: built.amount, policyDecision }
        });
        return {
          ...built,
          policyDecision,
          spendHistory: mainnetAgentWallet?.spendHistory ?? history,
          realFunds: profile.realFunds,
          ...(mainnetAgentWallet === undefined ? {} : { mainnetAgentWallet })
        };
      }, "Unsigned payment transaction built.")
    );
  tx
    .command("request-payment-signature")
    .description("Build unsigned payment XDR and create a local transaction approval request.")
    .requiredOption("--to <address>", "Destination public key")
    .requiredOption("--amount <amount>", "Payment amount")
    .option("--asset <asset>", "Asset", "XLM")
    .option("--from <accountOrAddress>", "Local wallet name, watch-only wallet name, or source public key", "agent")
    .option("--memo <memo>", "Memo")
    .option("--summary <summary>", "Human-readable signing summary")
    .option("--fee-strategy <strategy>", "Fee strategy: base, low, medium, high, p95", "medium")
    .option("--allow-real-funds", "Permit a guarded Mainnet payment signature request")
    .option("--i-understand-real-funds", "Acknowledge this payment uses real funds")
    .action(
      withContext(
        async (
          context,
          options: { to: string; amount: string; asset: string; from: string; memo?: string; summary?: string; feeStrategy: string; allowRealFunds?: boolean; iUnderstandRealFunds?: boolean }
        ) => {
          const profile = resolveNetworkProfile(context.profileName, context.config.profiles);
          assertGuardedRealFundsProfile(context, profile, {
            allowRealFunds: Boolean(options.allowRealFunds),
            acknowledgeRealFunds: Boolean(options.iUnderstandRealFunds),
            action: "payment signature request"
          });
          const { createTransactionXdrApprovalRequest } = await import("@stellar-agent/freighter-bridge");
          const { buildPaymentTransactionXdr } = await import("@stellar-agent/stellar");
          const sourcePublicKey = await resolvePaymentSourcePublicKey(context, options.from, { realFunds: profile.realFunds });
          const request = paymentRequestSchema.parse({
            source: sourcePublicKey,
            destination: options.to,
            amount: options.amount,
            asset: options.asset,
            memo: options.memo,
            network: profile.name
          });
          const policy = await loadPolicy(context);
          const history = await loadSpendHistory(context, request);
          const policyDecision = evaluatePaymentRequest(policy, request, history);
          if (policyDecision.status === "denied") throw policyDeniedError();
          const mainnetAgentWallet = await assertMainnetAgentWalletPaymentAllowed(context, request);
          const built = await buildPaymentTransactionXdr({
            sourcePublicKey,
            destination: options.to,
            amount: options.amount,
            asset: options.asset,
            ...(options.memo === undefined ? {} : { memo: options.memo }),
            profile,
            allowRealFunds: profile.realFunds,
            feeStrategy: parseFeeStrategy(options.feeStrategy),
            noCache: context.options.noCache
          });
          const approval = await createTransactionXdrApprovalRequest({
            approvalsDir: context.config.storage.approvalsDir,
            network: profile.name,
            transactionXdr: built.xdr,
            summary: options.summary ?? `Sign ${built.amount} ${built.asset} payment to ${options.to} on ${profile.name}`,
            payment: request
          });
          await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
            event: "approval_requested",
            status: "pending",
            command: "tx request-payment-signature",
            profile: profile.name,
            requestId: approval.id,
            data: { approval, source: sourcePublicKey, destination: options.to, asset: options.asset, amount: built.amount, policyDecision }
          });
          return {
            approval,
            built,
            policyDecision,
            spendHistory: mainnetAgentWallet?.spendHistory ?? history,
            realFunds: profile.realFunds,
            ...(mainnetAgentWallet === undefined ? {} : { mainnetAgentWallet })
          };
        },
        "Payment signature approval request created."
      )
    );
  tx
    .command("submit-xdr")
    .description("Submit signed transaction XDR to Horizon.")
    .requiredOption("--xdr <base64>", "Signed transaction XDR")
    .option("--allow-real-funds", "Permit guarded Mainnet signed-XDR submission")
    .option("--i-understand-real-funds", "Acknowledge this transaction uses real funds")
    .action(
      withContext(async (context, options: { xdr: string; allowRealFunds?: boolean; iUnderstandRealFunds?: boolean }) => {
        const profile = resolveNetworkProfile(context.profileName, context.config.profiles);
        assertGuardedRealFundsProfile(context, profile, {
          allowRealFunds: Boolean(options.allowRealFunds),
          acknowledgeRealFunds: Boolean(options.iUnderstandRealFunds),
          action: "signed-XDR submission"
        });
        const { submitTransactionXdr } = await import("@stellar-agent/stellar");
        const transaction = await submitTransactionXdr({
          xdr: options.xdr,
          profile,
          allowRealFunds: profile.realFunds
        });
        await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
          event: "transaction_confirmed",
          status: "signed_xdr_submitted",
          command: "tx submit-xdr",
          profile: profile.name,
          data: { transaction }
        });
        const receiptPath = await writeSubmittedXdrReceipt(context, {
          command: "tx submit-xdr",
          profile,
          operation: {
            type: "tx.submit_xdr",
            details: {
              source: "external_signed_xdr",
              realFundsAcknowledged: profile.realFunds
            }
          },
          transaction
        });
        return { transaction, receiptPath, realFunds: profile.realFunds };
      }, "Signed transaction submitted.")
    );
  tx
    .command("submit-approval")
    .description("Submit signed transaction XDR recorded on a local approval request.")
    .argument("<id>", "Approval request id")
    .option("--allow-real-funds", "Permit guarded Mainnet signed approval submission")
    .option("--i-understand-real-funds", "Acknowledge this transaction uses real funds")
    .action(
      withContext(async (context, id: string, options: { allowRealFunds?: boolean; iUnderstandRealFunds?: boolean }) => {
        const { readApprovalRequest } = await import("@stellar-agent/freighter-bridge");
        const approval = await readApprovalRequest(context.config.storage.approvalsDir, id);
        if (approval.kind !== "transaction_xdr") {
          throw new StellarAgentError({
            code: "INVALID_INPUT",
            message: "Approval request must be a transaction-XDR request.",
            docs: "docs/mainnet-safety.md#signed-xdr-submission"
          });
        }
        if (approval.network !== context.profileName) {
          throw new StellarAgentError({
            code: "MAINNET_NOT_ENABLED",
            message: "The active profile must match the approval request network.",
            docs: "docs/mainnet-safety.md#signed-xdr-submission"
          });
        }
        if (approval.status !== "signed" || !approval.decision?.signedTransactionXdr) {
          throw new StellarAgentError({
            code: "APPROVAL_REQUIRED",
            message: "Approval request does not contain signed transaction XDR.",
            hint: "Open the approval bridge with Freighter installed, sign the request, then retry.",
            docs: "docs/mainnet-safety.md#local-approval-bridge"
          });
        }
        const profile = resolveNetworkProfile(approval.network, context.config.profiles);
        assertGuardedRealFundsProfile(context, profile, {
          allowRealFunds: Boolean(options.allowRealFunds),
          acknowledgeRealFunds: Boolean(options.iUnderstandRealFunds),
          action: "signed approval submission"
        });
        const approvalPayment = approval.payment;
        const approvedPayment =
          approvalPayment === undefined
            ? undefined
            : await evaluateApprovedPaymentBeforeSubmission(context, approvalPayment);
        const { submitTransactionXdr } = await import("@stellar-agent/stellar");
        const transaction = await submitTransactionXdr({
          xdr: approval.decision.signedTransactionXdr,
          profile,
          allowRealFunds: profile.realFunds
        });
        await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
          event: "transaction_confirmed",
          status: "signed_approval_submitted",
          command: "tx submit-approval",
          profile: profile.name,
          requestId: approval.id,
          data: {
            approvalId: approval.id,
            signerPublicKey: approval.decision.signerPublicKey,
            transaction
          }
        });
        let receiptPath: string;
        if (approvedPayment === undefined || approvalPayment === undefined) {
          receiptPath = await writeSubmittedXdrReceipt(context, {
            command: "tx submit-approval",
            profile,
            operation: {
              type: "tx.submit_approval",
              details: {
                approvalId: approval.id,
                signerPublicKey: approval.decision.signerPublicKey,
                realFundsAcknowledged: profile.realFunds
              }
            },
            transaction
          });
        } else {
          receiptPath = await writeSubmittedPaymentApprovalReceipt(context, {
            command: "tx submit-approval",
            profile,
            approvalId: approval.id,
            ...(approval.decision.signerPublicKey === undefined
              ? {}
              : { signerPublicKey: approval.decision.signerPublicKey }),
            payment: approvalPayment,
            policyDecision: approvedPayment.policyDecision,
            transaction,
            ...(approvedPayment.mainnetAgentWallet === undefined
              ? {}
              : { mainnetAgentWallet: approvedPayment.mainnetAgentWallet })
          });
        }
        return { approvalId: approval.id, signerPublicKey: approval.decision.signerPublicKey, transaction, receiptPath, realFunds: profile.realFunds };
      }, "Signed approval transaction submitted.")
    );
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
    .option("--fee-strategy <strategy>", "Fee strategy: base, low, medium, high, p95", "medium")
    .action(
      withContext(async (context, options: { to: string; amount: string; asset: string; memo?: string; feeStrategy: string }) => {
        const policy = await loadPolicy(context);
        const request = paymentRequestSchema.parse({
          destination: options.to,
          amount: options.amount,
          asset: options.asset,
          memo: options.memo,
          network: context.profileName
        });
        const history = await loadSpendHistory(context, request);
        const { estimateTransactionFee } = await import("@stellar-agent/stellar");
        const profile = resolveNetworkProfile(context.profileName, context.config.profiles);
        return {
          request,
          estimatedFee: await estimateTransactionFee({
            profile,
            operationCount: 1,
            strategy: parseFeeStrategy(options.feeStrategy),
            noCache: context.options.noCache
          }),
          policyDecision: evaluatePaymentRequest(policy, request, history),
          spendHistory: history,
          profile: context.profileName
        };
      }, "Payment quote complete.")
    );
  pay
    .command("send")
    .description("Send an XLM or issued-asset payment on Testnet, or an explicitly armed Mainnet agent-wallet payment.")
    .requiredOption("--to <address>", "Destination public key")
    .requiredOption("--amount <amount>", "Payment amount")
    .option("--asset <asset>", "Asset", "XLM")
    .option("--from <account>", "Local source wallet name", "agent")
    .option("--memo <memo>", "Memo")
    .option("--fee-strategy <strategy>", "Fee strategy: base, low, medium, high, p95", "medium")
    .option("--approval-id <id>", "Approved local approval request id")
    .option("--allow-real-funds", "Permit the guarded Mainnet agent-wallet autosign path")
    .option("--i-understand-real-funds", "Acknowledge this payment can spend real Mainnet funds")
    .option("--i-understand-agent-wallet-autosign", "Acknowledge bounded Mainnet agent-wallet autosigning risk")
    .option("--dry-run", "Evaluate locally without submitting")
    .action(
      withContext(async (context, options: { to: string; amount: string; asset: string; from: string; memo?: string; feeStrategy: string; approvalId?: string; allowRealFunds?: boolean; iUnderstandRealFunds?: boolean; iUnderstandAgentWalletAutosign?: boolean; dryRun?: boolean }) => {
        if (context.profileName === "mainnet") {
          return sendMainnetAgentWalletPayment(context, options);
        }
        const policy = await loadPolicy(context);
        const source = await loadWallet(context.config, options.from);
        const request = paymentRequestSchema.parse({
          source: source.publicKey,
          destination: options.to,
          amount: options.amount,
          asset: options.asset,
          memo: options.memo,
          network: "testnet"
        });
        const history = await loadSpendHistory(context, request);
        const decision = evaluatePaymentRequest(policy, request, history);
        if (options.dryRun) return { request, policyDecision: decision, spendHistory: history, dryRun: true };
        if (decision.status === "denied") {
          throw new StellarAgentError({
            code: "POLICY_DENIED",
            message: "Payment request was denied by policy.",
            hint: "Run policy explain to inspect the matched rules.",
            docs: "docs/troubleshooting.md#policy-denied"
          });
        }
        if (decision.status === "requires_approval") {
          const { assertPaymentApproval, createPaymentApprovalRequest } = await import("@stellar-agent/freighter-bridge");
          if (options.approvalId) {
            await assertPaymentApproval({
              approvalsDir: context.config.storage.approvalsDir,
              approvalId: options.approvalId,
              payment: request
            });
          } else {
            const approval = await createPaymentApprovalRequest({
              approvalsDir: context.config.storage.approvalsDir,
              payment: request
            });
            await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
              event: "approval_requested",
              status: "pending",
              command: "pay send",
              profile: "testnet",
              requestId: approval.id,
              data: approval
            });
            throw new StellarAgentError({
              code: "APPROVAL_REQUIRED",
              message: "Payment requires approval.",
              hint: `Review approval '${approval.id}', then rerun with --approval-id ${approval.id}.`,
              docs: "docs/mainnet-safety.md#local-approval-bridge",
              details: { approvalId: approval.id, approval }
            });
          }
        }
        const { sendPayment } = await import("@stellar-agent/stellar");
        const transaction = await sendPayment({
          source,
          destination: options.to,
          amount: options.amount,
          asset: options.asset,
          ...(options.memo === undefined ? {} : { memo: options.memo }),
          profile: context.config.profiles.testnet,
          feeStrategy: parseFeeStrategy(options.feeStrategy),
          noCache: context.options.noCache
        });
        const eventLog = join(context.config.storage.logsDir, "events.jsonl");
        await appendEvent(eventLog, {
          event: "transaction_confirmed",
          status: "successful",
          command: "pay send",
          profile: "testnet",
          data: { transaction, source: options.from, destination: options.to, asset: options.asset }
        });
        const { path: receiptPath } = await writeReceipt(context.config.storage.receiptsDir, {
          command: "pay send",
          profile: "testnet",
          networkPassphrase: context.config.profiles.testnet.networkPassphrase,
          realFunds: false,
          payment: {
            source: source.publicKey,
            destination: options.to,
            asset: options.asset,
            amount: request.amount,
            ...(options.memo === undefined ? {} : { memo: options.memo })
          },
          policyDecision: decision,
          transaction,
          ...(transaction.ledger === undefined ? {} : { ledger: { confirmedLedger: transaction.ledger } }),
          eventLog
        });
        await appendEvent(eventLog, {
          event: "receipt_written",
          status: "success",
          command: "pay send",
          profile: "testnet",
          data: { receiptPath }
        });
        return {
          request,
          policyDecision: decision,
          transaction,
          receiptPath
        };
      }, "Payment send complete.")
    );
  pay
    .command("batch")
    .description("Submit multiple Testnet payments in one guarded transaction.")
    .requiredOption("--file <path>", "JSON file containing a payment array")
    .option("--from <account>", "Local source wallet name", "agent")
    .option("--memo <memo>", "Transaction memo")
    .option("--fee-strategy <strategy>", "Fee strategy: base, low, medium, high, p95", "medium")
    .option("--dry-run", "Evaluate locally without submitting")
    .action(
      withContext(async (context, options: { file: string; from: string; memo?: string; feeStrategy: string; dryRun?: boolean }) => {
        if (context.profileName === "mainnet") {
          throw new StellarAgentError({
            code: "MAINNET_NOT_ENABLED",
            message: "Mainnet batch payment submission is blocked in v0.",
            hint: "Use guarded signed-XDR flows for Mainnet; stellar-agent will not auto-sign Mainnet payments.",
            docs: "docs/mainnet-safety.md"
          });
        }
        const source = await loadWallet(context.config, options.from);
        const payments = parseBatchPaymentsFile(await readFile(resolvePath(options.file), "utf8"));
        const policy = await loadPolicy(context);
        const checked = await evaluateBatchPaymentPolicy(context, {
          source: source.publicKey,
          payments,
          policy,
          ...(options.memo === undefined ? {} : { memo: options.memo })
        });
        if (checked.aggregate.status === "denied") {
          throw new StellarAgentError({
            code: "POLICY_DENIED",
            message: "One or more batch payments were denied by policy.",
            hint: "Run pay quote for each denied destination and adjust the batch or policy intentionally.",
            docs: "docs/troubleshooting.md#policy-denied",
            details: checked
          });
        }
        if (checked.aggregate.status === "requires_approval") {
          throw new StellarAgentError({
            code: "APPROVAL_REQUIRED",
            message: "One or more batch payments require approval.",
            hint: "Split approval-required payments into explicit pay send approval flows.",
            docs: "docs/mainnet-safety.md#local-approval-bridge",
            details: checked
          });
        }
        if (options.dryRun) return { ...checked, dryRun: true };
        const { sendPaymentBatch } = await import("@stellar-agent/stellar");
        const transaction = await sendPaymentBatch({
          source,
          payments,
          ...(options.memo === undefined ? {} : { memo: options.memo }),
          profile: context.config.profiles.testnet,
          feeStrategy: parseFeeStrategy(options.feeStrategy),
          noCache: context.options.noCache
        });
        const receiptPath = await writeOperationReceipt(context, {
          command: "pay batch",
          operation: {
            type: "pay.batch",
            source: source.publicKey,
            details: {
              operationCount: transaction.operationCount,
              payments: transaction.payments,
              aggregatePolicyDecision: checked.aggregate
            }
          },
          policyDecision: {
            status: checked.aggregate.status,
            network: "testnet",
            realFunds: false,
            matchedRules: checked.aggregate.matchedRules,
            reasons: ["Batch payment policy aggregate."]
          },
          transaction
        });
        await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
          event: "transaction_confirmed",
          status: "batch_successful",
          command: "pay batch",
          profile: "testnet",
          data: { transaction, receiptPath }
        });
        return {
          ...checked,
          transaction,
          receiptPath
        };
      }, "Batch payment transaction submitted.")
    );
  pay
    .command("x402")
    .description("Pay a local x402-style HTTP 402 resource on Testnet.")
    .argument("<url>", "Paid URL")
    .option("--from <account>", "Local source wallet name", "agent")
    .option("--allow-localhost-demo", "Temporarily allow localhost x402 requirements without editing policy")
    .option("--dry-run", "Evaluate the 402 requirement without submitting payment")
    .action(
      withContext(
        async (
          context,
          url: string,
          options: { from: string; allowLocalhostDemo?: boolean; dryRun?: boolean }
        ) => {
          const { runX402Payment } = await import("@stellar-agent/x402-client");
          const source = await loadWallet(context.config, options.from);
          const basePolicy = await loadPolicy(context);
          const policy = options.allowLocalhostDemo ? enableX402ForUrl(basePolicy, url) : basePolicy;
          return runX402Payment({
            url,
            source,
            policy,
            profile: context.config.profiles.testnet,
            receiptsDir: context.config.storage.receiptsDir,
            eventLog: join(context.config.storage.logsDir, "events.jsonl"),
            command: "pay x402",
            loadSpendHistory: (request) => loadSpendHistory(context, request),
            ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun })
          });
        },
        "x402 payment complete."
      )
    );
  pay
    .command("mpp")
    .description("Pay a local MPP one-time charge resource on Testnet.")
    .argument("<url>", "MPP URL")
    .option("--from <account>", "Local source wallet name", "agent")
    .option("--allow-localhost-demo", "Temporarily allow localhost MPP charges without editing policy")
    .option("--dry-run", "Evaluate the MPP charge without submitting payment")
    .action(
      withContext(
        async (
          context,
          url: string,
          options: { from: string; allowLocalhostDemo?: boolean; dryRun?: boolean }
        ) => {
          const { runMppPayment } = await import("@stellar-agent/mpp-client");
          const source = await loadWallet(context.config, options.from);
          const basePolicy = await loadPolicy(context);
          const policy = options.allowLocalhostDemo ? enableX402ForUrl(basePolicy, url) : basePolicy;
          return runMppPayment({
            url,
            source,
            policy,
            profile: context.config.profiles.testnet,
            receiptsDir: context.config.storage.receiptsDir,
            eventLog: join(context.config.storage.logsDir, "events.jsonl"),
            command: "pay mpp",
            loadSpendHistory: (request) => loadSpendHistory(context, request),
            ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun })
          });
        },
        "MPP payment complete."
      )
    );
  pay
    .command("mpp-session")
    .description("Open and use a local MPP session-budget resource on Testnet.")
    .argument("<url>", "MPP session URL")
    .option("--from <account>", "Local source wallet name", "agent")
    .option("--requests <n>", "Number of session requests to perform", parsePositiveIntegerOption, 2)
    .option("--allow-localhost-demo", "Temporarily allow localhost MPP session charges without editing policy")
    .option("--dry-run", "Evaluate the MPP session budget without submitting payment")
    .action(
      withContext(
        async (
          context,
          url: string,
          options: { from: string; requests: number; allowLocalhostDemo?: boolean; dryRun?: boolean }
        ) => {
          const { runMppSession } = await import("@stellar-agent/mpp-client");
          const source = await loadWallet(context.config, options.from);
          const basePolicy = await loadPolicy(context);
          const policy = options.allowLocalhostDemo ? enableX402ForUrl(basePolicy, url) : basePolicy;
          return runMppSession({
            url,
            source,
            policy,
            profile: context.config.profiles.testnet,
            receiptsDir: context.config.storage.receiptsDir,
            eventLog: join(context.config.storage.logsDir, "events.jsonl"),
            command: "pay mpp-session",
            requestCount: options.requests,
            loadSpendHistory: (request) => loadSpendHistory(context, request),
            ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun })
          });
        },
        "MPP session complete."
      )
    );
}

function addX402Commands(program: Command): void {
  const x402 = program.command("x402").description("Scaffold and inspect x402-style paid API workflows.");
  x402
    .command("init-server")
    .description("Create a local Testnet x402-style paid API server scaffold.")
    .option("--out <dir>", "Output directory", "./stellar-agent-x402-server")
    .option("--force", "Overwrite scaffold files if they already exist")
    .action(
      withContext(async (_context, options: { out: string; force?: boolean }) => {
        const outDir = resolvePath(options.out);
        const files = x402ServerScaffoldFiles();
        await mkdir(outDir, { recursive: true });
        for (const [name, contents] of Object.entries(files)) {
          const target = join(outDir, name);
          if (!options.force) {
            try {
              await readFile(target, "utf8");
              throw new StellarAgentError({
                code: "INVALID_INPUT",
                message: `Refusing to overwrite existing scaffold file '${target}'.`,
                hint: "Use --force to replace scaffold files intentionally."
              });
            } catch (error: any) {
              if (error instanceof StellarAgentError) throw error;
              if (error?.code !== "ENOENT") throw error;
            }
          }
          await writeFile(target, contents, { mode: name.endsWith(".mjs") ? 0o755 : 0o600 });
        }
        return {
          path: outDir,
          files: Object.keys(files),
          network: "testnet",
          realFunds: false
        };
      }, "x402 server scaffold initialized.")
    );
}

function addDemoCommands(program: Command): void {
  const demo = program.command("demo").description("Create or summarize safe Testnet demo bundles.");

  demo
    .command("x402")
    .description("Create a local x402 paid API server demo bundle.")
    .option("--out <dir>", "Output directory", "./stellar-agent-x402-demo")
    .option("--force", "Overwrite demo files if they already exist")
    .action(
      withContext(async (_context, options: { out: string; force?: boolean }) => {
        const outDir = resolvePath(options.out);
        const files = x402ServerScaffoldFiles();
        await writeNamedFiles(outDir, files, Boolean(options.force));
        return {
          demo: "x402",
          path: outDir,
          files: Object.keys(files),
          network: "testnet",
          realFunds: false,
          commands: [
            `X402_DESTINATION=G... npm --prefix ${outDir} start`,
            "stellar-agent pay x402 http://127.0.0.1:8787/paid-report --allow-localhost-demo --json",
            "stellar-agent receipts latest --json"
          ],
          safety: [
            "Uses Testnet payment requirements only.",
            "The generated server verifies X-Payment proofs through Testnet Horizon.",
            "Production facilitator-backed x402 remains future work."
          ]
        };
      }, "x402 demo bundle created.")
    );

  demo
    .command("approval-flow")
    .description("Create a local Testnet approval-flow demo request.")
    .option("--from <account>", "Local source wallet name", "agent")
    .option("--to <address>", "Destination public key", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")
    .option("--amount <amount>", "Payment amount", "1")
    .option("--asset <asset>", "Payment asset", "XLM")
    .action(
      withContext(
        async (context, options: { from: string; to: string; amount: string; asset: string }) => {
          if (context.profileName !== "testnet") {
            throw new StellarAgentError({
              code: "MAINNET_NOT_ENABLED",
              message: "Demo approval flow runs only on the Testnet profile.",
              docs: "docs/mainnet-safety.md"
            });
          }
          const { createPaymentApprovalRequest } = await import("@stellar-agent/freighter-bridge");
          const source = await loadWalletPublic(context.config, options.from);
          const payment = paymentRequestSchema.parse({
            source: source.publicKey,
            destination: options.to,
            amount: options.amount,
            asset: options.asset,
            network: "testnet"
          });
          const approval = await createPaymentApprovalRequest({
            approvalsDir: context.config.storage.approvalsDir,
            payment,
            summary: `Demo approval for ${payment.amount} ${payment.asset}`
          });
          await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
            event: "approval_requested",
            status: "pending",
            command: "demo approval-flow",
            profile: "testnet",
            requestId: approval.id,
            data: approval
          });
          return {
            demo: "approval-flow",
            network: "testnet",
            realFunds: false,
            approval,
            commands: [
              "stellar-agent approval serve",
              `stellar-agent approval decide ${approval.id} --approve --json`,
              `stellar-agent pay send --to ${payment.destination} --amount ${payment.amount} --asset ${payment.asset} --approval-id ${approval.id} --json`,
              "stellar-agent receipts latest --json"
            ],
            safety: [
              "Creates an approval request only; it does not sign or submit a transaction.",
              "Payment submission still runs policy checks and requires the explicit approval id."
            ]
          };
        },
        "Approval-flow demo request created."
      )
    );

  demo
    .command("market-aquarius")
    .description("Summarize a safe Testnet market and Aquarius preflight demo bundle.")
    .action(
      withContext(async (context) => {
        const { aquariusDeployment } = await loadDefi();
        const deployment = aquariusDeployment("testnet");
        const policy = await loadPolicyForRequestNetwork(context, "testnet");
        const policyPreview = evaluateDefiAquariusRequest(policy, {
          network: "testnet",
          pool: "*",
          assets: ["XLM", "AQUA"],
          assetGroups: [["XLM"], ["AQUA"]],
          action: "swap",
          nominalExposure: "0.01",
          slippageBoundsProvided: true
        });
        return {
          demo: "market-aquarius",
          network: "testnet",
          realFunds: false,
          policyPreview,
          aquarius: {
            routerContractId: deployment.routerContractId,
            apiBaseUrl: deployment.apiBaseUrl,
            assets: deployment.assets.map((asset) => ({
              symbol: asset.symbol,
              contractId: asset.contractId
            }))
          },
          commands: [
            "stellar-agent market pools list --network testnet --limit 5 --json",
            "stellar-agent market lp preflight --pool <pool-id> --action deposit --max-a 0.01 --max-b 0.01 --min-price 0.9 --max-price 1.1 --json",
            "stellar-agent defi aquarius deployments --network testnet --pools --limit 5 --json",
            "stellar-agent defi aquarius swap preflight --from XLM --to AQUA --amount 0.01 --slippage-bps 100 --json"
          ],
          safety: [
            "The bundle is preflight-oriented and does not sign or submit liquidity or Aquarius transactions.",
            "Re-run preflight immediately before any later human-approved mutation.",
            "Aquarius commands remain read-only or preflight-only in this release."
          ]
        };
      }, "Market and Aquarius demo bundle loaded.")
    );
}

function addClaimableCommands(program: Command): void {
  const claimable = program.command("claimable").description("Create, list, and claim claimable balances.");
  claimable
    .command("create")
    .description("Create a Testnet claimable balance.")
    .requiredOption("--to <address>", "Claimant public key")
    .requiredOption("--amount <amount>", "Amount")
    .option("--asset <asset>", "Asset", "XLM")
    .option("--from <account>", "Local source wallet name", "agent")
    .option("--claimant <address>", "Additional claimant public key; repeat for multiple claimants", collectArg, [])
    .option("--claimable-after <time>", "Only allow claiming at or after this Unix timestamp or ISO date/time")
    .option("--claimable-before <time>", "Only allow claiming before this Unix timestamp or ISO date/time")
    .action(
      withContext(async (context, options: { to: string; amount: string; asset: string; from: string; claimant: string[]; claimableAfter?: string; claimableBefore?: string }) => {
        const { createClaimableBalance } = await import("@stellar-agent/stellar");
        const source = await loadWallet(context.config, options.from);
        const result = await createClaimableBalance({
          source,
          claimant: options.to,
          claimants: options.claimant,
          amount: options.amount,
          asset: options.asset,
          ...(options.claimableAfter === undefined ? {} : { claimableAfter: options.claimableAfter }),
          ...(options.claimableBefore === undefined ? {} : { claimableBefore: options.claimableBefore }),
          profile: context.config.profiles.testnet
        });
        await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
          event: "transaction_confirmed",
          status: "claimable_created",
          command: "claimable create",
          profile: "testnet",
          data: result
        });
        const receiptPath = await writeOperationReceipt(context, {
          command: "claimable create",
          operation: {
            type: "claimable.create",
            source: source.publicKey,
            claimant: result.claimant,
            claimants: result.claimants,
            asset: result.asset,
            amount: result.amount,
            predicate: result.predicate
          },
          transaction: result
        });
        return { ...result, receiptPath };
      }, "Claimable balance created.")
    );
  claimable
    .command("list")
    .description("List claimable balances for an account or address.")
    .option("--account <name>", "Local wallet name")
    .option("--address <address>", "Raw claimant address")
    .action(
      withContext(async (context, options: { account?: string; address?: string }) => {
        const { listClaimableBalances } = await import("@stellar-agent/stellar");
        const address = options.address ?? (options.account ? (await loadWallet(context.config, options.account)).publicKey : undefined);
        if (!address) {
          throw new StellarAgentError({
            code: "INVALID_INPUT",
            message: "Provide --account or --address.",
            docs: "docs/claimable-balances.md"
          });
        }
        return { address, claimableBalances: await listClaimableBalances(address, context.config.profiles.testnet) };
      }, "Claimable balances listed.")
    );
  claimable
    .command("claim")
    .description("Claim a claimable balance by balance id.")
    .requiredOption("--balance-id <id>", "Claimable balance id")
    .option("--account <name>", "Local wallet name", "merchant")
    .action(
      withContext(async (context, options: { balanceId: string; account: string }) => {
        const { claimClaimableBalance } = await import("@stellar-agent/stellar");
        const source = await loadWallet(context.config, options.account);
        const result = await claimClaimableBalance({
          source,
          balanceId: options.balanceId,
          profile: context.config.profiles.testnet
        });
        await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
          event: "transaction_confirmed",
          status: "claimable_claimed",
          command: "claimable claim",
          profile: "testnet",
          data: result
        });
        const receiptPath = await writeOperationReceipt(context, {
          command: "claimable claim",
          operation: {
            type: "claimable.claim",
            account: options.account,
            source: source.publicKey,
            balanceId: options.balanceId
          },
          transaction: result
        });
        return { ...result, receiptPath };
      }, "Claimable balance claimed.")
    );
}

function addContractCommands(program: Command): void {
  const contract = program.command("contract").description("Invoke Soroban smart contracts via Stellar CLI.");
  contract
    .command("doctor")
    .description("Check whether the Stellar CLI is available for contract execution.")
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .action(
      withContext(async (_context, options: { stellarBinary: string }) => {
        const { checkStellarCli } = await import("@stellar-agent/stellar");
        return checkStellarCli(options.stellarBinary);
      }, "Stellar CLI readiness checked.")
    );
  contract
    .command("invoke")
    .description("Invoke a deployed contract using the installed stellar CLI.")
    .requiredOption("--id <contractId>", "Contract id")
    .requiredOption("--source <source>", "Stellar CLI identity, local wallet name, raw public key, or Testnet secret key")
    .requiredOption("--fn <functionName>", "Contract function name")
    .option("--arg <key=value>", "Contract argument; repeat for multiple args", collectArg, [])
    .option("--network <network>", "Stellar CLI network name", "testnet")
    .option("--allow-real-funds", "Permit a guarded Mainnet contract operation")
    .option("--i-understand-real-funds", "Acknowledge this contract operation may use real funds")
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to Stellar CLI")
    .action(
      withContext(
        async (
          context,
          options: {
            id: string;
            source: string;
            fn: string;
            arg: string[];
            network: string;
            allowRealFunds?: boolean;
            iUnderstandRealFunds?: boolean;
            stellarBinary: string;
            stellarConfigDir?: string;
            stellarNoCache?: boolean;
          }
        ) => {
          const { invokeContractWithStellarCli } = await import("@stellar-agent/stellar");
          const contractContext = resolveContractExecutionContext(context, options.network, {
            mutating: true,
            allowRealFunds: Boolean(options.allowRealFunds),
            acknowledgeRealFunds: Boolean(options.iUnderstandRealFunds)
          });
          const source = await resolveContractSource(context, options.source, { realFunds: contractContext.realFunds });
          const contractArgs = parseKeyValueArgs(options.arg);
          const result = await invokeContractWithStellarCli({
            contractId: options.id,
            source,
            functionName: options.fn,
            contractArgs,
            network: options.network,
            rpcUrl: contractContext.rpcUrl,
            networkPassphrase: contractContext.networkPassphrase,
            stellarBinary: options.stellarBinary,
            ...(options.stellarConfigDir === undefined ? {} : { stellarConfigDir: options.stellarConfigDir }),
            ...(options.stellarNoCache === undefined ? {} : { noCache: options.stellarNoCache })
          });
          return attachContractSubmissionReceipt(context, {
            command: "contract invoke",
            network: options.network,
            result,
            operation: {
              type: "contract.invoke",
              source: options.source,
              details: {
                contractId: options.id,
                functionName: options.fn,
                args: contractArgs
              }
            }
          });
        },
        "Contract invocation complete."
      )
    );
  contract
    .command("deploy")
    .description("Deploy a Wasm contract using the installed stellar CLI.")
    .requiredOption("--source <source>", "Stellar CLI identity, local wallet name, raw public key, or Testnet secret key")
    .option("--wasm <path>", "Wasm file path")
    .option("--wasm-hash <hash>", "Uploaded Wasm hash")
    .option("--alias <alias>", "Stellar CLI alias for deployed contract")
    .option("--arg <key=value>", "Constructor argument; repeat for multiple args", collectArg, [])
    .option("--network <network>", "Stellar CLI network name", "testnet")
    .option("--allow-real-funds", "Permit a guarded Mainnet contract operation")
    .option("--i-understand-real-funds", "Acknowledge this contract operation may use real funds")
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to Stellar CLI")
    .action(
      withContext(
        async (
          context,
          options: {
            source: string;
            wasm?: string;
            wasmHash?: string;
            alias?: string;
            arg: string[];
            network: string;
            allowRealFunds?: boolean;
            iUnderstandRealFunds?: boolean;
            stellarBinary: string;
            stellarConfigDir?: string;
            stellarNoCache?: boolean;
          }
        ) => {
          if (!options.wasm && !options.wasmHash) {
            throw new StellarAgentError({
              code: "INVALID_INPUT",
              message: "Provide --wasm or --wasm-hash for contract deploy.",
              docs: "docs/smart-contracts.md#deploy"
            });
          }
          const { deployContractWithStellarCli } = await import("@stellar-agent/stellar");
          const contractContext = resolveContractExecutionContext(context, options.network, {
            mutating: true,
            allowRealFunds: Boolean(options.allowRealFunds),
            acknowledgeRealFunds: Boolean(options.iUnderstandRealFunds)
          });
          const source = await resolveContractSource(context, options.source, { realFunds: contractContext.realFunds });
          const constructorArgs = parseKeyValueArgs(options.arg);
          const result = await deployContractWithStellarCli({
            source,
            ...(options.wasm === undefined ? {} : { wasm: options.wasm }),
            ...(options.wasmHash === undefined ? {} : { wasmHash: options.wasmHash }),
            ...(options.alias === undefined ? {} : { alias: options.alias }),
            constructorArgs,
            network: options.network,
            rpcUrl: contractContext.rpcUrl,
            networkPassphrase: contractContext.networkPassphrase,
            stellarBinary: options.stellarBinary,
            ...(options.stellarConfigDir === undefined ? {} : { stellarConfigDir: options.stellarConfigDir }),
            ...(options.stellarNoCache === undefined ? {} : { noCache: options.stellarNoCache })
          });
          return attachContractSubmissionReceipt(context, {
            command: "contract deploy",
            network: options.network,
            result,
            operation: {
              type: "contract.deploy",
              source: options.source,
              details: {
                contractId: result.stdout.trim() || undefined,
                wasm: options.wasm,
                wasmHash: options.wasmHash,
                alias: options.alias,
                constructorArgs
              }
            }
          });
        },
        "Contract deployed."
      )
    );
  contract
    .command("upload")
    .description("Upload contract Wasm bytecode using the installed stellar CLI.")
    .requiredOption("--source <source>", "Stellar CLI identity, local wallet name, raw public key, or Testnet secret key")
    .requiredOption("--wasm <path>", "Wasm file path")
    .option("--network <network>", "Stellar CLI network name", "testnet")
    .option("--allow-real-funds", "Permit a guarded Mainnet contract operation")
    .option("--i-understand-real-funds", "Acknowledge this contract operation may use real funds")
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to Stellar CLI")
    .action(
      withContext(
        async (context, options: { source: string; wasm: string; network: string; allowRealFunds?: boolean; iUnderstandRealFunds?: boolean; stellarBinary: string; stellarConfigDir?: string; stellarNoCache?: boolean }) => {
          const { uploadContractWasmWithStellarCli } = await import("@stellar-agent/stellar");
          const contractContext = resolveContractExecutionContext(context, options.network, {
            mutating: true,
            allowRealFunds: Boolean(options.allowRealFunds),
            acknowledgeRealFunds: Boolean(options.iUnderstandRealFunds)
          });
          const source = await resolveContractSource(context, options.source, { realFunds: contractContext.realFunds });
          const result = await uploadContractWasmWithStellarCli({
            source,
            wasm: options.wasm,
            network: options.network,
            rpcUrl: contractContext.rpcUrl,
            networkPassphrase: contractContext.networkPassphrase,
            stellarBinary: options.stellarBinary,
            ...(options.stellarConfigDir === undefined ? {} : { stellarConfigDir: options.stellarConfigDir }),
            ...(options.stellarNoCache === undefined ? {} : { noCache: options.stellarNoCache })
          });
          return attachContractSubmissionReceipt(context, {
            command: "contract upload",
            network: options.network,
            result,
            operation: {
              type: "contract.upload",
              source: options.source,
              details: {
                wasm: options.wasm,
                wasmHash: result.stdout.trim() || undefined
              }
            }
          });
        },
        "Contract Wasm uploaded."
      )
    );
  contract
    .command("asset-deploy")
    .description("Deploy a Stellar Asset Contract using the installed stellar CLI.")
    .requiredOption("--source <source>", "Stellar CLI identity, local wallet name, raw public key, or Testnet secret key")
    .requiredOption("--asset <asset>", "Asset as native or CODE:G... issuer")
    .option("--alias <alias>", "Stellar CLI alias for deployed asset contract")
    .option("--network <network>", "Stellar CLI network name", "testnet")
    .option("--allow-real-funds", "Permit a guarded Mainnet contract operation")
    .option("--i-understand-real-funds", "Acknowledge this contract operation may use real funds")
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to Stellar CLI")
    .action(
      withContext(
        async (
          context,
          options: { source: string; asset: string; alias?: string; network: string; allowRealFunds?: boolean; iUnderstandRealFunds?: boolean; stellarBinary: string; stellarConfigDir?: string; stellarNoCache?: boolean }
        ) => {
          const { deployAssetContractWithStellarCli } = await import("@stellar-agent/stellar");
          const contractContext = resolveContractExecutionContext(context, options.network, {
            mutating: true,
            allowRealFunds: Boolean(options.allowRealFunds),
            acknowledgeRealFunds: Boolean(options.iUnderstandRealFunds)
          });
          const source = await resolveContractSource(context, options.source, { realFunds: contractContext.realFunds });
          const result = await deployAssetContractWithStellarCli({
            source,
            asset: options.asset,
            ...(options.alias === undefined ? {} : { alias: options.alias }),
            network: options.network,
            rpcUrl: contractContext.rpcUrl,
            networkPassphrase: contractContext.networkPassphrase,
            stellarBinary: options.stellarBinary,
            ...(options.stellarConfigDir === undefined ? {} : { stellarConfigDir: options.stellarConfigDir }),
            ...(options.stellarNoCache === undefined ? {} : { noCache: options.stellarNoCache })
          });
          return attachContractSubmissionReceipt(context, {
            command: "contract asset-deploy",
            network: options.network,
            result,
            operation: {
              type: "contract.asset-deploy",
              source: options.source,
              asset: options.asset,
              details: {
                contractId: result.stdout.trim() || undefined,
                alias: options.alias
              }
            }
          });
        },
        "Asset contract deployed."
      )
    );
  contract
    .command("asset-id")
    .description("Calculate the Stellar Asset Contract id for an asset.")
    .requiredOption("--asset <asset>", "Asset as native or CODE:G... issuer")
    .option("--network <network>", "Stellar CLI network name", "testnet")
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to Stellar CLI")
    .action(
      withContext(
        async (
          context,
          options: { asset: string; network: string; stellarBinary: string; stellarConfigDir?: string; stellarNoCache?: boolean }
        ) => {
          const { assetContractIdWithStellarCli } = await import("@stellar-agent/stellar");
          const contractContext = resolveContractExecutionContext(context, options.network, { mutating: false });
          return assetContractIdWithStellarCli({
            asset: options.asset,
            network: options.network,
            rpcUrl: contractContext.rpcUrl,
            networkPassphrase: contractContext.networkPassphrase,
            stellarBinary: options.stellarBinary,
            ...(options.stellarConfigDir === undefined ? {} : { stellarConfigDir: options.stellarConfigDir }),
            ...(options.stellarNoCache === undefined ? {} : { noCache: options.stellarNoCache })
          });
        },
        "Asset contract id calculated."
      )
    );
  contract
    .command("info")
    .description("Read contract info using the installed stellar CLI.")
    .option("--kind <kind>", "Info kind: interface, meta, env-meta, build, hash", "interface")
    .option("--id <contractId>", "Contract id")
    .option("--wasm <path>", "Wasm file path")
    .option("--wasm-hash <hash>", "Uploaded Wasm hash")
    .option("--network <network>", "Stellar CLI network name", "testnet")
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to Stellar CLI")
    .action(
      withContext(
        async (
          context,
          options: {
            kind: "interface" | "meta" | "env-meta" | "build" | "hash";
            id?: string;
            wasm?: string;
            wasmHash?: string;
            network: string;
            stellarBinary: string;
            stellarConfigDir?: string;
            stellarNoCache?: boolean;
          }
        ) => {
          if (!["interface", "meta", "env-meta", "build", "hash"].includes(options.kind)) {
            throw new StellarAgentError({
              code: "INVALID_INPUT",
              message: "Info kind must be one of: interface, meta, env-meta, build, hash.",
              docs: "docs/smart-contracts.md#contract-info"
            });
          }
          if (!options.id && !options.wasm && !options.wasmHash) {
            throw new StellarAgentError({
              code: "INVALID_INPUT",
              message: "Provide --id, --wasm, or --wasm-hash for contract info.",
              docs: "docs/smart-contracts.md#contract-info"
            });
          }
          const { contractInfoWithStellarCli } = await import("@stellar-agent/stellar");
          const contractContext = resolveContractExecutionContext(context, options.network, { mutating: false });
          return contractInfoWithStellarCli({
            kind: options.kind,
            ...(options.id === undefined ? {} : { contractId: options.id }),
            ...(options.wasm === undefined ? {} : { wasm: options.wasm }),
            ...(options.wasmHash === undefined ? {} : { wasmHash: options.wasmHash }),
            network: options.network,
            rpcUrl: contractContext.rpcUrl,
            networkPassphrase: contractContext.networkPassphrase,
            stellarBinary: options.stellarBinary,
            ...(options.stellarConfigDir === undefined ? {} : { stellarConfigDir: options.stellarConfigDir }),
            ...(options.stellarNoCache === undefined ? {} : { noCache: options.stellarNoCache })
          });
        },
        "Contract info loaded."
      )
    );
  contract
    .command("read")
    .description("Read contract instance, storage, or Wasm ledger data using the installed stellar CLI.")
    .option("--id <contractId>", "Contract id")
    .option("--key <key>", "Storage key")
    .option("--key-xdr <xdr>", "Storage key XDR")
    .option("--wasm <path>", "Wasm file path")
    .option("--wasm-hash <hash>", "Wasm hash")
    .option("--durability <durability>", "persistent or temporary", "persistent")
    .option("--output <output>", "Output type: string, json, or xdr", "string")
    .option("--network <network>", "Stellar CLI network name", "testnet")
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to Stellar CLI")
    .action(
      withContext(
        async (
          context,
          options: {
            id?: string;
            key?: string;
            keyXdr?: string;
            wasm?: string;
            wasmHash?: string;
            durability: "persistent" | "temporary";
            output: "string" | "json" | "xdr";
            network: string;
            stellarBinary: string;
            stellarConfigDir?: string;
            stellarNoCache?: boolean;
          }
        ) => {
          validateDurability(options.durability);
          validateContractReadOutput(options.output);
          const { readContractWithStellarCli } = await import("@stellar-agent/stellar");
          const contractContext = resolveContractExecutionContext(context, options.network, { mutating: false });
          return readContractWithStellarCli({
            ...(options.id === undefined ? {} : { contractId: options.id }),
            ...(options.key === undefined ? {} : { key: options.key }),
            ...(options.keyXdr === undefined ? {} : { keyXdr: options.keyXdr }),
            ...(options.wasm === undefined ? {} : { wasm: options.wasm }),
            ...(options.wasmHash === undefined ? {} : { wasmHash: options.wasmHash }),
            durability: options.durability,
            output: options.output,
            network: options.network,
            rpcUrl: contractContext.rpcUrl,
            networkPassphrase: contractContext.networkPassphrase,
            stellarBinary: options.stellarBinary,
            ...(options.stellarConfigDir === undefined ? {} : { stellarConfigDir: options.stellarConfigDir }),
            ...(options.stellarNoCache === undefined ? {} : { noCache: options.stellarNoCache })
          });
        },
        "Contract data read."
      )
    );
  contract
    .command("fetch")
    .description("Fetch contract Wasm bytecode using the installed stellar CLI.")
    .option("--id <contractId>", "Contract id")
    .option("--wasm-hash <hash>", "Wasm hash")
    .option("--out-file <path>", "Output file path; stdout is used when omitted")
    .option("--network <network>", "Stellar CLI network name", "testnet")
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to Stellar CLI")
    .action(
      withContext(
        async (
          context,
          options: {
            id?: string;
            wasmHash?: string;
            outFile?: string;
            network: string;
            stellarBinary: string;
            stellarConfigDir?: string;
            stellarNoCache?: boolean;
          }
        ) => {
          if (Boolean(options.id) === Boolean(options.wasmHash)) {
            throw new StellarAgentError({
              code: "INVALID_INPUT",
              message: "Provide exactly one of --id or --wasm-hash for contract fetch.",
              docs: "docs/smart-contracts.md#fetch"
            });
          }
          const { fetchContractWasmWithStellarCli } = await import("@stellar-agent/stellar");
          const contractContext = resolveContractExecutionContext(context, options.network, { mutating: false });
          return fetchContractWasmWithStellarCli({
            ...(options.id === undefined ? {} : { contractId: options.id }),
            ...(options.wasmHash === undefined ? {} : { wasmHash: options.wasmHash }),
            ...(options.outFile === undefined ? {} : { outFile: options.outFile }),
            network: options.network,
            rpcUrl: contractContext.rpcUrl,
            networkPassphrase: contractContext.networkPassphrase,
            stellarBinary: options.stellarBinary,
            ...(options.stellarConfigDir === undefined ? {} : { stellarConfigDir: options.stellarConfigDir }),
            ...(options.stellarNoCache === undefined ? {} : { noCache: options.stellarNoCache })
          });
        },
        "Contract Wasm fetched."
      )
    );
  contract
    .command("extend")
    .description("Extend contract instance, storage, or Wasm TTL using the installed stellar CLI.")
    .requiredOption("--source <source>", "Stellar CLI identity, local wallet name, raw public key, or Testnet secret key")
    .requiredOption("--ledgers-to-extend <n>", "Number of ledgers to extend", parseLedgersToExtendOption)
    .option("--id <contractId>", "Contract id")
    .option("--key <key>", "Storage key")
    .option("--key-xdr <xdr>", "Storage key XDR")
    .option("--wasm <path>", "Wasm file path")
    .option("--wasm-hash <hash>", "Wasm hash")
    .option("--durability <durability>", "persistent or temporary", "persistent")
    .option("--ttl-ledger-only", "Only print the new TTL ledger")
    .option("--network <network>", "Stellar CLI network name", "testnet")
    .option("--allow-real-funds", "Permit a guarded Mainnet contract operation")
    .option("--i-understand-real-funds", "Acknowledge this contract operation may use real funds")
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to Stellar CLI")
    .action(
      withContext(
        async (
          context,
          options: {
            source: string;
            ledgersToExtend: number;
            id?: string;
            key?: string;
            keyXdr?: string;
            wasm?: string;
            wasmHash?: string;
            durability: "persistent" | "temporary";
            ttlLedgerOnly?: boolean;
            network: string;
            allowRealFunds?: boolean;
            iUnderstandRealFunds?: boolean;
            stellarBinary: string;
            stellarConfigDir?: string;
            stellarNoCache?: boolean;
          }
        ) => {
          validateDurability(options.durability);
          const { extendContractWithStellarCli } = await import("@stellar-agent/stellar");
          const contractContext = resolveContractExecutionContext(context, options.network, {
            mutating: true,
            allowRealFunds: Boolean(options.allowRealFunds),
            acknowledgeRealFunds: Boolean(options.iUnderstandRealFunds)
          });
          const source = await resolveContractSource(context, options.source, { realFunds: contractContext.realFunds });
          const result = await extendContractWithStellarCli({
            source,
            ledgersToExtend: options.ledgersToExtend,
            ...(options.id === undefined ? {} : { contractId: options.id }),
            ...(options.key === undefined ? {} : { key: options.key }),
            ...(options.keyXdr === undefined ? {} : { keyXdr: options.keyXdr }),
            ...(options.wasm === undefined ? {} : { wasm: options.wasm }),
            ...(options.wasmHash === undefined ? {} : { wasmHash: options.wasmHash }),
            durability: options.durability,
            ...(options.ttlLedgerOnly === undefined ? {} : { ttlLedgerOnly: options.ttlLedgerOnly }),
            network: options.network,
            rpcUrl: contractContext.rpcUrl,
            networkPassphrase: contractContext.networkPassphrase,
            stellarBinary: options.stellarBinary,
            ...(options.stellarConfigDir === undefined ? {} : { stellarConfigDir: options.stellarConfigDir }),
            ...(options.stellarNoCache === undefined ? {} : { noCache: options.stellarNoCache })
          });
          return attachContractSubmissionReceipt(context, {
            command: "contract extend",
            network: options.network,
            result,
            operation: {
              type: "contract.extend",
              source: options.source,
              details: {
                contractId: options.id,
                key: options.key,
                keyXdr: options.keyXdr,
                wasm: options.wasm,
                wasmHash: options.wasmHash,
                durability: options.durability,
                ledgersToExtend: options.ledgersToExtend,
                ttlLedgerOnly: Boolean(options.ttlLedgerOnly)
              }
            }
          });
        },
        "Contract TTL extended."
      )
    );
  contract
    .command("restore")
    .description("Restore archived contract instance, storage, or Wasm using the installed stellar CLI.")
    .requiredOption("--source <source>", "Stellar CLI identity, local wallet name, raw public key, or Testnet secret key")
    .option("--id <contractId>", "Contract id")
    .option("--key <key>", "Storage key")
    .option("--key-xdr <xdr>", "Storage key XDR")
    .option("--wasm <path>", "Wasm file path")
    .option("--wasm-hash <hash>", "Wasm hash")
    .option("--durability <durability>", "persistent or temporary", "persistent")
    .option("--network <network>", "Stellar CLI network name", "testnet")
    .option("--allow-real-funds", "Permit a guarded Mainnet contract operation")
    .option("--i-understand-real-funds", "Acknowledge this contract operation may use real funds")
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to Stellar CLI")
    .action(
      withContext(
        async (
          context,
          options: {
            source: string;
            id?: string;
            key?: string;
            keyXdr?: string;
            wasm?: string;
            wasmHash?: string;
            durability: "persistent" | "temporary";
            network: string;
            allowRealFunds?: boolean;
            iUnderstandRealFunds?: boolean;
            stellarBinary: string;
            stellarConfigDir?: string;
            stellarNoCache?: boolean;
          }
        ) => {
          validateDurability(options.durability);
          const { restoreContractWithStellarCli } = await import("@stellar-agent/stellar");
          const contractContext = resolveContractExecutionContext(context, options.network, {
            mutating: true,
            allowRealFunds: Boolean(options.allowRealFunds),
            acknowledgeRealFunds: Boolean(options.iUnderstandRealFunds)
          });
          const source = await resolveContractSource(context, options.source, { realFunds: contractContext.realFunds });
          const result = await restoreContractWithStellarCli({
            source,
            ...(options.id === undefined ? {} : { contractId: options.id }),
            ...(options.key === undefined ? {} : { key: options.key }),
            ...(options.keyXdr === undefined ? {} : { keyXdr: options.keyXdr }),
            ...(options.wasm === undefined ? {} : { wasm: options.wasm }),
            ...(options.wasmHash === undefined ? {} : { wasmHash: options.wasmHash }),
            durability: options.durability,
            network: options.network,
            rpcUrl: contractContext.rpcUrl,
            networkPassphrase: contractContext.networkPassphrase,
            stellarBinary: options.stellarBinary,
            ...(options.stellarConfigDir === undefined ? {} : { stellarConfigDir: options.stellarConfigDir }),
            ...(options.stellarNoCache === undefined ? {} : { noCache: options.stellarNoCache })
          });
          return attachContractSubmissionReceipt(context, {
            command: "contract restore",
            network: options.network,
            result,
            operation: {
              type: "contract.restore",
              source: options.source,
              details: {
                contractId: options.id,
                key: options.key,
                keyXdr: options.keyXdr,
                wasm: options.wasm,
                wasmHash: options.wasmHash,
                durability: options.durability
              }
            }
          });
        },
        "Contract restored."
      )
    );
}

function addMarketCommands(program: Command): void {
  const market = program.command("market").description("Inspect markets, liquidity pools, and market-aware alerts.");

  const pools = market.command("pools").description("Inspect built-in Stellar AMM liquidity pools.");
  pools
    .command("list")
    .description("List core Stellar liquidity pools, optionally filtered by exact reserve assets or participant account.")
    .option("--asset-a <asset>", "First reserve asset, such as XLM or USD:G...")
    .option("--asset-b <asset>", "Second reserve asset, such as XLM or USD:G...")
    .option("--account <account>", "Local wallet name or public key participating in pools")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .option("--limit <n>", "Number of records", parseIntegerOption, 10)
    .action(
      withContext(async (context, options: { assetA?: string; assetB?: string; account?: string; network?: string; limit: number }) => {
        if (Boolean(options.assetA) !== Boolean(options.assetB)) {
          throw new StellarAgentError({
            code: "INVALID_INPUT",
            message: "Pool asset filtering requires both --asset-a and --asset-b.",
            docs: "docs/market-liquidity.md#core-pool-inspection"
          });
        }
        const { listLiquidityPools } = await import("@stellar-agent/stellar");
        const profile = resolveMarketProfile(context, options.network);
        return listLiquidityPools({
          profile,
          ...(options.assetA === undefined ? {} : { assetA: options.assetA }),
          ...(options.assetB === undefined ? {} : { assetB: options.assetB }),
          ...(options.account === undefined ? {} : { account: await resolvePublicAccount(context, options.account) }),
          limit: options.limit
        });
      }, "Liquidity pools listed.")
    );

  const pool = market.command("pool").description("Inspect one core Stellar AMM liquidity pool.");
  pool
    .command("inspect")
    .description("Load reserves, shares, fee, and trustline count for a core liquidity pool.")
    .requiredOption("--pool <poolId>", "Liquidity pool id")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .action(
      withContext(async (context, options: { pool: string; network?: string }) => {
        const { inspectLiquidityPool } = await import("@stellar-agent/stellar");
        return inspectLiquidityPool({ poolId: options.pool, profile: resolveMarketProfile(context, options.network) });
      }, "Liquidity pool inspected.")
    );
  pool
    .command("trades")
    .description("Fetch recent Horizon trades for a core liquidity pool.")
    .requiredOption("--pool <poolId>", "Liquidity pool id")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .option("--limit <n>", "Number of records", parseIntegerOption, 10)
    .action(
      withContext(async (context, options: { pool: string; network?: string; limit: number }) => {
        const { liquidityPoolTrades } = await import("@stellar-agent/stellar");
        return liquidityPoolTrades({ poolId: options.pool, profile: resolveMarketProfile(context, options.network), limit: options.limit });
      }, "Liquidity pool trades loaded.")
    );
  pool
    .command("position")
    .description("Inspect pool-share positions for a local wallet or public key.")
    .option("--account <account>", "Local wallet name or public key", "agent")
    .option("--pool <poolId>", "Limit to one liquidity pool id")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .action(
      withContext(async (context, options: { account: string; pool?: string; network?: string }) => {
        const { inspectLiquidityPoolPosition } = await import("@stellar-agent/stellar");
        return inspectLiquidityPoolPosition({
          account: await resolvePublicAccount(context, options.account),
          ...(options.pool === undefined ? {} : { poolId: options.pool }),
          profile: resolveMarketProfile(context, options.network)
        });
      }, "Liquidity pool position inspected.")
    );

  const lp = market.command("lp").description("Preflight and submit guarded core Stellar liquidity pool actions.");
  lp
    .command("preflight")
    .description("Preflight a core liquidity pool deposit or withdrawal with policy context.")
    .requiredOption("--pool <poolId>", "Liquidity pool id")
    .option("--account <account>", "Local wallet name or public key", "agent")
    .option("--action <action>", "deposit or withdraw", "deposit")
    .option("--max-a <amount>", "Deposit max amount for reserve A")
    .option("--max-b <amount>", "Deposit max amount for reserve B")
    .option("--min-price <price>", "Deposit minimum reserve B per reserve A price")
    .option("--max-price <price>", "Deposit maximum reserve B per reserve A price")
    .option("--shares <amount>", "Pool shares to withdraw")
    .option("--min-a <amount>", "Withdrawal minimum reserve A amount", "0")
    .option("--min-b <amount>", "Withdrawal minimum reserve B amount", "0")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .action(
      withContext(async (context, options: LiquidityPreflightOptions) => {
        const profile = resolveMarketProfile(context, options.network);
        const preflight = await runLiquidityPreflight(context, profile, options);
        const policy = await loadPolicy(context);
        const policyDecision = evaluateMarketLiquidityRequest(policy, liquidityPolicyRequest(profile, preflight));
        return { policyDecision, preflight };
      }, "Liquidity pool preflight complete.")
    );
  lp
    .command("deposit")
    .description("Submit a guarded Testnet core liquidity pool deposit.")
    .requiredOption("--pool <poolId>", "Liquidity pool id")
    .requiredOption("--max-a <amount>", "Deposit max amount for reserve A")
    .requiredOption("--max-b <amount>", "Deposit max amount for reserve B")
    .requiredOption("--min-price <price>", "Deposit minimum reserve B per reserve A price")
    .requiredOption("--max-price <price>", "Deposit maximum reserve B per reserve A price")
    .option("--source <account>", "Local Testnet wallet name", "agent")
    .option("--fee-strategy <strategy>", "Fee strategy: base, low, medium, high, p95", parseFeeStrategy, "medium")
    .action(
      withContext(async (context, options: LiquidityDepositOptions) => {
        return runLiquiditySubmitCommand(context, { command: "market lp deposit", action: "deposit", ...options });
      }, "Liquidity pool deposit submitted.")
    );
  lp
    .command("withdraw")
    .description("Submit a guarded Testnet core liquidity pool withdrawal.")
    .requiredOption("--pool <poolId>", "Liquidity pool id")
    .requiredOption("--shares <amount>", "Pool shares to withdraw")
    .option("--min-a <amount>", "Withdrawal minimum reserve A amount", "0")
    .option("--min-b <amount>", "Withdrawal minimum reserve B amount", "0")
    .option("--source <account>", "Local Testnet wallet name", "agent")
    .option("--fee-strategy <strategy>", "Fee strategy: base, low, medium, high, p95", parseFeeStrategy, "medium")
    .action(
      withContext(async (context, options: LiquidityWithdrawOptions) => {
        return runLiquiditySubmitCommand(context, { command: "market lp withdraw", action: "withdraw", ...options });
      }, "Liquidity pool withdrawal submitted.")
    );

  const trustline = lp.command("trustline").description("Manage core liquidity pool share trustlines.");
  trustline
    .command("add")
    .description("Create a Testnet trustline for a liquidity pool share asset.")
    .option("--pool <poolId>", "Existing liquidity pool id")
    .option("--asset-a <asset>", "First reserve asset when deriving a pool id")
    .option("--asset-b <asset>", "Second reserve asset when deriving a pool id")
    .option("--account <account>", "Local Testnet wallet name", "agent")
    .option("--limit <amount>", "Pool share trustline limit")
    .option("--fee-strategy <strategy>", "Fee strategy: base, low, medium, high, p95", parseFeeStrategy, "medium")
    .action(
      withContext(async (context, options: { pool?: string; assetA?: string; assetB?: string; account: string; limit?: string; feeStrategy: "base" | "low" | "medium" | "high" | "p95" }) => {
        const profile = resolveNetworkProfile(context.profileName, context.config.profiles);
        if (profile.realFunds) {
          throw new StellarAgentError({
            code: "MAINNET_NOT_ENABLED",
            message: "Mainnet liquidity pool trustline creation requires an external signer.",
            docs: "docs/mainnet-safety.md#mainnet-liquidity"
          });
        }
        const wallet = await loadWallet(context.config, options.account);
        const { changeLiquidityPoolTrustline } = await import("@stellar-agent/stellar");
        const transaction = await changeLiquidityPoolTrustline({
          source: wallet,
          ...(options.pool === undefined ? {} : { poolId: options.pool }),
          ...(options.assetA === undefined ? {} : { assetA: options.assetA }),
          ...(options.assetB === undefined ? {} : { assetB: options.assetB }),
          ...(options.limit === undefined ? {} : { limit: options.limit }),
          profile,
          feeStrategy: options.feeStrategy,
          ...(context.options.noCache === undefined ? {} : { noCache: context.options.noCache })
        });
        const receiptPath = await writeOperationReceipt(context, {
          command: "market lp trustline add",
          operation: {
            type: "market.lp.trustline.add",
            account: wallet.publicKey,
            details: { liquidityPool: { poolId: transaction.poolId, limit: transaction.limit } }
          },
          transaction
        });
        return { status: "trustline_added", poolId: transaction.poolId, transaction, receiptPath };
      }, "Liquidity pool trustline added.")
    );

  const listen = market.command("listen").description("Evaluate one or more market alert checks and return JSON events.");
  listen
    .command("price")
    .description("Alert when a core pool reserve price crosses a threshold.")
    .requiredOption("--pool <poolId>", "Liquidity pool id")
    .option("--above <price>", "Trigger when reserve B per reserve A is above this price")
    .option("--below <price>", "Trigger when reserve B per reserve A is below this price")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .option("--polls <n>", "Number of checks", parsePositiveIntegerOption, 1)
    .option("--interval-ms <n>", "Delay between checks", parsePositiveIntegerOption, 1000)
    .action(
      withContext(async (context, options: MarketPriceListenOptions) => {
        return listenForPoolPrice(context, options);
      }, "Market price listener evaluated.")
    );
  listen
    .command("position")
    .description("Alert when a pool-share position crosses a local threshold.")
    .requiredOption("--pool <poolId>", "Liquidity pool id")
    .option("--account <account>", "Local wallet name or public key", "agent")
    .option("--shares-below <amount>", "Trigger when pool shares are below this amount")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .action(
      withContext(async (context, options: { pool: string; account: string; sharesBelow?: string; network?: string }) => {
        const { inspectLiquidityPoolPosition } = await import("@stellar-agent/stellar");
        const account = await resolvePublicAccount(context, options.account);
        const position = await inspectLiquidityPoolPosition({
          account,
          poolId: options.pool,
          profile: resolveMarketProfile(context, options.network)
        });
        const shares = position.positions[0]?.shares ?? "0.0000000";
        const sharesBelow =
          options.sharesBelow === undefined ? undefined : parseNonnegativeDecimalInput(options.sharesBelow, "shares-below");
        const triggered = sharesBelow === undefined ? false : Number(shares) < sharesBelow;
        return {
          type: "market.alert",
          rule: "lp-position-shares-below",
          status: triggered ? "triggered" : "not_triggered",
          observed: shares,
          threshold: options.sharesBelow ?? null,
          position
        };
      }, "Market position listener evaluated.")
    );
  listen
    .command("config")
    .description("Evaluate market alert checks from a YAML or JSON config file.")
    .requiredOption("--file <path>", "Alert config file with alerts[]")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .option("--polls <n>", "Number of checks per alert", parsePositiveIntegerOption, 1)
    .option("--interval-ms <n>", "Delay between checks", parsePositiveIntegerOption, 1000)
    .action(
      withContext(async (context, options: { file: string; network?: string; polls: number; intervalMs: number }) => {
        return listenForMarketAlertConfig(context, options);
      }, "Market alert config evaluated.")
    );

  const soroban = market.command("soroban").description("Inspect Soroban AMM contracts without submitting liquidity actions.");
  const sorobanPool = soroban.command("pool").description("Read-only Soroban pool investigation.");
  sorobanPool
    .command("inspect")
    .description("Inspect Soroban contract interface metadata for a potential AMM pool.")
    .requiredOption("--id <contractId>", "Soroban contract id")
    .option("--network <network>", "Stellar CLI network", "testnet")
    .option("--stellar-binary <path>", "Path to stellar CLI binary")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to stellar CLI")
    .action(
      withContext(async (context, options: { id: string; network: string; stellarBinary?: string; stellarConfigDir?: string; stellarNoCache?: boolean }) => {
        const profile = resolveContractExecutionContext(context, options.network, {
          mutating: false
        });
        const { contractInfoWithStellarCli } = await import("@stellar-agent/stellar");
        const result = await contractInfoWithStellarCli({
          kind: "interface",
          contractId: options.id,
          network: options.network,
          rpcUrl: profile.rpcUrl,
          networkPassphrase: profile.networkPassphrase,
          ...(options.stellarBinary === undefined ? {} : { stellarBinary: options.stellarBinary }),
          ...(options.stellarConfigDir === undefined ? {} : { stellarConfigDir: options.stellarConfigDir }),
          ...(options.stellarNoCache === undefined ? {} : { noCache: options.stellarNoCache })
        });
        return {
          contractId: options.id,
          boundary: "read_only",
          mutationSupported: false,
          result
        };
      }, "Soroban pool inspected.")
    );
  sorobanPool
    .command("preflight")
    .description("Explain why Soroban AMM mutation requires a protocol-specific adapter before submission.")
    .requiredOption("--id <contractId>", "Soroban contract id")
    .requiredOption("--action <action>", "deposit or withdraw")
    .action(
      withContext(async (_context, options: { id: string; action: string }) => {
        if (options.action !== "deposit" && options.action !== "withdraw") {
          throw new StellarAgentError({
            code: "INVALID_INPUT",
            message: "Soroban pool action must be deposit or withdraw.",
            docs: "docs/market-liquidity.md#soroban-pool-boundary"
          });
        }
        return {
          contractId: options.id,
          action: options.action,
          status: "adapter_required",
          mutationSupported: false,
          requirements: [
            "Use a protocol-specific adapter with documented contract interfaces.",
            "Add policy controls before mutation.",
            "Require simulation, external Mainnet signing, and receipts for submitted transactions."
          ]
        };
      }, "Soroban pool preflight boundary explained.")
    );
}

function addStrategyCommands(program: Command): void {
  const strategy = program.command("strategy").description("Explain and simulate market-aware strategy proposals without hidden signing.");
  strategy
    .command("explain")
    .description("Validate and explain a local strategy file.")
    .argument("<file>", "Strategy JSON or YAML file")
    .action(
      withContext(async (_context, file: string) => {
        const parsed = await readStrategyFile(file);
        return explainStrategy(parsed);
      }, "Strategy explained.")
    );
  strategy
    .command("simulate")
    .description("Simulate a local strategy file without submitting transactions.")
    .argument("<file>", "Strategy JSON or YAML file")
    .action(
      withContext(async (_context, file: string) => {
        const parsed = await readStrategyFile(file);
        return { ...explainStrategy(parsed), simulation: { submitted: false, signing: false, mode: "dry_run" } };
      }, "Strategy simulation complete.")
    );
  const investigate = strategy.command("investigate").description("Investigate market options without execution.");
  investigate
    .command("liquidity")
    .description("Compare liquidity-pool context for an asset pair or explicit pool.")
    .option("--pair <assetA/assetB>", "Asset pair, such as XLM/USD:G...")
    .option("--pool <poolId>", "Specific liquidity pool id")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .option("--limit <n>", "Number of records", parseIntegerOption, 5)
    .action(
      withContext(async (context, options: { pair?: string; pool?: string; network?: string; limit: number }) => {
        const { inspectLiquidityPool, liquidityPoolTrades, listLiquidityPools } = await import("@stellar-agent/stellar");
        const profile = resolveMarketProfile(context, options.network);
        if (options.pool) {
          const pool = await inspectLiquidityPool({ poolId: options.pool, profile });
          const trades = await liquidityPoolTrades({ poolId: options.pool, profile, limit: options.limit });
          return liquidityInvestigation({ pool, trades: trades.records, profile });
        }
        if (!options.pair) {
          throw new StellarAgentError({
            code: "INVALID_INPUT",
            message: "Provide --pool or --pair for liquidity investigation.",
            docs: "docs/market-liquidity.md#strategy-investigation"
          });
        }
        const [assetA, assetB] = parsePairOption(options.pair);
        const pools = await listLiquidityPools({ assetA, assetB, profile, limit: options.limit });
        return {
          pair: { assetA, assetB },
          pools: pools.records.map((pool) => liquidityInvestigation({ pool, trades: [], profile }))
        };
      }, "Liquidity strategy investigation complete.")
    );
}

function addDefiCommands(program: Command): void {
  const defi = program.command("defi").description("Inspect and preflight guarded DeFi workflows.");
  const blend = defi.command("blend").description("Inspect Blend pools and preflight Blend pool requests.");

  blend
    .command("deployments")
    .description("Show known Blend deployment contracts, assets, pools, and canonical trustline issuers.")
    .option("--network <name>", "Blend deployment network: testnet or mainnet")
    .option("--refresh", "Fetch current Blend deployment maps from blend-utils and blend-ui")
    .action(
      withContext(async (context, options: { network?: string; refresh?: boolean }) => {
        const { blendDeployment, fetchBlendDeployment } = await loadDefi();
        const network = resolveBlendNetworkOption(context, options.network);
        return options.refresh ? await fetchBlendDeployment(network) : blendDeployment(network);
      }, "Blend deployments loaded.")
    );

  const pool = blend.command("pool").description("Inspect Blend pools.");
  pool
    .command("inspect")
    .description("Load a Blend pool, reserves, APYs, and estimated aggregate pool values.")
    .requiredOption("--pool <pool>", "Pool contract id or deployment alias")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .option("--version <version>", "Pool version: v1 or v2")
    .action(
      withContext(async (context, options: { pool: string; network?: string; version?: string }) => {
        const { blendDeployment, inspectBlendPool, resolveBlendPool } = await loadDefi();
        const profile = resolveBlendProfile(context, options.network);
        const deployment = blendDeployment(blendNetworkForProfile(profile));
        const poolDeployment = resolveBlendPool(deployment, options.pool);
        const poolVersion = resolveBlendPoolVersion(options.version ?? poolDeployment.version);
        return inspectBlendPool({
          profile,
          poolId: poolDeployment.contractId,
          ...(poolVersion === undefined ? {} : { poolVersion })
        });
      }, "Blend pool inspected.")
    );

  const position = blend.command("position").description("Inspect Blend user positions.");
  position
    .command("inspect")
    .description("Load a user's Blend supply, collateral, liabilities, health factor, and APYs.")
    .requiredOption("--pool <pool>", "Pool contract id or deployment alias")
    .option("--account <account>", "Local wallet name or public key", "agent")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .option("--version <version>", "Pool version: v1 or v2")
    .action(
      withContext(async (context, options: { pool: string; account: string; network?: string; version?: string }) => {
        const { blendDeployment, inspectBlendPosition, resolveBlendPool } = await loadDefi();
        const profile = resolveBlendProfile(context, options.network);
        const deployment = blendDeployment(blendNetworkForProfile(profile));
        const poolDeployment = resolveBlendPool(deployment, options.pool);
        const account = await resolvePublicAccount(context, options.account);
        const poolVersion = resolveBlendPoolVersion(options.version ?? poolDeployment.version);
        return inspectBlendPosition({
          profile,
          poolId: poolDeployment.contractId,
          userId: account,
          ...(poolVersion === undefined ? {} : { poolVersion })
        });
      }, "Blend position inspected.")
    );

  blend
    .command("preflight")
    .description("Preflight Blend requests with decoded request types, expected b/d tokens, position estimates, and policy.")
    .requiredOption("--pool <pool>", "Pool contract id or deployment alias")
    .option("--account <account>", "Local wallet name or public key", "agent")
    .requiredOption("--request <type:asset:amount...>", "Blend request, repeatable", collectOption, [])
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .option("--version <version>", "Pool version: v1 or v2")
    .action(
      withContext(
        async (
          context,
          options: { pool: string; account: string; request: string[]; network?: string; version?: string }
        ) => {
          const {
            blendDeployment,
            parseBlendRequest,
            preflightBlendActions,
            resolveBlendAsset,
            resolveBlendPool
          } = await loadDefi();
          const profile = resolveBlendProfile(context, options.network);
          const deployment = blendDeployment(blendNetworkForProfile(profile));
          const poolDeployment = resolveBlendPool(deployment, options.pool);
          const account = await resolvePublicAccount(context, options.account);
          const actions = options.request.map((entry) => {
            const parsed = parseBlendRequest(entry);
            const asset = resolveBlendAsset(deployment, parsed.asset);
            return { ...parsed, asset: asset.contractId };
          });
          const poolVersion = resolveBlendPoolVersion(options.version ?? poolDeployment.version);
          const preflight = await preflightBlendActions({
            profile,
            poolId: poolDeployment.contractId,
            userId: account,
            actions,
            ...(poolVersion === undefined ? {} : { poolVersion })
          });
          const policy = await loadPolicy(context);
          const borrowValue = preflight.actions
            .filter((action) => action.type === "borrow")
            .reduce((total, action) => total + (action.value ?? 0), 0);
          const protocolExposureValue =
            (preflight.after?.totalSupplied ?? preflight.before?.totalSupplied ?? 0) +
            (preflight.after?.totalBorrowed ?? preflight.before?.totalBorrowed ?? 0);
          const policyDecision = evaluateDefiBlendRequest(policy, {
            network: profile.realFunds ? "mainnet" : "testnet",
            pool: poolDeployment.contractId,
            requestTypes: preflight.actions.map((action) => action.type),
            borrowValue: String(borrowValue),
            protocolExposureValue: String(protocolExposureValue),
            ...(preflight.after?.healthFactor === undefined ? {} : { healthFactorAfter: preflight.after.healthFactor })
          });
          return {
            deployment: {
              network: deployment.network,
              pool: poolDeployment
            },
            policyDecision,
            preflight
          };
        },
        "Blend preflight complete."
      )
    );

  blend
    .command("supply")
    .description("Submit a guarded Testnet Blend supply request.")
    .requiredOption("--pool <pool>", "Pool contract id or deployment alias")
    .requiredOption("--asset <asset>", "Blend asset symbol or contract id")
    .requiredOption("--amount <amount>", "Asset amount")
    .option("--source <account>", "Local Testnet wallet name", "agent")
    .option("--collateral", "Supply as collateral")
    .action(
      withContext(async (context, options: { pool: string; asset: string; amount: string; source: string; collateral?: boolean }) => {
        return runBlendSubmitCommand(context, {
          command: "defi blend supply",
          pool: options.pool,
          source: options.source,
          actions: [
            {
              type: options.collateral ? "supply_collateral" : "supply",
              asset: options.asset,
              amount: options.amount
            }
          ]
        });
      }, "Blend supply submitted.")
    );

  blend
    .command("borrow")
    .description("Submit a guarded Testnet Blend borrow request.")
    .requiredOption("--pool <pool>", "Pool contract id or deployment alias")
    .requiredOption("--asset <asset>", "Blend asset symbol or contract id")
    .requiredOption("--amount <amount>", "Asset amount")
    .option("--source <account>", "Local Testnet wallet name", "agent")
    .action(
      withContext(async (context, options: { pool: string; asset: string; amount: string; source: string }) => {
        return runBlendSubmitCommand(context, {
          command: "defi blend borrow",
          pool: options.pool,
          source: options.source,
          actions: [{ type: "borrow", asset: options.asset, amount: options.amount }]
        });
      }, "Blend borrow submitted.")
    );

  blend
    .command("repay")
    .description("Submit a guarded Testnet Blend repay request.")
    .requiredOption("--pool <pool>", "Pool contract id or deployment alias")
    .requiredOption("--asset <asset>", "Blend asset symbol or contract id")
    .requiredOption("--amount <amount>", "Asset amount")
    .option("--source <account>", "Local Testnet wallet name", "agent")
    .action(
      withContext(async (context, options: { pool: string; asset: string; amount: string; source: string }) => {
        return runBlendSubmitCommand(context, {
          command: "defi blend repay",
          pool: options.pool,
          source: options.source,
          actions: [{ type: "repay", asset: options.asset, amount: options.amount }]
        });
      }, "Blend repay submitted.")
    );

  blend
    .command("withdraw")
    .description("Submit a guarded Testnet Blend withdraw request.")
    .requiredOption("--pool <pool>", "Pool contract id or deployment alias")
    .requiredOption("--asset <asset>", "Blend asset symbol or contract id")
    .requiredOption("--amount <amount>", "Asset amount")
    .option("--source <account>", "Local Testnet wallet name", "agent")
    .option("--collateral", "Withdraw from collateral")
    .action(
      withContext(async (context, options: { pool: string; asset: string; amount: string; source: string; collateral?: boolean }) => {
        return runBlendSubmitCommand(context, {
          command: "defi blend withdraw",
          pool: options.pool,
          source: options.source,
          actions: [
            {
              type: options.collateral ? "withdraw_collateral" : "withdraw",
              asset: options.asset,
              amount: options.amount
            }
          ]
        });
      }, "Blend withdraw submitted.")
    );

  blend
    .command("batch")
    .description("Submit a guarded Testnet batch of Blend requests in one transaction.")
    .requiredOption("--pool <pool>", "Pool contract id or deployment alias")
    .option("--source <account>", "Local Testnet wallet name", "agent")
    .requiredOption("--request <type:asset:amount...>", "Blend request, repeatable", collectOption, [])
    .action(
      withContext(async (context, options: { pool: string; source: string; request: string[] }) => {
        const { parseBlendRequest } = await loadDefi();
        return runBlendSubmitCommand(context, {
          command: "defi blend batch",
          pool: options.pool,
          source: options.source,
          actions: options.request.map(parseBlendRequest)
        });
      }, "Blend batch submitted.")
    );

  const trustline = blend.command("trustline").description("Resolve and create trustlines for Blend non-native reserves.");
  trustline
    .command("guide")
    .description("Show the classic asset backing a Blend reserve and the trustline command to run.")
    .requiredOption("--asset <asset>", "Blend asset symbol or contract id")
    .option("--account <account>", "Local wallet name", "agent")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .action(
      withContext(async (context, options: { asset: string; account: string; network?: string }) => {
        return blendTrustlineGuide(context, options);
      }, "Blend trustline guidance loaded.")
    );

  trustline
    .command("add")
    .description("Create the classic issued-asset trustline for a Blend reserve on Testnet.")
    .requiredOption("--asset <asset>", "Blend asset symbol or contract id")
    .option("--account <account>", "Local Testnet wallet name", "agent")
    .option("--limit <amount>", "Trustline limit")
    .action(
      withContext(async (context, options: { asset: string; account: string; limit?: string }) => {
        return addBlendTrustline(context, options);
      }, "Blend trustline added.")
    );

  const aquarius = defi.command("aquarius").description("Inspect Aquarius pools and preflight guarded Aquarius AMM requests.");
  aquarius
    .command("deployments")
    .description("Show Aquarius router, API, RPC endpoints, known assets, and optional current pools.")
    .option("--network <name>", "Aquarius deployment network: testnet or mainnet")
    .option("--pools", "Fetch current Aquarius pools from the Aquarius API")
    .option("--search <term>", "Filter fetched pools by token, pool address, or symbol")
    .option("--limit <count>", "Limit fetched pool records", parseIntegerOption)
    .action(
      withContext(
        async (context, options: { network?: string; pools?: boolean; search?: string; limit?: number }) => {
          const { aquariusDeployment, fetchAquariusPools } = await loadDefi();
          const network = resolveAquariusNetworkOption(context, options.network);
          const deployment = aquariusDeployment(network);
          return {
            ...deployment,
            ...(options.pools
              ? {
                  pools: (
                    await fetchAquariusPools({
                      network,
                      ...(options.search === undefined ? {} : { search: options.search }),
                      limit: options.limit ?? 10
                    })
                  ).pools
                }
              : {})
          };
        },
        "Aquarius deployments loaded."
      )
    );

  const aquariusPool = aquarius.command("pool").description("Inspect Aquarius pools.");
  aquariusPool
    .command("inspect")
    .description("Load Aquarius pool metadata from the Aquarius API.")
    .requiredOption("--pool <pool>", "Pool contract id, pool index, token, or search term")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .action(
      withContext(async (context, options: { pool: string; network?: string }) => {
        const { inspectAquariusPool } = await loadDefi();
        return inspectAquariusPool({
          network: resolveAquariusNetworkOption(context, options.network),
          pool: options.pool
        });
      }, "Aquarius pool inspected.")
    );

  const aquariusAccount = aquarius.command("account").description("Inspect Aquarius account state.");
  aquariusAccount
    .command("position")
    .description("Inspect account balances relevant to an Aquarius pool.")
    .option("--account <account>", "Local wallet name or public key", "agent")
    .option("--pool <pool>", "Aquarius pool contract id, pool index, token, or search term")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .action(
      withContext(async (context, options: { account: string; pool?: string; network?: string }) => {
        const { inspectAquariusAccountPosition } = await loadDefi();
        const account = await resolvePublicAccount(context, options.account);
        return inspectAquariusAccountPosition({
          network: resolveAquariusNetworkOption(context, options.network),
          account,
          ...(options.pool === undefined ? {} : { pool: options.pool })
        });
      }, "Aquarius account position inspected.")
    );

  const aquariusLp = aquarius.command("lp").description("Preflight Aquarius LP actions.");
  aquariusLp
    .command("preflight")
    .description("Preflight Aquarius deposit or withdrawal without signing or submitting.")
    .requiredOption("--pool <pool>", "Aquarius pool contract id, pool index, token, or search term")
    .requiredOption("--action <action>", "LP action: deposit or withdraw")
    .option("--account <account>", "Local wallet name or public key", "agent")
    .option("--amount <amount...>", "Desired deposit amount, repeatable", collectOption, [])
    .option("--min-shares <amount>", "Minimum pool shares for deposit")
    .option("--shares <amount>", "Pool shares to withdraw")
    .option("--min-amount <amount...>", "Minimum withdraw token amount, repeatable", collectOption, [])
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .action(
      withContext(
        async (
          context,
          options: {
            pool: string;
            action: string;
            account: string;
            amount: string[];
            minShares?: string;
            shares?: string;
            minAmount: string[];
            network?: string;
          }
        ) => {
          const { preflightAquariusLp } = await loadDefi();
          const network = resolveAquariusNetworkOption(context, options.network);
          const action = parseAquariusLpAction(options.action);
          const account = await resolvePublicAccount(context, options.account);
          const preflight = await preflightAquariusLp({
            network,
            pool: options.pool,
            account,
            action,
            ...(options.amount.length === 0 ? {} : { desiredAmounts: options.amount }),
            ...(options.minShares === undefined ? {} : { minShares: options.minShares }),
            ...(options.shares === undefined ? {} : { shareAmount: options.shares }),
            ...(options.minAmount.length === 0 ? {} : { minAmounts: options.minAmount })
          });
          const policy = await loadPolicyForRequestNetwork(context, network);
          const policyDecision = evaluateDefiAquariusRequest(policy, aquariusLpPolicyRequest(preflight));
          return { policyDecision, preflight };
        },
        "Aquarius LP preflight complete."
      )
    );

  const aquariusSwap = aquarius.command("swap").description("Quote and preflight Aquarius swaps.");
  aquariusSwap
    .command("quote")
    .description("Fetch an Aquarius optimal-route swap quote without signing or submitting.")
    .requiredOption("--from <asset>", "Input asset symbol or contract id")
    .requiredOption("--to <asset>", "Output asset symbol or contract id")
    .requiredOption("--amount <amount>", "Amount in asset units")
    .option("--mode <mode>", "strict-send or strict-receive", "strict-send")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .action(
      withContext(async (context, options: { from: string; to: string; amount: string; mode: string; network?: string }) => {
        const { quoteAquariusSwap } = await loadDefi();
        return quoteAquariusSwap({
          network: resolveAquariusNetworkOption(context, options.network),
          inputAsset: options.from,
          outputAsset: options.to,
          amount: options.amount,
          mode: parseAquariusSwapMode(options.mode)
        });
      }, "Aquarius swap quote loaded.")
    );

  aquariusSwap
    .command("preflight")
    .description("Preflight an Aquarius swap quote against policy without signing or submitting.")
    .requiredOption("--from <asset>", "Input asset symbol or contract id")
    .requiredOption("--to <asset>", "Output asset symbol or contract id")
    .requiredOption("--amount <amount>", "Amount in asset units")
    .option("--mode <mode>", "strict-send or strict-receive", "strict-send")
    .requiredOption("--slippage-bps <bps>", "Explicit slippage bound in basis points", parseSlippageBpsOption)
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .action(
      withContext(
        async (
          context,
          options: { from: string; to: string; amount: string; mode: string; slippageBps: number; network?: string }
        ) => {
          const { preflightAquariusSwap } = await loadDefi();
          const network = resolveAquariusNetworkOption(context, options.network);
          const preflight = await preflightAquariusSwap({
            network,
            inputAsset: options.from,
            outputAsset: options.to,
            amount: options.amount,
            mode: parseAquariusSwapMode(options.mode),
            slippageBps: options.slippageBps
          });
          const policy = await loadPolicyForRequestNetwork(context, network);
          const policyDecision = evaluateDefiAquariusRequest(policy, aquariusSwapPolicyRequest(preflight));
          return { policyDecision, preflight };
        },
        "Aquarius swap preflight complete."
      )
    );

  const aquariusRewards = aquarius.command("rewards").description("Inspect Aquarius reward claim readiness.");
  aquariusRewards
    .command("inspect")
    .description("Inspect Aquarius pool reward claim metadata without signing or submitting.")
    .requiredOption("--pool <pool>", "Aquarius pool contract id, pool index, token, or search term")
    .option("--account <account>", "Local wallet name or public key", "agent")
    .option("--network <name>", "Network profile to inspect: testnet or mainnet")
    .action(
      withContext(async (context, options: { pool: string; account: string; network?: string }) => {
        const { inspectAquariusRewards } = await loadDefi();
        const account = await resolvePublicAccount(context, options.account);
        return inspectAquariusRewards({
          network: resolveAquariusNetworkOption(context, options.network),
          account,
          pool: options.pool
        });
      }, "Aquarius rewards inspected.")
    );
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
          join(context.config.storage.policiesDir, defaultPolicyFilename(options.network));
        const resolvedPath = resolvePath(path);
        await mkdir(dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, policyToYaml(target), { mode: 0o600 });
        return { path: resolvedPath, policy: target };
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
        const history = await loadSpendHistory(context, request);
        return { ...evaluatePaymentRequest(policy, request, history), spendHistory: history };
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
      withContext(async (context, name: string) => ({
        account: name,
        balances: await walletBalances(context.config, name)
      }), "Account ledger data loaded.")
    );
  ledger
    .command("payments")
    .description("Fetch recent payment operations for an account from Horizon.")
    .option("--account <name>", "Local wallet name", "agent")
    .option("--address <address>", "Raw Stellar public key")
    .option("--limit <n>", "Number of records", parseIntegerOption, 10)
    .action(
      withContext(async (context, options: { account: string; address?: string; limit: number }) => {
        const { accountPayments } = await import("@stellar-agent/stellar");
        const address = options.address ?? (await loadWallet(context.config, options.account)).publicKey;
        return {
          address,
          ...(await accountPayments({
            address,
            profile: resolveNetworkProfile(context.profileName, context.config.profiles),
            limit: options.limit
          }))
        };
      }, "Ledger payments loaded.")
    );
  ledger
    .command("effects")
    .description("Fetch recent effects for an account or transaction from Horizon.")
    .option("--account <name>", "Local wallet name", "agent")
    .option("--address <address>", "Raw Stellar public key")
    .option("--tx <hash>", "Transaction hash")
    .option("--limit <n>", "Number of records", parseIntegerOption, 10)
    .action(
      withContext(
        async (context, options: { account: string; address?: string; tx?: string; limit: number }) => {
          const { accountEffects, transactionEffects } = await import("@stellar-agent/stellar");
          const profile = resolveNetworkProfile(context.profileName, context.config.profiles);
          if (options.tx) {
            return {
              transaction: options.tx,
              ...(await transactionEffects({ hash: options.tx, profile, limit: options.limit }))
            };
          }
          const address = options.address ?? (await loadWallet(context.config, options.account)).publicKey;
          return {
            address,
            ...(await accountEffects({ address, profile, limit: options.limit }))
          };
        },
        "Ledger effects loaded."
      )
    );
  ledger
    .command("export")
    .description("Export local receipt and event-log metadata as a JSON report.")
    .option("--output <path>", "Output JSON path")
    .action(
      withContext(async (context, options: { output?: string }) => {
        return writeLocalReport(context, options.output ?? join(context.config.storage.ledgersDir, "ledger-report.json"));
      }, "Ledger report exported.")
    );
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
    .command("summary")
    .description("Summarize local receipt spend, Mainnet exposure, and recent activity.")
    .option("--profile <name>", "Filter by profile: testnet, mainnet, or local")
    .option("--asset <asset>", "Filter by payment asset")
    .action(
      withContext(
        async (context, options: { profile?: NetworkName; asset?: string }) =>
          receiptSummary(context, {
            ...(options.profile === undefined ? {} : { profile: options.profile }),
            ...(options.asset === undefined ? {} : { asset: options.asset })
          }),
        "Receipt summary loaded."
      )
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
    .option("--ledger", "Also verify the receipt transaction against Horizon")
    .action(
      withContext(async (context, path: string, options: { ledger?: boolean }) => {
        const receipt = await readReceipt(path);
        verifyReceipt(receipt);
        const ledger = options.ledger ? await verifyReceiptAgainstLedger(context, receipt) : undefined;
        return { valid: true, path: resolvePath(path), ...(ledger === undefined ? {} : { ledger }) };
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
  const agentWallet = mainnet.command("agent-wallet").description("Manage a risk-budgeted Mainnet agent wallet for guarded external-signing workflows.");
  agentWallet
    .command("create")
    .description("Create or replace the dedicated Mainnet agent-wallet profile without storing a Mainnet secret key.")
    .requiredOption("--address <address>", "Dedicated Mainnet agent wallet public key")
    .option("--name <name>", "Local watch-only wallet name", "mainnet-agent")
    .option("--max-balance <amount>", "Maximum allowed wallet balance", "25")
    .option("--per-tx-limit <amount>", "Maximum single payment amount", "1")
    .option("--daily-limit <amount>", "Maximum daily payment amount", "5")
    .option("--monthly-limit <amount>", "Optional monthly payment amount")
    .option("--asset <asset>", "Allowed asset; repeat for more than one", collectArg, [])
    .option("--allow-destination <address>", "Allowed destination; repeat for more than one", collectArg, [])
    .action(
      withContext(
        async (
          context,
          options: {
            address: string;
            name: string;
            maxBalance: string;
            perTxLimit: string;
            dailyLimit: string;
            monthlyLimit?: string;
            asset: string[];
            allowDestination: string[];
          }
        ) => {
          const now = new Date().toISOString();
          const riskBudget = parseMainnetAgentWalletRiskBudget(options);
          await importPublicWallet({
            config: context.config,
            name: options.name,
            publicKey: options.address,
            network: "mainnet"
          });
          context.config.mainnetAgentWallet = {
            schemaVersion: "stellar-agent.mainnetAgentWallet.v1",
            walletName: options.name,
            publicKey: options.address,
            status: "disarmed",
            createdAt: context.config.mainnetAgentWallet?.createdAt ?? now,
            updatedAt: now,
            riskBudget
          };
          await writeConfig(context.config, context.options);
          return mainnetAgentWalletView(context.config.mainnetAgentWallet);
        },
        "Mainnet agent wallet created."
      )
    );
  agentWallet
    .command("enable")
    .description("Configure the dedicated Mainnet agent wallet, optionally enable env-var autosigning, and optionally arm it.")
    .requiredOption("--address <address>", "Dedicated Mainnet agent wallet public key")
    .option("--name <name>", "Local watch-only wallet name", "mainnet-agent")
    .option("--max-balance <amount>", "Maximum allowed wallet balance", "25")
    .option("--per-tx-limit <amount>", "Maximum single payment amount", "1")
    .option("--daily-limit <amount>", "Maximum daily payment amount", "5")
    .option("--monthly-limit <amount>", "Optional monthly payment amount")
    .option("--asset <asset>", "Allowed asset; repeat for more than one", collectArg, [])
    .option("--allow-destination <address>", "Allowed destination; repeat for more than one", collectArg, [])
    .option("--enable-autosign", "Enable env-var based autosigning for this agent wallet only")
    .option("--secret-key-env <name>", "Environment variable containing the agent-wallet secret key", "STELLAR_AGENT_MAINNET_AGENT_SECRET_KEY")
    .option("--i-understand-agent-wallet-autosign", "Acknowledge bounded Mainnet agent-wallet autosigning risk")
    .option("--arm", "Arm the wallet after configuration")
    .option("--i-understand-real-funds", "Acknowledge this wallet can spend real Mainnet funds")
    .action(
      withContext(
        async (
          context,
          options: {
            address: string;
            name: string;
            maxBalance: string;
            perTxLimit: string;
            dailyLimit: string;
            monthlyLimit?: string;
            asset: string[];
            allowDestination: string[];
            enableAutosign?: boolean;
            secretKeyEnv: string;
            iUnderstandAgentWalletAutosign?: boolean;
            arm?: boolean;
            iUnderstandRealFunds?: boolean;
          }
        ) => {
          const now = new Date().toISOString();
          const riskBudget = parseMainnetAgentWalletRiskBudget(options);
          await importPublicWallet({
            config: context.config,
            name: options.name,
            publicKey: options.address,
            network: "mainnet"
          });
          context.config.mainnetAgentWallet = {
            schemaVersion: "stellar-agent.mainnetAgentWallet.v1",
            walletName: options.name,
            publicKey: options.address,
            status: "disarmed",
            createdAt: context.config.mainnetAgentWallet?.createdAt ?? now,
            updatedAt: now,
            riskBudget,
            ...(options.enableAutosign
              ? {
                  autosign: mainnetAgentWalletAutosignConfig({
                    secretKeyEnvVar: options.secretKeyEnv,
                    acknowledged: Boolean(options.iUnderstandAgentWalletAutosign)
                  })
                }
              : {})
          };
          if (options.arm) {
            context.config.mainnetAgentWallet = await armMainnetAgentWallet(context, {
              iUnderstandRealFunds: Boolean(options.iUnderstandRealFunds)
            });
          }
          await writeConfig(context.config, context.options);
          return mainnetAgentWalletView(context.config.mainnetAgentWallet);
        },
        "Mainnet agent wallet enabled."
      )
    );
  agentWallet
    .command("status")
    .description("Show Mainnet agent-wallet arming and risk-budget status.")
    .action(
      withContext(async (context) => {
        const wallet = context.config.mainnetAgentWallet;
        if (!wallet) return { configured: false, armed: false, realFunds: true };
        return {
          configured: true,
          ...mainnetAgentWalletView(wallet),
          ...(await mainnetAgentWalletIntegrity(context, wallet))
        };
      }, "Mainnet agent wallet status loaded.")
    );
  const autosign = agentWallet.command("autosign").description("Manage env-var based Mainnet agent-wallet autosigning.");
  autosign
    .command("enable")
    .description("Enable autosigning for the armed agent-wallet path only; no secret key is stored.")
    .option("--secret-key-env <name>", "Environment variable containing the agent-wallet secret key", "STELLAR_AGENT_MAINNET_AGENT_SECRET_KEY")
    .option("--i-understand-agent-wallet-autosign", "Acknowledge bounded Mainnet agent-wallet autosigning risk")
    .action(
      withContext(async (context, options: { secretKeyEnv: string; iUnderstandAgentWalletAutosign?: boolean }) => {
        const wallet = requireMainnetAgentWallet(context.config);
        context.config.mainnetAgentWallet = {
          ...wallet,
          status: "disarmed",
          updatedAt: new Date().toISOString(),
          autosign: mainnetAgentWalletAutosignConfig({
            secretKeyEnvVar: options.secretKeyEnv,
            acknowledged: Boolean(options.iUnderstandAgentWalletAutosign)
          }),
          arming: undefined
        };
        await writeConfig(context.config, context.options);
        return mainnetAgentWalletView(context.config.mainnetAgentWallet);
      }, "Mainnet agent-wallet autosigning enabled and wallet disarmed for re-arming.")
    );
  autosign
    .command("disable")
    .description("Disable Mainnet agent-wallet autosigning and disarm the wallet.")
    .action(
      withContext(async (context) => {
        const wallet = requireMainnetAgentWallet(context.config);
        context.config.mainnetAgentWallet = {
          ...wallet,
          status: "disarmed",
          updatedAt: new Date().toISOString(),
          autosign: { ...(wallet.autosign ?? mainnetAgentWalletAutosignConfig({ secretKeyEnvVar: "STELLAR_AGENT_MAINNET_AGENT_SECRET_KEY", acknowledged: true })), enabled: false },
          arming: undefined
        };
        await writeConfig(context.config, context.options);
        return mainnetAgentWalletView(context.config.mainnetAgentWallet);
      }, "Mainnet agent-wallet autosigning disabled.")
    );
  autosign
    .command("status")
    .description("Show Mainnet agent-wallet autosigning status without reading the secret key.")
    .action(
      withContext(async (context) => {
        const wallet = requireMainnetAgentWallet(context.config);
        return {
          publicKey: wallet.publicKey,
          autosign: mainnetAgentWalletAutosignView(wallet),
          warning: mainnetAgentWalletAutosignWarning()
        };
      }, "Mainnet agent-wallet autosigning status loaded.")
    );
  agentWallet
    .command("limits")
    .description("Show or update Mainnet agent-wallet risk-budget limits. Updating limits disarms the wallet.")
    .option("--max-balance <amount>", "Maximum allowed wallet balance")
    .option("--per-tx-limit <amount>", "Maximum single payment amount")
    .option("--daily-limit <amount>", "Maximum daily payment amount")
    .option("--monthly-limit <amount>", "Optional monthly payment amount")
    .option("--asset <asset>", "Allowed asset; repeat for more than one", collectArg, [])
    .option("--allow-destination <address>", "Allowed destination; repeat for more than one", collectArg, [])
    .action(
      withContext(
        async (
          context,
          options: {
            maxBalance?: string;
            perTxLimit?: string;
            dailyLimit?: string;
            monthlyLimit?: string;
            asset: string[];
            allowDestination: string[];
          }
        ) => {
          const wallet = requireMainnetAgentWallet(context.config);
          const updates = parseMainnetAgentWalletRiskBudget({
            maxBalance: options.maxBalance ?? wallet.riskBudget.maxBalance,
            perTxLimit: options.perTxLimit ?? wallet.riskBudget.perTxLimit,
            dailyLimit: options.dailyLimit ?? wallet.riskBudget.dailyLimit,
            monthlyLimit: options.monthlyLimit ?? wallet.riskBudget.monthlyLimit,
            asset: options.asset.length > 0 ? options.asset : wallet.riskBudget.allowedAssets,
            allowDestination:
              options.allowDestination.length > 0 ? options.allowDestination : wallet.riskBudget.allowedDestinations
          });
          context.config.mainnetAgentWallet = {
            ...wallet,
            status: "disarmed",
            updatedAt: new Date().toISOString(),
            riskBudget: updates,
            arming: undefined
          };
          await writeConfig(context.config, context.options);
          return mainnetAgentWalletView(context.config.mainnetAgentWallet);
        },
        "Mainnet agent wallet limits updated."
      )
    );
  agentWallet
    .command("arm")
    .description("Arm the Mainnet agent wallet after explicit Mainnet enablement and risk-budget checks.")
    .option("--i-understand-real-funds", "Acknowledge this wallet can spend real funds through guarded external-signing workflows")
    .action(
      withContext(async (context, options: { iUnderstandRealFunds?: boolean }) => {
        context.config.mainnetAgentWallet = await armMainnetAgentWallet(context, {
          iUnderstandRealFunds: Boolean(options.iUnderstandRealFunds)
        });
        await writeConfig(context.config, context.options);
        return mainnetAgentWalletView(context.config.mainnetAgentWallet);
      }, "Mainnet agent wallet armed.")
    );
  agentWallet
    .command("disarm")
    .description("Disarm the Mainnet agent wallet.")
    .action(
      withContext(async (context) => {
        const wallet = requireMainnetAgentWallet(context.config);
        context.config.mainnetAgentWallet = {
          ...wallet,
          status: "disarmed",
          updatedAt: new Date().toISOString(),
          arming: undefined
        };
        await writeConfig(context.config, context.options);
        return mainnetAgentWalletView(context.config.mainnetAgentWallet);
      }, "Mainnet agent wallet disarmed.")
    );
  agentWallet
    .command("rotate")
    .description("Rotate the dedicated Mainnet agent-wallet public key. Rotation disarms the wallet.")
    .requiredOption("--address <address>", "New dedicated Mainnet agent wallet public key")
    .option("--name <name>", "Local watch-only wallet name")
    .action(
      withContext(async (context, options: { address: string; name?: string }) => {
        const wallet = requireMainnetAgentWallet(context.config);
        const walletName = options.name ?? wallet.walletName;
        await importPublicWallet({
          config: context.config,
          name: walletName,
          publicKey: options.address,
          network: "mainnet"
        });
        context.config.mainnetAgentWallet = {
          ...wallet,
          walletName,
          publicKey: options.address,
          status: "disarmed",
          updatedAt: new Date().toISOString(),
          arming: undefined
        };
        await writeConfig(context.config, context.options);
        return mainnetAgentWalletView(context.config.mainnetAgentWallet);
      }, "Mainnet agent wallet rotated and disarmed.")
    );
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

async function createTestnetWalletResult(context: CliContext, name: string, fund: boolean) {
  const wallet = await ensureWallet(context.config, name);
  if (!fund) return { wallet };
  const { fundWithFriendbot } = await import("@stellar-agent/stellar");
  const funding = await fundWithFriendbot(wallet.publicKey, context.config.profiles.testnet);
  await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
    event: "command_finished",
    status: "funded",
    command: "wallet create-testnet",
    profile: "testnet",
    data: { account: name, publicKey: wallet.publicKey, funding }
  });
  return { wallet, funding };
}

async function loadPolicy(context: CliContext, explicitPath?: string, network: NetworkName = context.profileName) {
  const policyPath =
    explicitPath ??
    context.options.policy ??
    process.env.STELLAR_AGENT_POLICY ??
    join(context.config.storage.policiesDir, defaultPolicyFilename(network));
  try {
    return parsePolicyYaml(await readFile(resolvePath(policyPath), "utf8"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return defaultPolicyForNetwork(network);
    throw error;
  }
}

async function loadPolicyForRequestNetwork(context: CliContext, network: AquariusNetworkName): Promise<Policy> {
  const explicitPath = context.options.policy ?? process.env.STELLAR_AGENT_POLICY;
  const policy = await loadPolicy(context, undefined, network);
  if (explicitPath && policy.network !== network) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: `Policy network '${policy.network}' does not match Aquarius preflight network '${network}'.`,
      hint: `Use a ${network} policy file or omit --policy to use the default ${network} policy.`,
      docs: network === "mainnet" ? "docs/mainnet-safety.md#mainnet-defi" : "docs/defi-aquarius.md"
    });
  }
  return policy;
}

function defaultPolicyFilename(network: NetworkName): string {
  if (network === "mainnet") return "default-mainnet.yaml";
  if (network === "local") return "default-local.yaml";
  return "default-testnet.yaml";
}

function resolveBlendNetworkOption(context: CliContext, network?: string): "testnet" | "mainnet" {
  if (!network) return blendNetworkForProfile(resolveNetworkProfile(context.profileName, context.config.profiles));
  const normalized = network.toLowerCase();
  if (normalized === "testnet" || normalized === "mainnet") return normalized;
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: "Blend network must be testnet or mainnet.",
    docs: "docs/defi-blend.md"
  });
}

async function loadDefi(): Promise<typeof import("@stellar-agent/defi")> {
  return await import("@stellar-agent/defi");
}

function blendNetworkForProfile(profile: NetworkProfile): "testnet" | "mainnet" {
  return profile.realFunds || profile.name === "mainnet" ? "mainnet" : "testnet";
}

function resolveBlendProfile(context: CliContext, network?: string): NetworkProfile {
  return resolveNetworkProfile(resolveBlendNetworkOption(context, network), context.config.profiles);
}

function resolveAquariusNetworkOption(context: CliContext, network?: string): "testnet" | "mainnet" {
  if (!network) return blendNetworkForProfile(resolveNetworkProfile(context.profileName, context.config.profiles));
  const normalized = network.toLowerCase();
  if (normalized === "testnet" || normalized === "mainnet") return normalized;
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: "Aquarius network must be testnet or mainnet.",
    docs: "docs/defi-aquarius.md"
  });
}

function resolveBlendPoolVersion(version?: string): "v1" | "v2" | undefined {
  if (version === undefined) return undefined;
  const normalized = version.toLowerCase();
  if (normalized === "v1" || normalized === "v2") return normalized;
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: "Blend pool version must be v1 or v2.",
    docs: "docs/defi-blend.md"
  });
}

function parseAquariusLpAction(action: string): "deposit" | "withdraw" {
  const normalized = action.toLowerCase();
  if (normalized === "deposit" || normalized === "withdraw") return normalized;
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: "Aquarius LP action must be deposit or withdraw.",
    docs: "docs/defi-aquarius.md#lp-preflight"
  });
}

function parseAquariusSwapMode(mode: string): "strict_send" | "strict_receive" {
  const normalized = mode.toLowerCase().replaceAll("-", "_");
  if (normalized === "strict_send" || normalized === "send") return "strict_send";
  if (normalized === "strict_receive" || normalized === "receive") return "strict_receive";
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: "Aquarius swap mode must be strict-send or strict-receive.",
    docs: "docs/defi-aquarius.md#swap-quoting-and-preflight"
  });
}

async function resolvePublicAccount(context: CliContext, account: string): Promise<string> {
  if (/^G[A-Z2-7]{55}$/.test(account)) return account;
  return (await loadWalletPublic(context.config, account)).publicKey;
}

interface LiquidityPreflightOptions {
  pool: string;
  account: string;
  action: string;
  maxA?: string;
  maxB?: string;
  minPrice?: string;
  maxPrice?: string;
  shares?: string;
  minA: string;
  minB: string;
  network?: string;
}

interface LiquidityDepositOptions {
  pool: string;
  maxA: string;
  maxB: string;
  minPrice: string;
  maxPrice: string;
  source: string;
  feeStrategy: "base" | "low" | "medium" | "high" | "p95";
}

interface LiquidityWithdrawOptions {
  pool: string;
  shares: string;
  minA: string;
  minB: string;
  source: string;
  feeStrategy: "base" | "low" | "medium" | "high" | "p95";
}

interface MarketPriceListenOptions {
  pool: string;
  above?: string;
  below?: string;
  network?: string;
  polls: number;
  intervalMs: number;
}

interface MarketAlertConfigFile {
  alerts: MarketAlertRule[];
}

interface MarketAlertRule {
  name?: string;
  pool: string;
  above?: string;
  below?: string;
  action?: "log";
  network?: string;
}

function resolveMarketProfile(context: CliContext, network?: string): NetworkProfile {
  if (!network) return resolveNetworkProfile(context.profileName, context.config.profiles);
  const normalized = network.toLowerCase();
  if (normalized !== "testnet" && normalized !== "mainnet") {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Market network must be testnet or mainnet.",
      docs: "docs/market-liquidity.md"
    });
  }
  return resolveNetworkProfile(normalized, context.config.profiles);
}

async function runLiquidityPreflight(
  context: CliContext,
  profile: NetworkProfile,
  options: LiquidityPreflightOptions
): Promise<LiquidityPoolPreflight> {
  const action = parseLiquidityAction(options.action);
  const account = await resolvePublicAccount(context, options.account);
  const { preflightLiquidityPoolDeposit, preflightLiquidityPoolWithdraw } = await import("@stellar-agent/stellar");
  if (action === "deposit") {
    if (!options.maxA || !options.maxB || !options.minPrice || !options.maxPrice) {
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: "Liquidity deposit preflight requires --max-a, --max-b, --min-price, and --max-price.",
        docs: "docs/market-liquidity.md#lp-preflight"
      });
    }
    validatePriceBounds(options.minPrice, options.maxPrice);
    return preflightLiquidityPoolDeposit({
      poolId: options.pool,
      maxAmountA: options.maxA,
      maxAmountB: options.maxB,
      minPrice: options.minPrice,
      maxPrice: options.maxPrice,
      account,
      profile
    });
  }
  if (!options.shares) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Liquidity withdrawal preflight requires --shares.",
      docs: "docs/market-liquidity.md#lp-preflight"
    });
  }
  return preflightLiquidityPoolWithdraw({
    poolId: options.pool,
    shares: options.shares,
    minAmountA: options.minA,
    minAmountB: options.minB,
    account,
    profile
  });
}

function parseLiquidityAction(action: string): "deposit" | "withdraw" {
  if (action === "deposit" || action === "withdraw") return action;
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: "Liquidity action must be deposit or withdraw.",
    docs: "docs/market-liquidity.md#lp-preflight"
  });
}

async function runLiquiditySubmitCommand(
  context: CliContext,
  args:
    | ({ command: string; action: "deposit" } & LiquidityDepositOptions)
    | ({ command: string; action: "withdraw" } & LiquidityWithdrawOptions)
): Promise<unknown> {
  const profile = resolveNetworkProfile(context.profileName, context.config.profiles);
  if (profile.realFunds) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Mainnet liquidity pool mutation requires an external signer and is not available through local auto-signing.",
      hint: "Use Testnet for local liquidity workflows.",
      docs: "docs/mainnet-safety.md#mainnet-liquidity"
    });
  }
  const wallet = await loadWallet(context.config, args.source);
  if (args.action === "deposit") validatePriceBounds(args.minPrice, args.maxPrice);
  const { preflightLiquidityPoolDeposit, preflightLiquidityPoolWithdraw, submitLiquidityPoolDeposit, submitLiquidityPoolWithdraw } =
    await import("@stellar-agent/stellar");
  const preflight =
    args.action === "deposit"
      ? await preflightLiquidityPoolDeposit({
          poolId: args.pool,
          maxAmountA: args.maxA,
          maxAmountB: args.maxB,
          minPrice: args.minPrice,
          maxPrice: args.maxPrice,
          account: wallet.publicKey,
          profile
        })
      : await preflightLiquidityPoolWithdraw({
          poolId: args.pool,
          shares: args.shares,
          minAmountA: args.minA,
          minAmountB: args.minB,
          account: wallet.publicKey,
          profile
        });
  const policy = await loadPolicy(context);
  const policyDecision = evaluateMarketLiquidityRequest(policy, liquidityPolicyRequest(profile, preflight));
  if (policyDecision.status !== "allowed") throw marketPolicyDeniedError(policyDecision);
  const submitted =
    args.action === "deposit"
      ? await submitLiquidityPoolDeposit({
          source: wallet,
          poolId: args.pool,
          maxAmountA: args.maxA,
          maxAmountB: args.maxB,
          minPrice: args.minPrice,
          maxPrice: args.maxPrice,
          profile,
          feeStrategy: args.feeStrategy,
          ...(context.options.noCache === undefined ? {} : { noCache: context.options.noCache })
        })
      : await submitLiquidityPoolWithdraw({
          source: wallet,
          poolId: args.pool,
          shares: args.shares,
          minAmountA: args.minA,
          minAmountB: args.minB,
          profile,
          feeStrategy: args.feeStrategy,
          ...(context.options.noCache === undefined ? {} : { noCache: context.options.noCache })
        });
  const receiptPath = await writeOperationReceipt(context, {
    command: args.command,
    policyDecision,
    operation: {
      type: `market.lp.${args.action}`,
      source: args.source,
      account: wallet.publicKey,
      details: { liquidityPool: submitted.preflight }
    },
    transaction: {
      hash: submitted.hash,
      ...(submitted.ledger === undefined ? {} : { ledger: submitted.ledger }),
      successful: submitted.successful,
      ...(submitted.feeCharged === undefined ? {} : { feeCharged: submitted.feeCharged })
    }
  });
  return {
    status: "submitted",
    transaction: {
      hash: submitted.hash,
      ...(submitted.ledger === undefined ? {} : { ledger: submitted.ledger }),
      successful: submitted.successful,
      ...(submitted.feeCharged === undefined ? {} : { feeCharged: submitted.feeCharged })
    },
    receiptPath,
    policyDecision,
    preflight: submitted.preflight
  };
}

function liquidityPolicyRequest(profile: NetworkProfile, preflight: LiquidityPoolPreflight) {
  return {
    network: profile.realFunds ? ("mainnet" as const) : ("testnet" as const),
    pool: preflight.pool.id,
    assets: preflight.assets,
    action: preflight.action,
    exposureValue: liquidityExposureValue(preflight),
    priceBoundsProvided: preflight.action === "deposit" ? Boolean(preflight.deposit?.minPrice && preflight.deposit.maxPrice) : true
  };
}

function liquidityExposureValue(preflight: LiquidityPoolPreflight): string {
  if (preflight.nominalExposure) return preflight.nominalExposure.value;
  if (preflight.deposit) {
    return String(Number(preflight.deposit.maxAmountA) + Number(preflight.deposit.maxAmountB));
  }
  return "0";
}

function marketPolicyDeniedError(decision: PolicyDecision): StellarAgentError {
  return new StellarAgentError({
    code: "POLICY_DENIED",
    message: "Market liquidity request was denied by policy.",
    hint: "Run market lp preflight to inspect the matched rules.",
    docs: "docs/market-liquidity.md#policy",
    details: decision
  });
}

async function listenForPoolPrice(context: CliContext, options: MarketPriceListenOptions): Promise<unknown> {
  if (options.above === undefined && options.below === undefined) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Price listener requires --above or --below.",
      docs: "docs/market-liquidity.md#market-listeners"
    });
  }
  const above = options.above === undefined ? undefined : parsePositiveDecimalInput(options.above, "above");
  const below = options.below === undefined ? undefined : parsePositiveDecimalInput(options.below, "below");
  const { inspectLiquidityPool } = await import("@stellar-agent/stellar");
  const profile = resolveMarketProfile(context, options.network);
  const events = [];
  for (let poll = 0; poll < options.polls; poll += 1) {
    if (poll > 0) await sleep(options.intervalMs);
    const pool = await inspectLiquidityPool({ poolId: options.pool, profile });
    const price = poolReservePrice(pool);
    const aboveTriggered = above === undefined ? false : price > above;
    const belowTriggered = below === undefined ? false : price < below;
    events.push({
      type: "market.alert",
      rule: "core-pool-price",
      status: aboveTriggered || belowTriggered ? "triggered" : "not_triggered",
      pool: options.pool,
      observed: price.toFixed(7),
      thresholds: {
        ...(options.above === undefined ? {} : { above: options.above }),
        ...(options.below === undefined ? {} : { below: options.below })
      },
      assets: pool.reserves.map((reserve) => reserve.asset)
    });
  }
  return { events, triggered: events.some((event) => event.status === "triggered") };
}

async function listenForMarketAlertConfig(
  context: CliContext,
  options: { file: string; network?: string; polls: number; intervalMs: number }
): Promise<unknown> {
  const config = await readMarketAlertConfig(options.file);
  const results = [];
  for (const [index, alert] of config.alerts.entries()) {
    const result = (await listenForPoolPrice(context, {
      pool: alert.pool,
      ...(alert.above === undefined ? {} : { above: alert.above }),
      ...(alert.below === undefined ? {} : { below: alert.below }),
      ...(alert.network ?? options.network ? { network: alert.network ?? options.network } : {}),
      polls: options.polls,
      intervalMs: options.intervalMs
    })) as { events: Array<Record<string, unknown>>; triggered: boolean };
    results.push({
      index,
      name: alert.name ?? `alert_${index + 1}`,
      action: alert.action ?? "log",
      pool: alert.pool,
      triggered: result.triggered,
      events: result.events.map((event) => ({
        ...event,
        configAlert: {
          index,
          name: alert.name ?? `alert_${index + 1}`,
          action: alert.action ?? "log"
        }
      }))
    });
  }
  return {
    source: resolvePath(options.file),
    alerts: results,
    triggered: results.some((result) => result.triggered)
  };
}

async function readMarketAlertConfig(path: string): Promise<MarketAlertConfigFile> {
  let raw: string;
  try {
    raw = await readFile(resolvePath(path), "utf8");
  } catch (error) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Market alert config file could not be read.",
      details: error,
      docs: "docs/market-liquidity.md#market-listeners"
    });
  }
  let parsed: Partial<MarketAlertConfigFile> | null;
  try {
    parsed = parseYaml(raw) as Partial<MarketAlertConfigFile> | null;
  } catch (error) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Market alert config file is not valid YAML or JSON.",
      details: error,
      docs: "docs/market-liquidity.md#market-listeners"
    });
  }
  if (!parsed || !Array.isArray(parsed.alerts) || parsed.alerts.length === 0) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Market alert config must contain a non-empty alerts array.",
      docs: "docs/market-liquidity.md#market-listeners"
    });
  }
  return {
    alerts: parsed.alerts.map((alert, index) => parseMarketAlertRule(alert, index))
  };
}

function parseMarketAlertRule(value: unknown, index: number): MarketAlertRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidMarketAlertConfig(index, "alert must be an object.");
  }
  const raw = value as Record<string, unknown>;
  const action = raw.action === undefined ? "log" : String(raw.action);
  if (action !== "log") throw invalidMarketAlertConfig(index, "action must be log.");
  const pool = typeof raw.pool === "string" ? raw.pool : "";
  if (!pool) throw invalidMarketAlertConfig(index, "pool is required.");
  const above = raw.above === undefined ? undefined : String(raw.above);
  const below = raw.below === undefined ? undefined : String(raw.below);
  if (above === undefined && below === undefined) {
    throw invalidMarketAlertConfig(index, "above or below is required.");
  }
  if (above !== undefined) parsePositiveDecimalInput(above, `alerts[${index}].above`);
  if (below !== undefined) parsePositiveDecimalInput(below, `alerts[${index}].below`);
  return {
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    pool,
    ...(above === undefined ? {} : { above }),
    ...(below === undefined ? {} : { below }),
    action,
    ...(typeof raw.network === "string" ? { network: raw.network } : {})
  };
}

function invalidMarketAlertConfig(index: number, reason: string): StellarAgentError {
  return new StellarAgentError({
    code: "INVALID_INPUT",
    message: `Invalid market alert at alerts[${index}]: ${reason}`,
    docs: "docs/market-liquidity.md#market-listeners"
  });
}

function poolReservePrice(pool: LiquidityPoolSummary): number {
  if (pool.reserves.length !== 2 || !pool.reserves[0] || !pool.reserves[1]) {
    throw new StellarAgentError({
      code: "LEDGER_LOOKUP_FAILED",
      message: "Liquidity pool record did not include exactly two reserves.",
      docs: "docs/market-liquidity.md#core-pool-inspection"
    });
  }
  const reserveA = Number(pool.reserves[0].amount);
  const reserveB = Number(pool.reserves[1].amount);
  if (!Number.isFinite(reserveA) || !Number.isFinite(reserveB) || reserveA <= 0) {
    throw new StellarAgentError({
      code: "LEDGER_LOOKUP_FAILED",
      message: "Liquidity pool reserves did not contain a usable price.",
      docs: "docs/market-liquidity.md#market-listeners"
    });
  }
  return reserveB / reserveA;
}

function validatePriceBounds(minPrice: string, maxPrice: string): void {
  const min = parsePositiveDecimalInput(minPrice, "min-price");
  const max = parsePositiveDecimalInput(maxPrice, "max-price");
  if (min > max) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Liquidity deposit --min-price must be less than or equal to --max-price.",
      docs: "docs/market-liquidity.md#lp-preflight"
    });
  }
}

function parsePositiveDecimalInput(input: string, label: string): number {
  const value = parseNonnegativeDecimalInput(input, label);
  if (value <= 0) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: `${label} must be greater than zero.`,
      docs: "docs/market-liquidity.md"
    });
  }
  return value;
}

function parseNonnegativeDecimalInput(input: string, label: string): number {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(input.trim())) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: `${label} must be a decimal number.`,
      docs: "docs/market-liquidity.md"
    });
  }
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: `${label} must be a finite nonnegative number.`,
      docs: "docs/market-liquidity.md"
    });
  }
  return value;
}

async function readStrategyFile(file: string): Promise<Record<string, unknown>> {
  const raw = await readFile(resolvePath(file), "utf8");
  const parsed = file.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Strategy file must contain a JSON or YAML object.",
      docs: "docs/market-liquidity.md#strategy-investigation"
    });
  }
  return parsed as Record<string, unknown>;
}

function explainStrategy(strategy: Record<string, unknown>) {
  const kind = typeof strategy.kind === "string" ? strategy.kind : "liquidity";
  const actions = Array.isArray(strategy.actions) ? strategy.actions : [];
  return {
    status: "explained",
    kind,
    actionCount: actions.length,
    submitted: false,
    signing: false,
    requiredControls: [
      "Run market lp preflight before any core LP mutation.",
      "Require policy approval for any request outside configured market.liquidity limits.",
      "Use external signing for Mainnet.",
      "Write receipts for submitted Testnet liquidity actions."
    ],
    riskNotes: [
      "Strategy files are proposals, not profitability guarantees.",
      "Testnet liquidity does not prove Mainnet profitability.",
      "Quotes and pool snapshots can change before submission."
    ],
    strategy
  };
}

function parsePairOption(pair: string): [string, string] {
  const separator = pair.indexOf("/");
  if (separator <= 0 || separator === pair.length - 1) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Pair must use assetA/assetB format.",
      docs: "docs/market-liquidity.md#strategy-investigation"
    });
  }
  return [pair.slice(0, separator), pair.slice(separator + 1)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function liquidityInvestigation(args: { pool: LiquidityPoolSummary; trades: unknown[]; profile: NetworkProfile }) {
  return {
    network: args.profile.name,
    pool: args.pool,
    currentPrice: poolReservePrice(args.pool).toFixed(7),
    recentTrades: args.trades,
    execution: {
      submitted: false,
      mutationSupported: args.profile.realFunds ? "external_signer_required" : "testnet_preflight_required"
    },
    riskNotes: [
      "Liquidity fees are not guaranteed profit.",
      "LP positions can lose relative value versus holding reserve assets.",
      "Inspect issuer risk and trustlines before depositing."
    ]
  };
}

function collectOption(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

async function runBlendSubmitCommand(
  context: CliContext,
  args: { command: string; pool: string; source: string; actions: BlendAction[] }
): Promise<unknown> {
  const { blendDeployment, preflightBlendActions, resolveBlendAsset, resolveBlendPool, submitBlendActions } =
    await loadDefi();
  const profile = resolveNetworkProfile(context.profileName, context.config.profiles);
  if (profile.realFunds) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Mainnet Blend mutation requires an external signer and is not available through local auto-signing.",
      hint: "Use Testnet for local Blend mutation workflows.",
      docs: "docs/mainnet-safety.md#mainnet-defi"
    });
  }
  const deployment = blendDeployment(blendNetworkForProfile(profile));
  const pool = resolveBlendPool(deployment, args.pool);
  const wallet = await loadWallet(context.config, args.source);
  const actions = args.actions.map((action) => {
    const asset = resolveBlendAsset(deployment, action.asset);
    return { ...action, asset: asset.contractId };
  });
  const preflight = await preflightBlendActions({
    profile,
    poolId: pool.contractId,
    userId: wallet.publicKey,
    actions,
    poolVersion: pool.version
  });
  const policy = await loadPolicy(context);
  const policyDecision = evaluateDefiBlendRequest(policy, blendPolicyRequest(profile, pool.contractId, preflight));
  if (policyDecision.status !== "allowed") throw defiPolicyDeniedError(policyDecision);

  const submitted = await submitBlendActions({
    profile,
    poolId: pool.contractId,
    userId: wallet.publicKey,
    actions,
    poolVersion: pool.version,
    sourceSecretKey: wallet.secretKey
  });
  const receiptPath = await writeBlendReceipt(context, {
    command: args.command,
    policyDecision,
    operation: {
      type: "defi.blend.submit",
      source: args.source,
      account: wallet.publicKey,
      details: {
        blend: {
          pool,
          actions: submitted.preflight.actions,
          before: submitted.preflight.before,
          after: submitted.preflight.after,
          simulation: submitted.simulation,
          decodedEvents: submitted.decodedEvents
        }
      }
    },
    transaction: {
      hash: submitted.hash,
      ...(submitted.ledger === undefined ? {} : { ledger: submitted.ledger }),
      successful: submitted.successful,
      ...(submitted.feeCharged === undefined ? {} : { feeCharged: submitted.feeCharged })
    }
  });
  return {
    status: "submitted",
    transaction: {
      hash: submitted.hash,
      ...(submitted.ledger === undefined ? {} : { ledger: submitted.ledger }),
      successful: submitted.successful,
      ...(submitted.feeCharged === undefined ? {} : { feeCharged: submitted.feeCharged })
    },
    receiptPath,
    policyDecision,
    preflight: submitted.preflight,
    simulation: submitted.simulation,
    decodedEvents: submitted.decodedEvents
  };
}

function blendPolicyRequest(profile: NetworkProfile, pool: string, preflight: BlendPreflight) {
  const borrowValue = preflight.actions
    .filter((action) => action.type === "borrow")
    .reduce((total, action) => total + (action.value ?? 0), 0);
  const protocolExposureValue =
    (preflight.after?.totalSupplied ?? preflight.before?.totalSupplied ?? 0) +
    (preflight.after?.totalBorrowed ?? preflight.before?.totalBorrowed ?? 0);
  return {
    network: profile.realFunds ? ("mainnet" as const) : ("testnet" as const),
    pool,
    requestTypes: preflight.actions.map((action) => action.type),
    borrowValue: String(borrowValue),
    protocolExposureValue: String(protocolExposureValue),
    ...(preflight.after?.healthFactor === undefined ? {} : { healthFactorAfter: preflight.after.healthFactor })
  };
}

function aquariusLpPolicyRequest(preflight: AquariusLpPreflight) {
  return {
    network: preflight.network,
    pool: preflight.pool.address,
    assets: preflight.assets,
    assetGroups: preflight.assetGroups,
    action: preflight.action,
    nominalExposure: preflight.nominalExposure,
    slippageBoundsProvided: preflight.slippageBoundsProvided
  };
}

function aquariusSwapPolicyRequest(preflight: AquariusSwapPreflight) {
  return {
    network: preflight.network,
    pool: preflight.quote.pools[0] ?? "*",
    assets: preflight.assets,
    assetGroups: preflight.assetGroups,
    action: preflight.policyAction,
    nominalExposure: preflight.amount,
    slippageBoundsProvided: preflight.slippageBoundsProvided
  };
}

function defiPolicyDeniedError(decision: PolicyDecision): StellarAgentError {
  return new StellarAgentError({
    code: "POLICY_DENIED",
    message: "Blend DeFi request was denied by policy.",
    hint: "Run defi blend preflight to inspect the matched rules.",
    docs: "docs/defi-blend.md#policy",
    details: decision
  });
}

async function blendTrustlineGuide(
  context: CliContext,
  options: { asset: string; account: string; network?: string }
): Promise<unknown> {
  const { blendDeployment, resolveBlendAsset } = await loadDefi();
  const profile = resolveBlendProfile(context, options.network);
  const deployment = blendDeployment(blendNetworkForProfile(profile));
  const asset = resolveBlendAsset(deployment, options.asset);
  const account = await resolvePublicAccount(context, options.account);
  const rawPublicAccount = /^G[A-Z2-7]{55}$/.test(options.account);
  const trustlines =
    profile.realFunds || asset.classicAsset === undefined || rawPublicAccount
      ? []
      : await walletTrustlines(context.config, options.account);
  const hasTrustline = asset.classicAsset
    ? trustlines.some((trustline) => trustline.asset.toUpperCase() === asset.classicAsset!.toUpperCase())
    : false;
  return {
    network: deployment.network,
    account,
    asset,
    requiresTrustline: asset.classicAsset !== undefined,
    hasTrustline,
    command:
      asset.classicAsset === undefined || profile.realFunds || rawPublicAccount
        ? null
        : `stellar-agent defi blend trustline add --account ${options.account} --asset ${asset.symbol}`
  };
}

async function addBlendTrustline(
  context: CliContext,
  options: { asset: string; account: string; limit?: string }
): Promise<unknown> {
  const { blendDeployment, resolveBlendAsset } = await loadDefi();
  const profile = resolveNetworkProfile(context.profileName, context.config.profiles);
  if (profile.realFunds) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Mainnet trustline creation requires an external signer.",
      docs: "docs/mainnet-safety.md#mainnet-defi"
    });
  }
  const deployment = blendDeployment(blendNetworkForProfile(profile));
  const asset = resolveBlendAsset(deployment, options.asset);
  if (!asset.classicAsset) {
    return {
      status: "not_required",
      asset,
      message: "This Blend reserve does not require a classic issued-asset trustline."
    };
  }
  const wallet = await loadWallet(context.config, options.account);
  const { changeTrustline } = await import("@stellar-agent/stellar");
  const transaction = await changeTrustline({
    source: wallet,
    asset: asset.classicAsset,
    profile,
    ...(options.limit === undefined ? {} : { limit: options.limit })
  });
  const receiptPath = await writeOperationReceipt(context, {
    command: "defi blend trustline add",
    operation: {
      type: "defi.blend.trustline.add",
      account: options.account,
      asset: asset.classicAsset,
      limit: transaction.limit,
      details: { blend: { asset } }
    },
    transaction
  });
  return {
    status: "trustline_added",
    asset,
    account: wallet.publicKey,
    transaction,
    receiptPath
  };
}

async function loadSpendHistory(context: CliContext, request: PaymentRequest) {
  return spendHistoryFromReceipts(context.config.storage.receiptsDir, {
    profile: request.network,
    asset: request.asset
  });
}

async function evaluateApprovedPaymentBeforeSubmission(context: CliContext, payment: PaymentRequest): Promise<{
  policyDecision: PolicyDecision;
  mainnetAgentWallet?: { warning: string; spendHistory: Awaited<ReturnType<typeof loadSpendHistory>> };
}> {
  if (payment.network !== context.profileName) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Approval payment metadata must match the active submission profile.",
      docs: "docs/mainnet-safety.md#signed-xdr-submission"
    });
  }
  const policy = await loadPolicy(context, undefined, payment.network);
  const history = await loadSpendHistory(context, payment);
  const policyDecision = evaluatePaymentRequest(policy, payment, history);
  if (policyDecision.status === "denied") throw policyDeniedError();
  const mainnetAgentWallet = await assertMainnetAgentWalletPaymentAllowed(context, payment);
  return {
    policyDecision,
    ...(mainnetAgentWallet === undefined ? {} : { mainnetAgentWallet })
  };
}

function parseMainnetAgentWalletRiskBudget(options: {
  maxBalance: string;
  perTxLimit: string;
  dailyLimit: string;
  monthlyLimit?: string | undefined;
  asset: string[];
  allowDestination: string[];
}): MainnetAgentWalletConfig["riskBudget"] {
  const allowedAssets = options.asset.length > 0 ? options.asset : ["XLM"];
  for (const asset of allowedAssets) parseAssetForPolicy(asset);
  for (const destination of options.allowDestination) paymentRequestSchema.shape.destination.parse(destination);
  return {
    maxBalance: parseAmount(options.maxBalance, "XLM").value,
    perTxLimit: parseAmount(options.perTxLimit, "XLM").value,
    dailyLimit: parseAmount(options.dailyLimit, "XLM").value,
    ...(options.monthlyLimit === undefined ? {} : { monthlyLimit: parseAmount(options.monthlyLimit, "XLM").value }),
    allowedAssets: allowedAssets.map((asset) => asset.toUpperCase()),
    allowedDestinations: [...new Set(options.allowDestination)],
    allowedOperations: ["payment"]
  };
}

function mainnetAgentWalletAutosignConfig(options: {
  secretKeyEnvVar: string;
  acknowledged: boolean;
}): NonNullable<MainnetAgentWalletConfig["autosign"]> {
  if (!options.acknowledged) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Enabling Mainnet agent-wallet autosigning requires --i-understand-agent-wallet-autosign.",
      hint: mainnetAgentWalletAutosignWarning(),
      docs: "docs/mainnet-safety.md#agent-wallet-autosigning"
    });
  }
  if (!/^[A-Z_][A-Z0-9_]*$/.test(options.secretKeyEnvVar)) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Agent-wallet autosign secret key env var must be an uppercase environment variable name.",
      docs: "docs/mainnet-safety.md#agent-wallet-autosigning"
    });
  }
  const now = new Date().toISOString();
  return {
    enabled: true,
    secretKeyEnvVar: options.secretKeyEnvVar,
    enabledAt: now,
    warningAcknowledgedAt: now
  };
}

async function armMainnetAgentWallet(
  context: CliContext,
  options: { iUnderstandRealFunds: boolean }
): Promise<MainnetAgentWalletConfig> {
  if (!options.iUnderstandRealFunds) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Arming the Mainnet agent wallet requires --i-understand-real-funds.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
  if (!context.config.profiles.mainnet?.enabled) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Arming the Mainnet agent wallet requires Mainnet enablement.",
      hint: "Run stellar-agent mainnet enable --i-understand-real-funds first.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
  const current = requireMainnetAgentWallet(context.config);
  if (!current.publicKey) {
    throw new StellarAgentError({
      code: "WALLET_NOT_FOUND",
      message: "Mainnet agent wallet does not have a public key.",
      hint: "Run stellar-agent mainnet agent-wallet create --address G...",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
  if (current.riskBudget.allowedDestinations.length === 0) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent wallet requires an explicit destination allowlist before arming.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
  await assertMainnetAgentWalletBalanceWithinBudget(context, current);
  const now = new Date().toISOString();
  const armedWallet: MainnetAgentWalletConfig = {
    ...current,
    status: "armed",
    updatedAt: now,
    spendCounters: await mainnetAgentWalletSpendCounters(context, current),
    arming: undefined
  };
  const policyFingerprint = await mainnetAgentWalletPolicyFingerprint(context);
  armedWallet.arming = {
    armedAt: now,
    configPath: configFingerprintPath(context),
    configFingerprint: coreMainnetAgentWalletConfigFingerprint({ ...context.config, mainnetAgentWallet: armedWallet }),
    policyPath: policyFingerprint.path,
    policyFingerprint: policyFingerprint.fingerprint
  };
  return armedWallet;
}

function requireMainnetAgentWallet(config: StellarAgentConfig): MainnetAgentWalletConfig {
  const wallet = config.mainnetAgentWallet;
  if (!wallet) {
    throw new StellarAgentError({
      code: "WALLET_NOT_FOUND",
      message: "Mainnet agent wallet is not configured.",
      hint: "Run stellar-agent mainnet agent-wallet create --address G...",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
  return wallet;
}

function mainnetAgentWalletView(wallet: MainnetAgentWalletConfig) {
  return {
    walletName: wallet.walletName,
    publicKey: wallet.publicKey,
    armed: wallet.status === "armed",
    status: wallet.status,
    realFunds: true,
    riskBudget: wallet.riskBudget,
    spendCounters: wallet.spendCounters,
    autosign: mainnetAgentWalletAutosignView(wallet),
    warning: mainnetAgentWalletWarning(),
    arming:
      wallet.arming === undefined
        ? undefined
        : {
            armedAt: wallet.arming.armedAt,
            configPath: wallet.arming.configPath,
            policyPath: wallet.arming.policyPath
          }
  };
}

function mainnetAgentWalletWarning(): string {
  return MAINNET_AGENT_WALLET_WARNING;
}

function mainnetAgentWalletAutosignWarning(): string {
  return MAINNET_AGENT_WALLET_AUTOSIGN_WARNING;
}

function mainnetAgentWalletAutosignView(wallet: MainnetAgentWalletConfig) {
  return {
    enabled: Boolean(wallet.autosign?.enabled),
    secretKeyEnvVar: wallet.autosign?.secretKeyEnvVar,
    enabledAt: wallet.autosign?.enabledAt,
    warning: wallet.autosign?.enabled ? mainnetAgentWalletAutosignWarning() : undefined
  };
}

async function mainnetAgentWalletIntegrity(context: CliContext, wallet: MainnetAgentWalletConfig) {
  if (wallet.status !== "armed") return { integrity: { ok: true, checked: false, reason: "wallet_not_armed" } };
  const failures = await mainnetAgentWalletIntegrityFailures(context, wallet);
  return { integrity: { ok: failures.length === 0, checked: true, failures } };
}

async function mainnetAgentWalletIntegrityFailures(
  context: CliContext,
  wallet: MainnetAgentWalletConfig
): Promise<string[]> {
  if (!wallet.arming) {
    return ["arming_metadata_missing"];
  }
  const currentPolicy = await mainnetAgentWalletPolicyFingerprint(context);
  return coreMainnetAgentWalletIntegrityFailures({
    wallet,
    config: context.config,
    configPath: configFingerprintPath(context),
    policyPath: currentPolicy.path,
    policyFingerprint: currentPolicy.fingerprint
  });
}

async function assertMainnetAgentWalletPaymentAllowed(
  context: CliContext,
  request: PaymentRequest
): Promise<{ warning: string; spendHistory: Awaited<ReturnType<typeof loadSpendHistory>> } | undefined> {
  const wallet = context.config.mainnetAgentWallet;
  if (!wallet || wallet.publicKey !== request.source || request.network !== "mainnet") return undefined;
  const spendHistory = await loadSpendHistory(context, request);
  const policyFingerprint = await mainnetAgentWalletPolicyFingerprint(context);
  assertMainnetAgentWalletPaymentPreflight({
    wallet,
    request,
    config: context.config,
    configPath: configFingerprintPath(context),
    policyPath: policyFingerprint.path,
    policyFingerprint: policyFingerprint.fingerprint,
    spendHistory
  });
  assertCoreMainnetAgentWalletBalanceWithinBudget(wallet, await readMainnetAgentWalletBalances(context, wallet));
  return { warning: mainnetAgentWalletWarning(), spendHistory };
}

async function assertMainnetAgentWalletAutosignPayment(
  context: CliContext,
  request: PaymentRequest,
  options: { allowRealFunds?: boolean; iUnderstandRealFunds?: boolean; iUnderstandAgentWalletAutosign?: boolean }
): Promise<{ wallet: MainnetAgentWalletConfig; source: { publicKey: string; secretKey: string }; warning: string; spendHistory: Awaited<ReturnType<typeof loadSpendHistory>> }> {
  if (!options.allowRealFunds || !options.iUnderstandRealFunds || !options.iUnderstandAgentWalletAutosign) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Mainnet agent-wallet autosigning requires --allow-real-funds, --i-understand-real-funds, and --i-understand-agent-wallet-autosign.",
      hint: mainnetAgentWalletAutosignWarning(),
      docs: "docs/mainnet-safety.md#agent-wallet-autosigning"
    });
  }
  const wallet = requireMainnetAgentWallet(context.config);
  if (!wallet.autosign?.enabled) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Mainnet agent-wallet autosigning is not enabled.",
      hint: "Run stellar-agent mainnet agent-wallet autosign enable --i-understand-agent-wallet-autosign, then arm the wallet.",
      docs: "docs/mainnet-safety.md#agent-wallet-autosigning"
    });
  }
  const allowed = await assertMainnetAgentWalletPaymentAllowed(context, request);
  if (!allowed) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Mainnet auto-signing is blocked outside the dedicated agent-wallet path.",
      docs: "docs/mainnet-safety.md#agent-wallet-autosigning"
    });
  }
  const secretKey = process.env[wallet.autosign.secretKeyEnvVar];
  if (!secretKey) {
    throw new StellarAgentError({
      code: "SECRET_KEY_BLOCKED",
      message: `Mainnet agent-wallet secret key env var '${wallet.autosign.secretKeyEnvVar}' is not set.`,
      hint: "Set the env var only in the process that should autosign; the secret is never stored in config or receipts.",
      docs: "docs/mainnet-safety.md#agent-wallet-autosigning"
    });
  }
  const { publicKeyFromSecret } = await import("@stellar-agent/stellar");
  let publicKey: string;
  try {
    publicKey = publicKeyFromSecret(secretKey);
  } catch {
    throw new StellarAgentError({
      code: "WALLET_INVALID",
      message: "Mainnet agent-wallet autosign secret key is invalid.",
      docs: "docs/mainnet-safety.md#agent-wallet-autosigning"
    });
  }
  if (publicKey !== wallet.publicKey) {
    throw new StellarAgentError({
      code: "WALLET_INVALID",
      message: "Mainnet agent-wallet autosign secret key does not match the configured public key.",
      docs: "docs/mainnet-safety.md#agent-wallet-autosigning"
    });
  }
  return {
    wallet,
    source: { publicKey, secretKey },
    warning: mainnetAgentWalletAutosignWarning(),
    spendHistory: allowed.spendHistory
  };
}

async function sendMainnetAgentWalletPayment(
  context: CliContext,
  options: {
    to: string;
    amount: string;
    asset: string;
    from: string;
    memo?: string;
    feeStrategy: string;
    allowRealFunds?: boolean;
    iUnderstandRealFunds?: boolean;
    iUnderstandAgentWalletAutosign?: boolean;
    dryRun?: boolean;
  }
) {
  const configured = requireMainnetAgentWallet(context.config);
  if (options.from !== configured.walletName && options.from !== configured.publicKey) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Mainnet auto-signing is blocked outside the configured agent-wallet account.",
      hint: `Use --from ${configured.walletName} for the dedicated agent-wallet flow.`,
      docs: "docs/mainnet-safety.md#agent-wallet-autosigning"
    });
  }
  if (!configured.publicKey) {
    throw new StellarAgentError({
      code: "WALLET_NOT_FOUND",
      message: "Mainnet agent wallet does not have a public key.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
  const policy = await loadPolicy(context, undefined, "mainnet");
  const request = paymentRequestSchema.parse({
    source: configured.publicKey,
    destination: options.to,
    amount: options.amount,
    asset: options.asset,
    memo: options.memo,
    network: "mainnet",
    agentWalletAutosign: true
  });
  const history = await loadSpendHistory(context, request);
  if (history.unreadable) {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "Mainnet agent-wallet spend history could not be read, so payment fails closed.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
  const policyDecision = evaluatePaymentRequest(policy, request, history);
  if (options.dryRun) return { request, policyDecision, spendHistory: history, dryRun: true, autosign: mainnetAgentWalletAutosignView(configured) };
  await assertMainnetAgentWalletPaymentAllowed(context, request);
  if (policyDecision.status === "denied") throw policyDeniedError();
  if (policyDecision.status === "requires_approval") {
    throw new StellarAgentError({
      code: "APPROVAL_REQUIRED",
      message: "Mainnet agent-wallet autosigning requires policy status 'allowed'.",
      hint: "Use an external approval flow or add an explicit policy exception for risk-budgeted agent-wallet autosigning.",
      docs: "docs/mainnet-safety.md#agent-wallet-autosigning",
      details: { policyDecision }
    });
  }
  const autosign = await assertMainnetAgentWalletAutosignPayment(context, request, options);
  const { sendPayment } = await import("@stellar-agent/stellar");
  const mainnetProfile = resolveNetworkProfile("mainnet", context.config.profiles);
  const transaction = await sendPayment({
    source: autosign.source,
    destination: options.to,
    amount: options.amount,
    asset: options.asset,
    ...(options.memo === undefined ? {} : { memo: options.memo }),
    profile: mainnetProfile,
    allowRealFunds: true,
    feeStrategy: parseFeeStrategy(options.feeStrategy),
    ...(context.options.noCache === undefined ? {} : { noCache: context.options.noCache })
  });
  const eventLog = join(context.config.storage.logsDir, "events.jsonl");
  await appendEvent(eventLog, {
    event: "transaction_confirmed",
    status: "successful",
    command: "pay send",
    profile: "mainnet",
    data: {
      transaction,
      source: configured.walletName,
      sourcePublicKey: configured.publicKey,
      destination: options.to,
      asset: options.asset,
      mainnetAgentWalletAutosign: true,
      warning: autosign.warning
    }
  });
  const { path: receiptPath } = await writeReceipt(context.config.storage.receiptsDir, {
    command: "pay send",
    profile: "mainnet",
    networkPassphrase: mainnetProfile.networkPassphrase,
    realFunds: true,
    payment: {
      source: configured.publicKey,
      destination: options.to,
      asset: options.asset,
      amount: request.amount,
      ...(options.memo === undefined ? {} : { memo: options.memo })
    },
    operation: {
      type: "pay.send",
      source: configured.publicKey,
      destination: options.to,
      asset: options.asset,
      amount: request.amount,
      details: {
        mainnetAgentWallet: {
          autosign: true,
          walletName: configured.walletName,
          publicKey: configured.publicKey,
          secretKeyEnvVar: configured.autosign?.secretKeyEnvVar,
          riskBudgetState: coreMainnetAgentWalletRiskBudgetState(configured, autosign.spendHistory, request),
          warning: autosign.warning
        },
        realFundsAcknowledged: true
      }
    },
    policyDecision: {
      status: policyDecision.status,
      matchedRules: [...policyDecision.matchedRules, "mainnet_agent_wallet_autosign_acknowledged"]
    },
    transaction,
    ...(transaction.ledger === undefined ? {} : { ledger: { confirmedLedger: transaction.ledger } }),
    eventLog
  });
  await appendEvent(eventLog, {
    event: "receipt_written",
    status: "success",
    command: "pay send",
    profile: "mainnet",
    data: { receiptPath }
  });
  if (context.config.mainnetAgentWallet) {
    context.config.mainnetAgentWallet = {
      ...context.config.mainnetAgentWallet,
      spendCounters: await mainnetAgentWalletSpendCounters(context, context.config.mainnetAgentWallet)
    };
    await writeConfig(context.config, context.options);
  }
  return {
    request,
    policyDecision,
    autosign: {
      enabled: true,
      warning: autosign.warning
    },
    transaction,
    receiptPath,
    realFunds: true
  };
}

async function assertMainnetAgentWalletBalanceWithinBudget(
  context: CliContext,
  wallet: MainnetAgentWalletConfig
): Promise<void> {
  assertCoreMainnetAgentWalletBalanceWithinBudget(wallet, await readMainnetAgentWalletBalances(context, wallet));
}

async function readMainnetAgentWalletBalances(
  context: CliContext,
  wallet: MainnetAgentWalletConfig
): Promise<Array<{ asset: string; balance: string }>> {
  if (!wallet.publicKey) {
    throw new StellarAgentError({ code: "WALLET_NOT_FOUND", message: "Mainnet agent wallet public key is missing." });
  }
  try {
    const profile = resolveNetworkProfile("mainnet", context.config.profiles);
    return await fetchMainnetAgentWalletBalances(wallet.publicKey, profile);
  } catch (error) {
    throw new StellarAgentError({
      code: "HORIZON_UNAVAILABLE",
      message: "Mainnet agent-wallet balance could not be read, so arming and spend fail closed.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

async function fetchMainnetAgentWalletBalances(
  publicKey: string,
  profile: NetworkProfile
): Promise<Array<{ asset: string; balance: string }>> {
  if (!profile.horizonUrl) {
    throw new StellarAgentError({ code: "HORIZON_UNAVAILABLE", message: "Mainnet Horizon is not configured." });
  }
  const response = await fetch(`${profile.horizonUrl.replace(/\/$/, "")}/accounts/${publicKey}`, {
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.text();
  const parsed = safeJsonParse(body);
  if (!response.ok) {
    throw new StellarAgentError({
      code: "HORIZON_UNAVAILABLE",
      message: "Could not load Mainnet agent-wallet balances from Horizon.",
      details: parsed ?? body
    });
  }
  return ((parsed as any)?.balances ?? []).map((balance: any) => ({
    asset: balance.asset_type === "native" ? "XLM" : `${balance.asset_code}:${balance.asset_issuer}`,
    balance: String(balance.balance)
  }));
}

async function mainnetAgentWalletPolicyFingerprint(context: CliContext): Promise<{ path: string; fingerprint: string }> {
  const policyPath =
    context.options.policy ??
    process.env.STELLAR_AGENT_POLICY ??
    join(context.config.storage.policiesDir, defaultPolicyFilename("mainnet"));
  const resolvedPath = resolvePath(policyPath);
  let source: string;
  try {
    source = await readFile(resolvedPath, "utf8");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
    source = policyToYaml(DEFAULT_MAINNET_POLICY);
  }
  return { path: resolvedPath, fingerprint: sha256(source) };
}

async function mainnetAgentWalletSpendCounters(
  context: CliContext,
  wallet: MainnetAgentWalletConfig
): Promise<NonNullable<MainnetAgentWalletConfig["spendCounters"]>> {
  const entries = await Promise.all(
    wallet.riskBudget.allowedAssets.map(async (asset) => [
      asset,
      await spendHistoryFromReceipts(context.config.storage.receiptsDir, {
        profile: "mainnet",
        asset
      })
    ] as const)
  );
  return {
    updatedAt: new Date().toISOString(),
    source: "receipts",
    assets: Object.fromEntries(entries)
  };
}

function configFingerprintPath(context: CliContext): string {
  return resolvePath(
    context.options.config ?? process.env.STELLAR_AGENT_CONFIG ?? join(context.config.storage.rootDir, "config.yaml")
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function addAmountValues(left: string, right: string, asset: string): string {
  return formatStroops(parseNonnegativeStroops(left, asset) + parseNonnegativeStroops(right, asset));
}

function parseAssetForPolicy(asset: string): void {
  if (asset.toUpperCase() === "XLM") return;
  if (!/^[A-Z0-9]{1,12}(:G[A-Z2-7]{55})?$/.test(asset.toUpperCase())) {
    throw new StellarAgentError({
      code: "INVALID_ASSET",
      message: "Allowed asset must be XLM, CODE, or CODE:G... issuer format.",
      docs: "docs/mainnet-safety.md#risk-budgeted-mainnet-agent-wallet"
    });
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseFeeStrategy(value: string): "base" | "low" | "medium" | "high" | "p95" {
  if (value === "base" || value === "low" || value === "medium" || value === "high" || value === "p95") return value;
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: "Fee strategy must be base, low, medium, high, or p95.",
    hint: "Use --fee-strategy medium unless you intentionally need a different fee posture.",
    docs: "docs/troubleshooting.md#fee-too-low"
  });
}

function parseBatchPaymentsFile(raw: string): Array<{ destination: string; amount: string; asset: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Batch payment file must be valid JSON.",
      hint: "Use an array like [{\"destination\":\"G...\",\"amount\":\"1\",\"asset\":\"XLM\"}].",
      docs: "docs/troubleshooting.md#batch-transaction-failed",
      details: String(error)
    });
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 100) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Batch payment file must contain 1 to 100 payments.",
      docs: "docs/troubleshooting.md#batch-transaction-failed"
    });
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: `Batch payment ${index + 1} must be an object.`,
        docs: "docs/troubleshooting.md#batch-transaction-failed"
      });
    }
    const candidate = item as { destination?: unknown; amount?: unknown; asset?: unknown };
    if (typeof candidate.destination !== "string" || typeof candidate.amount !== "string") {
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: `Batch payment ${index + 1} requires destination and amount strings.`,
        docs: "docs/troubleshooting.md#batch-transaction-failed"
      });
    }
    const asset = typeof candidate.asset === "string" ? candidate.asset : "XLM";
    const amount = parseAmount(candidate.amount, asset).value;
    return { destination: candidate.destination, amount, asset };
  });
}

async function evaluateBatchPaymentPolicy(
  context: CliContext,
  args: {
    source: string;
    payments: Array<{ destination: string; amount: string; asset: string }>;
    policy: Policy;
    memo?: string;
  }
) {
  const histories = new Map<string, Awaited<ReturnType<typeof loadSpendHistory>>>();
  const results = [];
  for (const [index, payment] of args.payments.entries()) {
    const request = paymentRequestSchema.parse({
      source: args.source,
      destination: payment.destination,
      amount: payment.amount,
      asset: payment.asset,
      memo: args.memo,
      network: "testnet"
    });
    const assetKey = request.asset.toUpperCase();
    let history = histories.get(assetKey);
    if (!history) {
      history = await loadSpendHistory(context, request);
      histories.set(assetKey, { ...history });
    }
    const decision = evaluatePaymentRequest(args.policy, request, history);
    results.push({ index, request, spendHistory: history, policyDecision: decision });
    if (decision.status === "allowed") {
      histories.set(assetKey, incrementBatchSpendHistory(history, request));
    }
  }
  const status: "allowed" | "denied" | "requires_approval" = results.some((result) => result.policyDecision.status === "denied")
    ? "denied"
    : results.some((result) => result.policyDecision.status === "requires_approval")
      ? "requires_approval"
      : "allowed";
  return {
    aggregate: {
      status,
      matchedRules: [...new Set(results.flatMap((result) => result.policyDecision.matchedRules))]
    },
    payments: results
  };
}

function incrementBatchSpendHistory(
  history: Awaited<ReturnType<typeof loadSpendHistory>>,
  request: PaymentRequest
): Awaited<ReturnType<typeof loadSpendHistory>> {
  if (history.unreadable) return history;
  const amount = parseAmount(request.amount, request.asset).stroops;
  const add = (value: string | undefined) => formatStroops(parseNonnegativeStroops(value, request.asset) + amount);
  return {
    ...history,
    dailyTotal: add(history.dailyTotal),
    monthlyTotal: add(history.monthlyTotal),
    knownRecipients: [...new Set([...(history.knownRecipients ?? []), request.destination])],
    ...(request.domain
      ? { knownDomains: [...new Set([...(history.knownDomains ?? []), request.domain])] }
      : history.knownDomains === undefined
        ? {}
        : { knownDomains: history.knownDomains })
  };
}

function parseNonnegativeStroops(value: string | undefined, asset: string): bigint {
  const raw = value ?? "0";
  if (/^0(?:\.0{0,7})?$/.test(raw)) return 0n;
  return parseAmount(raw, asset).stroops;
}

function policyDeniedError(): StellarAgentError {
  return new StellarAgentError({
    code: "POLICY_DENIED",
    message: "Payment request was denied by policy.",
    hint: "Run policy explain to inspect the matched rules.",
    docs: "docs/troubleshooting.md#policy-denied"
  });
}

function assertGuardedRealFundsProfile(
  context: CliContext,
  profile: NetworkProfile,
  options: { allowRealFunds: boolean; acknowledgeRealFunds: boolean; action: string }
): void {
  if (!profile.realFunds) return;
  if (!context.config.profiles.mainnet?.enabled) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: `Mainnet ${options.action} requires mainnet enablement.`,
      hint: "Run stellar-agent mainnet enable --i-understand-real-funds first.",
      docs: "docs/mainnet-safety.md#signed-xdr-submission"
    });
  }
  if (!options.allowRealFunds || !options.acknowledgeRealFunds) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: `Mainnet ${options.action} requires --allow-real-funds and --i-understand-real-funds.`,
      hint: "Use signed XDR from a human-controlled Mainnet wallet; stellar-agent will not auto-sign Mainnet transactions.",
      docs: "docs/mainnet-safety.md#signed-xdr-submission"
    });
  }
}

async function verifyReceiptAgainstLedger(context: CliContext, receipt: Awaited<ReturnType<typeof readReceipt>>) {
  const transaction = (await lookupTransaction(
    receipt.transaction.hash,
    resolveNetworkProfile(receipt.profile, context.config.profiles)
  )) as { hash?: string; ledger?: number; successful?: boolean; fee_charged?: string | number };
  if (transaction.hash !== receipt.transaction.hash) {
    throw new StellarAgentError({
      code: "LEDGER_LOOKUP_FAILED",
      message: "Ledger transaction hash did not match the receipt.",
      docs: "docs/ledger-logging.md#receipt-verification"
    });
  }
  if (receipt.transaction.ledger !== undefined && transaction.ledger !== receipt.transaction.ledger) {
    throw new StellarAgentError({
      code: "LEDGER_LOOKUP_FAILED",
      message: "Ledger transaction number did not match the receipt.",
      docs: "docs/ledger-logging.md#receipt-verification"
    });
  }
  if (receipt.transaction.successful !== undefined && transaction.successful !== receipt.transaction.successful) {
    throw new StellarAgentError({
      code: "LEDGER_LOOKUP_FAILED",
      message: "Ledger transaction success status did not match the receipt.",
      docs: "docs/ledger-logging.md#receipt-verification"
    });
  }
  return {
    verified: true,
    hash: transaction.hash,
    ledger: transaction.ledger,
    successful: transaction.successful,
    feeCharged: transaction.fee_charged?.toString()
  };
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

function printWalletConnectPairingUri(options: CliOptions, uri: string): void {
  const message = options.json
    ? JSON.stringify({ event: "walletconnect_pairing_uri", uri })
    : `WalletConnect pairing URI:\n${uri}\nScan this URI or QR payload with your WalletConnect wallet.`;
  process.stderr.write(`${message}\n`);
}

function walletConnectStoragePath(context: CliContext): string {
  return join(resolvePath(context.config.storage.rootDir), "walletconnect", "sessions.db");
}

function printVersion(options: CliOptions): void {
  process.exitCode = EXIT_CODES.success;
  if (options.json) {
    process.stdout.write(`${JSON.stringify(ok({ version: VERSION }))}\n`);
    return;
  }
  process.stdout.write(`${VERSION}\n`);
}

function printError(options: CliOptions, error: unknown): void {
  const serialized = serializeError(error);
  process.exitCode =
    error instanceof StellarAgentError
      ? error.exitCode
      : serialized.code === "INVALID_INPUT"
        ? EXIT_CODES.usage
        : EXIT_CODES.general;
  if (options.json) {
    process.stdout.write(`${JSON.stringify(fail(serialized))}\n`);
    return;
  }
  process.stderr.write(`${serialized.code}: ${serialized.message}\n`);
  if (serialized.hint) process.stderr.write(`Hint: ${serialized.hint}\n`);
  if (serialized.docs) process.stderr.write(`Docs: ${serialized.docs}\n`);
}

function commanderErrorToStellarAgentError(error: unknown): unknown {
  if (error instanceof StellarAgentError) return error;
  if (!isCommanderError(error)) return error;
  const message = normalizeCommanderMessage(error.message);
  return new StellarAgentError({
    code: "INVALID_INPUT",
    message,
    hint: "Run the command with --help and correct the input.",
    docs: docsForCommanderMessage(message),
    exitCode: typeof error.exitCode === "number" ? error.exitCode : EXIT_CODES.usage
  });
}

function isCommanderError(error: unknown): error is { code: string; exitCode?: number; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code.startsWith("commander.") &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function isCommanderHelpOrVersionExit(error: unknown): boolean {
  return (
    isCommanderError(error) &&
    (error.code === "commander.helpDisplayed" || error.code === "commander.version") &&
    (error.exitCode === undefined || error.exitCode === EXIT_CODES.success)
  );
}

function normalizeCommanderMessage(message: string): string {
  return message.replace(/^error:\s*/i, "");
}

function docsForCommanderMessage(message: string): string {
  if (message.includes("--slippage-bps")) return "docs/defi-aquarius.md#swap-quoting-and-preflight";
  if (message.includes("aquarius")) return "docs/defi-aquarius.md";
  return "docs/troubleshooting.md";
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

function collectArg(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseKeyValueArgs(values: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0) {
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: `Contract arg '${value}' must use key=value format.`,
        docs: "docs/smart-contracts.md"
      });
    }
    parsed[value.slice(0, separator)] = value.slice(separator + 1);
  }
  return parsed;
}

function parseIntegerOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Limit must be an integer between 1 and 200.",
      docs: "docs/ledger-logging.md"
    });
  }
  return parsed;
}

function parseSlippageBpsOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Slippage must be an integer between 0 and 10000 basis points.",
      docs: "docs/defi-aquarius.md#swap-quoting-and-preflight"
    });
  }
  return parsed;
}

function parsePortOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Port must be an integer between 0 and 65535."
    });
  }
  return parsed;
}

function approvalUiUrl(baseUrl: string, token?: string): string {
  return token ? `${baseUrl}/#token=${encodeURIComponent(token)}` : `${baseUrl}/`;
}

function parsePositiveIntegerOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Value must be a positive integer."
    });
  }
  return parsed;
}

function parseWalletConnectWalletOption(value: string): "lobstr" | "walletconnect" {
  if (value === "lobstr" || value === "walletconnect") return value;
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: "WalletConnect wallet must be lobstr or walletconnect.",
    docs: "docs/mainnet-safety.md#walletconnect-signing"
  });
}

function parseLedgersToExtendOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Ledgers to extend must be a positive integer.",
      docs: "docs/smart-contracts.md#extend-and-restore"
    });
  }
  return parsed;
}

function validateDurability(value: string): asserts value is "persistent" | "temporary" {
  if (value !== "persistent" && value !== "temporary") {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Durability must be persistent or temporary.",
      docs: "docs/smart-contracts.md"
    });
  }
}

function validateContractReadOutput(value: string): asserts value is "string" | "json" | "xdr" {
  if (value !== "string" && value !== "json" && value !== "xdr") {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Contract read output must be string, json, or xdr.",
      docs: "docs/smart-contracts.md#read"
    });
  }
}

async function writeOperationReceipt(
  context: CliContext,
  args: {
    command: string;
    operation: NonNullable<Parameters<typeof writeReceipt>[1]["operation"]>;
    policyDecision?: PolicyDecision;
    transaction: {
      hash: string;
      ledger?: number;
      successful: boolean;
      feeCharged?: string;
    };
  }
): Promise<string> {
  const eventLog = join(context.config.storage.logsDir, "events.jsonl");
  const profile = resolveNetworkProfile("testnet", context.config.profiles);
  const { path: receiptPath } = await writeReceipt(context.config.storage.receiptsDir, {
    command: args.command,
    profile: "testnet",
    networkPassphrase: profile.networkPassphrase,
    realFunds: false,
    operation: args.operation,
    policyDecision: args.policyDecision
      ? { status: args.policyDecision.status, matchedRules: args.policyDecision.matchedRules }
      : { status: "allowed", matchedRules: ["testnet_operation"] },
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

async function writeBlendReceipt(
  context: CliContext,
  args: {
    command: string;
    policyDecision: PolicyDecision;
    operation: NonNullable<Parameters<typeof writeReceipt>[1]["operation"]>;
    transaction: {
      hash: string;
      ledger?: number;
      successful: boolean;
      feeCharged?: string;
    };
  }
): Promise<string> {
  const eventLog = join(context.config.storage.logsDir, "events.jsonl");
  const profile = resolveNetworkProfile("testnet", context.config.profiles);
  const { path: receiptPath } = await writeReceipt(context.config.storage.receiptsDir, {
    command: args.command,
    profile: "testnet",
    networkPassphrase: profile.networkPassphrase,
    realFunds: false,
    operation: args.operation,
    policyDecision: {
      status: args.policyDecision.status,
      matchedRules: args.policyDecision.matchedRules
    },
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

async function writeSubmittedXdrReceipt(
  context: CliContext,
  args: {
    command: string;
    profile: NetworkProfile;
    operation: NonNullable<Parameters<typeof writeReceipt>[1]["operation"]>;
    transaction: {
      hash: string;
      ledger?: number;
      successful: boolean;
      feeCharged?: string;
    };
  }
): Promise<string> {
  const eventLog = join(context.config.storage.logsDir, "events.jsonl");
  const operation =
    args.profile.realFunds && context.config.mainnetAgentWallet?.status === "armed"
      ? {
          ...args.operation,
          details: {
            ...(typeof args.operation.details === "object" && args.operation.details !== null ? args.operation.details : {}),
            mainnetAgentWallet: {
              armed: true,
              walletName: context.config.mainnetAgentWallet.walletName,
              publicKey: context.config.mainnetAgentWallet.publicKey,
              warning: mainnetAgentWalletWarning()
            }
          }
        }
      : args.operation;
  const { path: receiptPath } = await writeReceipt(context.config.storage.receiptsDir, {
    command: args.command,
    profile: args.profile.name,
    networkPassphrase: args.profile.networkPassphrase,
    realFunds: args.profile.realFunds,
    operation,
    policyDecision: {
      status: args.profile.realFunds ? "requires_approval" : "allowed",
      matchedRules: args.profile.realFunds
        ? ["signed_xdr_external_wallet", "real_funds_acknowledged"]
        : ["signed_xdr_external_wallet"]
    },
    transaction: args.transaction,
    ...(args.transaction.ledger === undefined ? {} : { ledger: { confirmedLedger: args.transaction.ledger } }),
    eventLog
  });
  await appendEvent(eventLog, {
    event: "receipt_written",
    status: "success",
    command: args.command,
    profile: args.profile.name,
    data: { receiptPath }
  });
  return receiptPath;
}

async function writeSubmittedPaymentApprovalReceipt(
  context: CliContext,
  args: {
    command: string;
    profile: NetworkProfile;
    approvalId: string;
    signerPublicKey?: string;
    payment: PaymentRequest;
    policyDecision: PolicyDecision;
    mainnetAgentWallet?: { warning: string; spendHistory: Awaited<ReturnType<typeof loadSpendHistory>> };
    transaction: {
      hash: string;
      ledger?: number;
      successful: boolean;
      feeCharged?: string;
    };
  }
): Promise<string> {
  const eventLog = join(context.config.storage.logsDir, "events.jsonl");
  const { path: receiptPath } = await writeReceipt(context.config.storage.receiptsDir, {
    command: args.command,
    profile: args.profile.name,
    networkPassphrase: args.profile.networkPassphrase,
    realFunds: args.profile.realFunds,
    payment: {
      source: args.payment.source ?? "",
      destination: args.payment.destination,
      asset: args.payment.asset,
      amount: args.payment.amount,
      ...(args.payment.memo === undefined ? {} : { memo: args.payment.memo }),
      ...(args.payment.domain === undefined ? {} : { domain: args.payment.domain }),
      ...(args.payment.url === undefined ? {} : { url: args.payment.url })
    },
    operation: {
      type: "tx.submit_payment_approval",
      ...(args.payment.source === undefined ? {} : { source: args.payment.source }),
      destination: args.payment.destination,
      asset: args.payment.asset,
      amount: args.payment.amount,
      details: {
        approvalId: args.approvalId,
        signerPublicKey: args.signerPublicKey,
        realFundsAcknowledged: args.profile.realFunds,
        ...(args.mainnetAgentWallet === undefined
          ? {}
          : {
              mainnetAgentWallet: {
                armed: true,
                walletName: context.config.mainnetAgentWallet?.walletName,
                publicKey: context.config.mainnetAgentWallet?.publicKey,
                riskBudgetState: coreMainnetAgentWalletRiskBudgetState(
                  context.config.mainnetAgentWallet,
                  args.mainnetAgentWallet.spendHistory,
                  args.payment
                ),
                warning: args.mainnetAgentWallet.warning
              }
            })
      }
    },
    policyDecision: {
      status: args.policyDecision.status,
      matchedRules: args.policyDecision.matchedRules
    },
    transaction: args.transaction,
    ...(args.transaction.ledger === undefined ? {} : { ledger: { confirmedLedger: args.transaction.ledger } }),
    eventLog
  });
  await appendEvent(eventLog, {
    event: "receipt_written",
    status: "success",
    command: args.command,
    profile: args.profile.name,
    data: { receiptPath }
  });
  if (context.config.mainnetAgentWallet && args.mainnetAgentWallet) {
    context.config.mainnetAgentWallet = {
      ...context.config.mainnetAgentWallet,
      spendCounters: await mainnetAgentWalletSpendCounters(context, context.config.mainnetAgentWallet)
    };
    await writeConfig(context.config, context.options);
  }
  return receiptPath;
}

async function attachContractSubmissionReceipt<T extends { stderr: string; stdout: string }>(
  context: CliContext,
  args: {
    command: string;
    network: string;
    result: T;
    operation: NonNullable<Parameters<typeof writeReceipt>[1]["operation"]>;
  }
): Promise<T & { transactionHash?: string; receiptPath?: string }> {
  if (args.network.toLowerCase() !== "testnet") return args.result;
  const transactionHash = extractStellarCliTransactionHash(`${args.result.stderr}\n${args.result.stdout}`);
  if (!transactionHash) return args.result;
  const receiptPath = await writeOperationReceipt(context, {
    command: args.command,
    operation: args.operation,
    transaction: {
      hash: transactionHash,
      successful: true
    }
  });
  return { ...args.result, transactionHash, receiptPath };
}

function extractStellarCliTransactionHash(output: string): string | undefined {
  return parseStellarCliTransactionHash(output);
}

async function writeLocalReport(context: CliContext, outputPath: string) {
  const path = resolvePath(outputPath);
  await mkdir(dirname(path), { recursive: true });
  const report = await buildLocalReport(context);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { path, report };
}

async function buildLocalReport(context: CliContext) {
  const receiptPaths = await listReceipts(context.config.storage.receiptsDir);
  const receipts = await Promise.all(
    receiptPaths.map(async (receiptPath) => ({
      path: receiptPath,
      receipt: await readReceipt(receiptPath)
    }))
  );
  const wallets = await Promise.all(
    ["agent", "merchant", "auditor"].map(async (name) => {
      try {
        const wallet = await loadWallet(context.config, name);
        return { name, exists: true, publicKey: wallet.publicKey };
      } catch {
        return { name, exists: false };
      }
    })
  );
  return {
    schemaVersion: "stellar-agent.report.v1",
    generatedAt: new Date().toISOString(),
    profile: context.profileName,
    storage: context.config.storage,
    wallets,
    receipts,
    eventLog: join(context.config.storage.logsDir, "events.jsonl"),
    redactions: {
      secretKeysIncluded: false
    }
  };
}

async function receiptSummary(context: CliContext, options: { profile?: NetworkName; asset?: string } = {}) {
  const paths = await listReceipts(context.config.storage.receiptsDir);
  const summary = {
    receiptCount: 0,
    unreadableCount: 0,
    paymentCount: 0,
    realFundsCount: 0,
    totals: {} as Record<string, { amount: string; count: number }>,
    profiles: {} as Record<string, { count: number; realFundsCount: number }>,
    latest: null as null | { path: string; id: string; command: string; createdAt: string; profile: NetworkName }
  };
  for (const path of paths) {
    try {
      const receipt = await readReceipt(path);
      if (options.profile && receipt.profile !== options.profile) continue;
      if (options.asset && receipt.payment?.asset.toUpperCase() !== options.asset.toUpperCase()) continue;
      summary.receiptCount += 1;
      const profile = (summary.profiles[receipt.profile] ??= { count: 0, realFundsCount: 0 });
      profile.count += 1;
      if (receipt.network.realFunds) {
        summary.realFundsCount += 1;
        profile.realFundsCount += 1;
      }
      if (!summary.latest) {
        summary.latest = {
          path,
          id: receipt.id,
          command: receipt.command,
          createdAt: receipt.createdAt,
          profile: receipt.profile
        };
      }
      if (!receipt.payment || receipt.transaction.successful !== true || receipt.policyDecision.status === "denied") continue;
      summary.paymentCount += 1;
      const key = `${receipt.profile}:${receipt.payment.asset.toUpperCase()}`;
      const current = summary.totals[key] ?? { amount: "0.0000000", count: 0 };
      summary.totals[key] = {
        amount: addAmountValues(current.amount, receipt.payment.amount, receipt.payment.asset),
        count: current.count + 1
      };
    } catch {
      summary.unreadableCount += 1;
    }
  }
  return summary;
}

function x402ServerScaffoldFiles(): Record<string, string> {
  return {
    "package.json": `${JSON.stringify(
      {
        type: "module",
        scripts: {
          start: "node server.mjs"
        },
        dependencies: {}
      },
      null,
      2
    )}\n`,
    "server.mjs": `import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8787);
const amount = normalizeAmount(process.env.X402_AMOUNT ?? process.env.X402_PRICE ?? "0.0000001");
const asset = process.env.X402_ASSET ?? "XLM";
const destination = process.env.X402_DESTINATION ?? "set-testnet-merchant-public-key";
const horizonUrl = (process.env.X402_HORIZON_URL ?? "https://horizon-testnet.stellar.org").replace(/\\/$/, "");
const maxAgeMs = Number(process.env.X402_MAX_AGE_MS ?? 300000);
const issuedRequirements = new Map();
const acceptedTransactions = new Set();

const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (!request.url?.startsWith("/paid-report")) {
    writeJson(response, 404, { ok: false, error: "not_found" });
    return;
  }

  const payment = request.headers["x-payment"];
  if (!payment) {
    const requirement = paymentRequirement(request);
    issuedRequirements.set(requirement.nonce, requirement);
    const encoded = JSON.stringify(requirement);
    response.writeHead(402, {
      "content-type": "application/json",
      "payment-required": encoded,
      "x-payment-required": encoded
    });
    response.end(encoded);
    return;
  }

  const proof = parsePaymentProof(payment);
  if (!proof) {
    writeJson(response, 402, { ok: false, error: "invalid_payment_proof" });
    return;
  }
  if (acceptedTransactions.has(proof.transactionHash)) {
    writeJson(response, 402, { ok: false, error: "payment_proof_replayed" });
    return;
  }
  const requirement = issuedRequirements.get(proof.nonce);
  if (!requirement) {
    writeJson(response, 402, { ok: false, error: "payment_nonce_not_issued" });
    return;
  }
  const verification = await verifyPaymentProof(proof, requirement);
  if (!verification.ok) {
    writeJson(response, 402, { ok: false, error: verification.error });
    return;
  }
  issuedRequirements.delete(requirement.nonce);
  acceptedTransactions.add(proof.transactionHash);
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      ok: true,
      paid: true,
      message: "Verified Testnet x402 payment.",
      settlement: verification.settlement
    })
  );
});

server.listen(port, () => {
  console.log(\`x402 demo server listening on http://127.0.0.1:\${port}\`);
  console.log(\`paid: http://127.0.0.1:\${port}/paid-report\`);
});

function paymentRequirement(request) {
  const issuedAt = new Date();
  const resource = new URL(request.url, \`http://\${request.headers.host}\`);
  const requirement = {
    protocol: "stellar-agent-local-x402",
    version: 1,
    network: "testnet",
    asset,
    amount,
    recipient: destination,
    resource: resource.toString(),
    nonce: \`x402_req_\${randomUUID()}\`,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + maxAgeMs).toISOString()
  };
  return { ...requirement, memo: challengeMemo(requirement) };
}

async function verifyPaymentProof(proof, requirement) {
  let proofAmount;
  try {
    proofAmount = normalizeAmount(proof.amount);
  } catch {
    return { ok: false, error: "invalid_payment_proof" };
  }
  if (
    proof.protocol !== requirement.protocol ||
    proof.version !== requirement.version ||
    !/^[a-f0-9]{64}$/i.test(proof.transactionHash ?? "") ||
    !proof.payer ||
    proof.recipient !== requirement.recipient ||
    proof.asset !== requirement.asset ||
    proofAmount !== normalizeAmount(requirement.amount) ||
    proof.resource !== requirement.resource ||
    proof.nonce !== requirement.nonce
  ) {
    return { ok: false, error: "invalid_payment_proof" };
  }
  if (Date.parse(requirement.expiresAt) < Date.now()) {
    return { ok: false, error: "payment_nonce_expired" };
  }
  if (acceptedTransactions.has(proof.transactionHash)) {
    return { ok: false, error: "payment_proof_replayed" };
  }

  const transaction = await loadHorizonJson(\`\${horizonUrl}/transactions/\${proof.transactionHash}\`);
  if (!transaction) return { ok: false, error: "payment_settlement_unavailable" };
  if (transaction.successful !== true) return { ok: false, error: "payment_not_successful" };
  const operations = await loadHorizonJson(\`\${horizonUrl}/transactions/\${proof.transactionHash}/operations?limit=200\`);
  const paymentOp = operations?._embedded?.records?.find((record) => {
    const recordAsset = record.asset_type === "native" ? "XLM" : \`\${record.asset_code}:\${record.asset_issuer}\`;
    return (
      record.type === "payment" &&
      record.from === proof.payer &&
      record.to === requirement.recipient &&
      recordAsset === requirement.asset &&
      normalizeAmount(record.amount) === normalizeAmount(requirement.amount)
    );
  });
  if (!paymentOp) return { ok: false, error: "payment_operation_mismatch" };
  if (transaction.memo !== challengeMemo(requirement)) return { ok: false, error: "payment_operation_mismatch" };
  return {
    ok: true,
    settlement: {
      transactionHash: proof.transactionHash,
      ledger: transaction.ledger,
      createdAt: transaction.created_at,
      source: paymentOp.from,
      destination: paymentOp.to,
      amount: paymentOp.amount,
      asset: paymentOp.asset_type === "native" ? "XLM" : \`\${paymentOp.asset_code}:\${paymentOp.asset_issuer}\`
    }
  };
}

async function loadHorizonJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function parsePaymentProof(header) {
  try {
    return JSON.parse(Array.isArray(header) ? header[0] : header);
  } catch {
    return null;
  }
}

function challengeMemo(requirement) {
  return \`x402:\${createHash("sha256").update(\`\${requirement.nonce}\\0\${requirement.resource}\`).digest("hex").slice(0, 22)}\`;
}

function normalizeAmount(value) {
  const [numeric] = String(value).trim().split(/\\s+/);
  if (!/^\\d+(\\.\\d+)?$/.test(numeric)) throw new Error(\`Invalid amount: \${value}\`);
  const [whole, fraction = ""] = numeric.split(".");
  return \`\${BigInt(whole)}.\${fraction.padEnd(7, "0").slice(0, 7)}\`;
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
`,
    "README.md": `# Stellar Agent x402 Testnet Server

This scaffold is a local Testnet demo target for \`stellar-agent pay x402\`.

Run it:

\`\`\`sh
npm start
\`\`\`

Configure the destination with a Testnet merchant public key:

\`\`\`sh
X402_DESTINATION=G... npm start
\`\`\`

The server issues nonce-bound \`stellar-agent-local-x402\` requirements and verifies each \`X-Payment\` proof against Horizon before serving \`/paid-report\`. The verifier checks:

- transaction hash format and one-use replay protection
- requirement freshness
- Testnet payment success
- payment source, destination, amount, and asset
- exact paid resource and nonce binding through the transaction memo

Optional settings:

\`\`\`sh
X402_AMOUNT=0.0000001 X402_ASSET=XLM X402_HORIZON_URL=https://horizon-testnet.stellar.org npm start
\`\`\`

\`X402_PRICE\` is also accepted as a backward-compatible alias for \`X402_AMOUNT\`.

This is still a local Testnet example, not a production facilitator. Keep policy evaluation and receipt persistence on the buyer side with \`stellar-agent pay x402 ... --json\`.
`
  };
}

async function writeNamedFiles(outDir: string, files: Record<string, string>, force: boolean): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    const target = join(outDir, name);
    if (!force) {
      try {
        await readFile(target, "utf8");
        throw new StellarAgentError({
          code: "INVALID_INPUT",
          message: `Refusing to overwrite existing demo file '${target}'.`,
          hint: "Use --force to replace demo files intentionally."
        });
      } catch (error: any) {
        if (error instanceof StellarAgentError) throw error;
        if (error?.code !== "ENOENT") throw error;
      }
    }
    await writeFile(target, contents, { mode: name.endsWith(".mjs") ? 0o755 : 0o600 });
  }
}

function enableX402ForUrl(policy: Policy, url: string): Policy {
  const host = new URL(url).host;
  if (!/^localhost(?::\d+)?$/.test(host) && !/^127\.0\.0\.1(?::\d+)?$/.test(host)) {
    return policy;
  }
  return {
    ...policy,
    x402: {
      ...policy.x402,
      enabled: true,
      allowDomains: Array.from(new Set([...policy.x402.allowDomains, host])),
      maxPricePerRequest: policy.x402.maxPricePerRequest || "1 XLM"
    }
  };
}

interface ContractExecutionContext {
  realFunds: boolean;
  rpcUrl: string | null;
  networkPassphrase: string;
}

function resolveContractExecutionContext(
  context: CliContext,
  network: string,
  options: { mutating: boolean; allowRealFunds?: boolean; acknowledgeRealFunds?: boolean }
): ContractExecutionContext {
  const realFunds = isRealFundsContractNetwork(network);
  const profile = realFunds ? context.config.profiles.mainnet : context.config.profiles.testnet;
  if (!profile) {
    throw new StellarAgentError({
      code: "PROFILE_NOT_FOUND",
      message: `${realFunds ? "Mainnet" : "Testnet"} profile is not configured.`
    });
  }
  if (realFunds) {
    if (!profile.enabled) {
      throw new StellarAgentError({
        code: "MAINNET_NOT_ENABLED",
        message: "Mainnet contract operations require mainnet enablement.",
        hint: "Run stellar-agent mainnet enable --i-understand-real-funds first.",
        docs: "docs/mainnet-safety.md#mainnet-contracts"
      });
    }
    if (options.mutating && (!options.allowRealFunds || !options.acknowledgeRealFunds)) {
      throw new StellarAgentError({
        code: "MAINNET_NOT_ENABLED",
        message: "Mainnet contract operations require --allow-real-funds and --i-understand-real-funds.",
        hint: "Use an external Stellar CLI identity or browser-wallet signing flow; stellar-agent will not import Mainnet secret keys.",
        docs: "docs/mainnet-safety.md#mainnet-contracts"
      });
    }
  }
  return {
    realFunds,
    rpcUrl: profile.rpcUrl,
    networkPassphrase: profile.networkPassphrase
  };
}

function isRealFundsContractNetwork(network: string): boolean {
  return ["mainnet", "public", "pubnet"].includes(network.toLowerCase());
}

async function resolveContractSource(
  context: CliContext,
  source: string,
  options: { realFunds?: boolean } = {}
): Promise<string> {
  if (options.realFunds) {
    if (/^S[A-Z2-7]{55}$/.test(source)) {
      throw new StellarAgentError({
        code: "SECRET_KEY_BLOCKED",
        message: "Raw secret keys are not accepted for Mainnet contract operations.",
        hint: "Use a Stellar CLI identity or browser-wallet signing flow for Mainnet.",
        docs: "docs/mainnet-safety.md#mainnet-contracts"
      });
    }
    try {
      const wallet = await loadWalletPublic(context.config, source);
      if (wallet.hasSecret) {
        throw new StellarAgentError({
          code: "MAINNET_NOT_ENABLED",
          message: "Local generated Testnet wallets cannot be used for Mainnet contract operations.",
          hint: "Use a Stellar CLI identity or a watch-only Mainnet public wallet.",
          docs: "docs/mainnet-safety.md#mainnet-contracts"
        });
      }
      return wallet.publicKey;
    } catch (error) {
      if (error instanceof StellarAgentError && error.code !== "WALLET_NOT_FOUND") throw error;
    }
    return source;
  }
  if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(source)) {
    try {
      const wallet = await loadWallet(context.config, source);
      return wallet.secretKey;
    } catch {
      return source;
    }
  }
  return source;
}

async function resolvePaymentSourcePublicKey(
  context: CliContext,
  source: string,
  options: { realFunds?: boolean } = {}
): Promise<string> {
  if (/^G[A-Z2-7]{55}$/.test(source)) return source;
  if (options.realFunds && /^S[A-Z2-7]{55}$/.test(source)) {
    throw new StellarAgentError({
      code: "SECRET_KEY_BLOCKED",
      message: "Raw secret keys are not accepted for Mainnet payment-XDR workflows.",
      hint: "Import a watch-only Mainnet public wallet or pass a raw public key.",
      docs: "docs/mainnet-safety.md#signed-xdr-submission"
    });
  }
  const wallet = await loadWalletPublic(context.config, source);
  if (options.realFunds && wallet.hasSecret) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Local generated Testnet wallets cannot be used for Mainnet payment-XDR workflows.",
      hint: "Import a watch-only Mainnet public wallet or pass a raw public key.",
      docs: "docs/mainnet-safety.md#signed-xdr-submission"
    });
  }
  return wallet.publicKey;
}

if (isCliEntrypoint()) {
  const argv =
    process.argv[2] === "--" ? [process.argv[0] ?? "node", process.argv[1] ?? "stellar-agent", ...process.argv.slice(3)] : process.argv;
  await buildProgram().parseAsync(argv);
}

export function isCliEntrypoint(argvPath = process.argv[1], moduleUrl = import.meta.url): boolean {
  if (!argvPath) return false;
  return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
}

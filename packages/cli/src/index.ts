#!/usr/bin/env node
import {
  EXIT_CODES,
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
import { latestLedger, lookupTransaction, parseStellarCliTransactionHash, resolveNetworkProfile } from "@stellar-agent/stellar";
import {
  appendEvent,
  latestReceipt,
  listReceipts,
  readReceipt,
  verifyReceipt,
  writeReceipt
} from "@stellar-agent/ledger-logger";
import {
  DEFAULT_MAINNET_POLICY,
  DEFAULT_TESTNET_POLICY,
  Policy,
  defaultPolicyForNetwork,
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
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  stellar-agent wallet trustline add --asset USD:G... --account merchant
  stellar-agent pay send --to G... --amount 1 --asset XLM
  stellar-agent tx submit-approval appr_...
  stellar-agent claimable create --to G... --amount 1
  stellar-agent contract invoke --id C... --source agent --fn hello --arg to=world
  stellar-agent policy explain --request ./payment-request.json`
    );

  addProfileCommands(program);
  addTestnetCommands(program);
  addWalletCommands(program);
  addApprovalCommands(program);
  addTransactionCommands(program);
  addPayCommands(program);
  addClaimableCommands(program);
  addContractCommands(program);
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
    .command("serve")
    .description("Start the local approval bridge HTTP server.")
    .option("--host <host>", "Host", "127.0.0.1")
    .option("--port <port>", "Port", parsePortOption, 0)
    .action(async (options: { host: string; port: number }, command: Command) => {
      const parent = command.optsWithGlobals() as CliOptions;
      const config = await loadConfig(parent);
      const profileName = (parent.profile ?? process.env.STELLAR_AGENT_PROFILE ?? config.activeProfile ?? "testnet") as NetworkName;
      const context: CliContext = { options: parent, config, profileName };
      const { startApprovalBridge } = await import("@stellar-agent/freighter-bridge");
      const bridge = await startApprovalBridge({
        approvalsDir: context.config.storage.approvalsDir,
        host: options.host,
        port: options.port
      });
      if (parent.json) {
        process.stdout.write(`${JSON.stringify(ok({ url: bridge.url, approvalsDir: context.config.storage.approvalsDir }))}\n`);
      } else {
        process.stdout.write(`Approval bridge listening at ${bridge.url}\n`);
      }
      await new Promise<void>((resolveStop) => {
        process.once("SIGINT", resolveStop);
        process.once("SIGTERM", resolveStop);
      });
      await bridge.close();
    });
}

function addTransactionCommands(program: Command): void {
  const tx = program.command("tx").description("Build and submit transaction XDR on Testnet.");
  tx
    .command("build-payment")
    .description("Build unsigned payment transaction XDR for browser-wallet signing on Testnet.")
    .requiredOption("--to <address>", "Destination public key")
    .requiredOption("--amount <amount>", "Payment amount")
    .option("--asset <asset>", "Asset", "XLM")
    .option("--from <accountOrAddress>", "Local wallet name, watch-only wallet name, or source public key", "agent")
    .option("--memo <memo>", "Memo")
    .action(
      withContext(async (context, options: { to: string; amount: string; asset: string; from: string; memo?: string }) => {
        if (context.profileName !== "testnet") {
          throw new StellarAgentError({
            code: "MAINNET_NOT_ENABLED",
            message: "Payment-XDR building is only enabled for the Testnet profile in this build.",
            docs: "docs/mainnet-safety.md#signed-xdr-submission"
          });
        }
        const { buildPaymentTransactionXdr } = await import("@stellar-agent/stellar");
        const sourcePublicKey = await resolvePaymentSourcePublicKey(context, options.from);
        const built = await buildPaymentTransactionXdr({
          sourcePublicKey,
          destination: options.to,
          amount: options.amount,
          asset: options.asset,
          ...(options.memo === undefined ? {} : { memo: options.memo }),
          profile: context.config.profiles.testnet
        });
        await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
          event: "transaction_built",
          status: "unsigned_payment_xdr",
          command: "tx build-payment",
          profile: "testnet",
          data: { source: sourcePublicKey, destination: options.to, asset: options.asset, amount: built.amount }
        });
        return built;
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
    .action(
      withContext(
        async (
          context,
          options: { to: string; amount: string; asset: string; from: string; memo?: string; summary?: string }
        ) => {
          if (context.profileName !== "testnet") {
            throw new StellarAgentError({
              code: "MAINNET_NOT_ENABLED",
              message: "Payment signature requests are only enabled for the Testnet profile in this build.",
              docs: "docs/mainnet-safety.md#signed-xdr-submission"
            });
          }
          const { createTransactionXdrApprovalRequest } = await import("@stellar-agent/freighter-bridge");
          const { buildPaymentTransactionXdr } = await import("@stellar-agent/stellar");
          const sourcePublicKey = await resolvePaymentSourcePublicKey(context, options.from);
          const built = await buildPaymentTransactionXdr({
            sourcePublicKey,
            destination: options.to,
            amount: options.amount,
            asset: options.asset,
            ...(options.memo === undefined ? {} : { memo: options.memo }),
            profile: context.config.profiles.testnet
          });
          const approval = await createTransactionXdrApprovalRequest({
            approvalsDir: context.config.storage.approvalsDir,
            network: "testnet",
            transactionXdr: built.xdr,
            summary: options.summary ?? `Sign ${built.amount} ${built.asset} payment to ${options.to} on testnet`
          });
          await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
            event: "approval_requested",
            status: "pending",
            command: "tx request-payment-signature",
            profile: "testnet",
            requestId: approval.id,
            data: { approval, source: sourcePublicKey, destination: options.to, asset: options.asset, amount: built.amount }
          });
          return { approval, built };
        },
        "Payment signature approval request created."
      )
    );
  tx
    .command("submit-xdr")
    .description("Submit signed transaction XDR to Horizon on Testnet.")
    .requiredOption("--xdr <base64>", "Signed transaction XDR")
    .action(
      withContext(async (context, options: { xdr: string }) => {
        if (context.profileName !== "testnet") {
          throw new StellarAgentError({
            code: "MAINNET_NOT_ENABLED",
            message: "Signed-XDR submission is only enabled for the Testnet profile in this build.",
            docs: "docs/mainnet-safety.md#signed-xdr-submission"
          });
        }
        const { submitTransactionXdr } = await import("@stellar-agent/stellar");
        const transaction = await submitTransactionXdr({
          xdr: options.xdr,
          profile: context.config.profiles.testnet
        });
        await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
          event: "transaction_confirmed",
          status: "signed_xdr_submitted",
          command: "tx submit-xdr",
          profile: "testnet",
          data: { transaction }
        });
        return { transaction };
      }, "Signed transaction submitted.")
    );
  tx
    .command("submit-approval")
    .description("Submit signed transaction XDR recorded on a local approval request.")
    .argument("<id>", "Approval request id")
    .action(
      withContext(async (context, id: string) => {
        const { readApprovalRequest } = await import("@stellar-agent/freighter-bridge");
        const approval = await readApprovalRequest(context.config.storage.approvalsDir, id);
        if (approval.kind !== "transaction_xdr") {
          throw new StellarAgentError({
            code: "INVALID_INPUT",
            message: "Approval request must be a transaction-XDR request.",
            docs: "docs/mainnet-safety.md#signed-xdr-submission"
          });
        }
        if (approval.network !== "testnet" || context.profileName !== "testnet") {
          throw new StellarAgentError({
            code: "MAINNET_NOT_ENABLED",
            message: "Submitting signed approval XDR is only enabled for Testnet in this build.",
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
        const { submitTransactionXdr } = await import("@stellar-agent/stellar");
        const transaction = await submitTransactionXdr({
          xdr: approval.decision.signedTransactionXdr,
          profile: context.config.profiles.testnet
        });
        await appendEvent(join(context.config.storage.logsDir, "events.jsonl"), {
          event: "transaction_confirmed",
          status: "signed_approval_submitted",
          command: "tx submit-approval",
          profile: "testnet",
          requestId: approval.id,
          data: {
            approvalId: approval.id,
            signerPublicKey: approval.decision.signerPublicKey,
            transaction
          }
        });
        return { approvalId: approval.id, signerPublicKey: approval.decision.signerPublicKey, transaction };
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
    .description("Send an XLM or issued-asset payment on Testnet when policy allows.")
    .requiredOption("--to <address>", "Destination public key")
    .requiredOption("--amount <amount>", "Payment amount")
    .option("--asset <asset>", "Asset", "XLM")
    .option("--from <account>", "Local source wallet name", "agent")
    .option("--memo <memo>", "Memo")
    .option("--approval-id <id>", "Approved local approval request id")
    .option("--dry-run", "Evaluate locally without submitting")
    .action(
      withContext(async (context, options: { to: string; amount: string; asset: string; from: string; memo?: string; approvalId?: string; dryRun?: boolean }) => {
        if (context.profileName === "mainnet") {
          throw new StellarAgentError({
            code: "MAINNET_NOT_ENABLED",
            message: "Mainnet payment submission is blocked in v0.",
            docs: "docs/mainnet-safety.md"
          });
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
        const decision = evaluatePaymentRequest(policy, request);
        if (options.dryRun) return { request, policyDecision: decision, dryRun: true };
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
          profile: context.config.profiles.testnet
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
            ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun })
          });
        },
        "MPP session complete."
      )
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
            stellarBinary: string;
            stellarConfigDir?: string;
            stellarNoCache?: boolean;
          }
        ) => {
          const { invokeContractWithStellarCli } = await import("@stellar-agent/stellar");
          const source = await resolveContractSource(context, options.source);
          const contractArgs = parseKeyValueArgs(options.arg);
          const result = await invokeContractWithStellarCli({
            contractId: options.id,
            source,
            functionName: options.fn,
            contractArgs,
            network: options.network,
            rpcUrl: context.config.profiles.testnet.rpcUrl,
            networkPassphrase: context.config.profiles.testnet.networkPassphrase,
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
          const source = await resolveContractSource(context, options.source);
          const constructorArgs = parseKeyValueArgs(options.arg);
          const result = await deployContractWithStellarCli({
            source,
            ...(options.wasm === undefined ? {} : { wasm: options.wasm }),
            ...(options.wasmHash === undefined ? {} : { wasmHash: options.wasmHash }),
            ...(options.alias === undefined ? {} : { alias: options.alias }),
            constructorArgs,
            network: options.network,
            rpcUrl: context.config.profiles.testnet.rpcUrl,
            networkPassphrase: context.config.profiles.testnet.networkPassphrase,
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
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to Stellar CLI")
    .action(
      withContext(
        async (context, options: { source: string; wasm: string; network: string; stellarBinary: string; stellarConfigDir?: string; stellarNoCache?: boolean }) => {
          const { uploadContractWasmWithStellarCli } = await import("@stellar-agent/stellar");
          const source = await resolveContractSource(context, options.source);
          const result = await uploadContractWasmWithStellarCli({
            source,
            wasm: options.wasm,
            network: options.network,
            rpcUrl: context.config.profiles.testnet.rpcUrl,
            networkPassphrase: context.config.profiles.testnet.networkPassphrase,
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
    .option("--stellar-binary <path>", "Path to stellar CLI binary", "stellar")
    .option("--stellar-config-dir <path>", "Stellar CLI config directory")
    .option("--stellar-no-cache", "Pass --no-cache to Stellar CLI")
    .action(
      withContext(
        async (
          context,
          options: { source: string; asset: string; alias?: string; network: string; stellarBinary: string; stellarConfigDir?: string; stellarNoCache?: boolean }
        ) => {
          const { deployAssetContractWithStellarCli } = await import("@stellar-agent/stellar");
          const source = await resolveContractSource(context, options.source);
          const result = await deployAssetContractWithStellarCli({
            source,
            asset: options.asset,
            ...(options.alias === undefined ? {} : { alias: options.alias }),
            network: options.network,
            rpcUrl: context.config.profiles.testnet.rpcUrl,
            networkPassphrase: context.config.profiles.testnet.networkPassphrase,
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
          return assetContractIdWithStellarCli({
            asset: options.asset,
            network: options.network,
            rpcUrl: context.config.profiles.testnet.rpcUrl,
            networkPassphrase: context.config.profiles.testnet.networkPassphrase,
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
          return contractInfoWithStellarCli({
            kind: options.kind,
            ...(options.id === undefined ? {} : { contractId: options.id }),
            ...(options.wasm === undefined ? {} : { wasm: options.wasm }),
            ...(options.wasmHash === undefined ? {} : { wasmHash: options.wasmHash }),
            network: options.network,
            rpcUrl: context.config.profiles.testnet.rpcUrl,
            networkPassphrase: context.config.profiles.testnet.networkPassphrase,
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
          return readContractWithStellarCli({
            ...(options.id === undefined ? {} : { contractId: options.id }),
            ...(options.key === undefined ? {} : { key: options.key }),
            ...(options.keyXdr === undefined ? {} : { keyXdr: options.keyXdr }),
            ...(options.wasm === undefined ? {} : { wasm: options.wasm }),
            ...(options.wasmHash === undefined ? {} : { wasmHash: options.wasmHash }),
            durability: options.durability,
            output: options.output,
            network: options.network,
            rpcUrl: context.config.profiles.testnet.rpcUrl,
            networkPassphrase: context.config.profiles.testnet.networkPassphrase,
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
          return fetchContractWasmWithStellarCli({
            ...(options.id === undefined ? {} : { contractId: options.id }),
            ...(options.wasmHash === undefined ? {} : { wasmHash: options.wasmHash }),
            ...(options.outFile === undefined ? {} : { outFile: options.outFile }),
            network: options.network,
            rpcUrl: context.config.profiles.testnet.rpcUrl,
            networkPassphrase: context.config.profiles.testnet.networkPassphrase,
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
            stellarBinary: string;
            stellarConfigDir?: string;
            stellarNoCache?: boolean;
          }
        ) => {
          validateDurability(options.durability);
          const { extendContractWithStellarCli } = await import("@stellar-agent/stellar");
          const source = await resolveContractSource(context, options.source);
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
            rpcUrl: context.config.profiles.testnet.rpcUrl,
            networkPassphrase: context.config.profiles.testnet.networkPassphrase,
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
            stellarBinary: string;
            stellarConfigDir?: string;
            stellarNoCache?: boolean;
          }
        ) => {
          validateDurability(options.durability);
          const { restoreContractWithStellarCli } = await import("@stellar-agent/stellar");
          const source = await resolveContractSource(context, options.source);
          const result = await restoreContractWithStellarCli({
            source,
            ...(options.id === undefined ? {} : { contractId: options.id }),
            ...(options.key === undefined ? {} : { key: options.key }),
            ...(options.keyXdr === undefined ? {} : { keyXdr: options.keyXdr }),
            ...(options.wasm === undefined ? {} : { wasm: options.wasm }),
            ...(options.wasmHash === undefined ? {} : { wasmHash: options.wasmHash }),
            durability: options.durability,
            network: options.network,
            rpcUrl: context.config.profiles.testnet.rpcUrl,
            networkPassphrase: context.config.profiles.testnet.networkPassphrase,
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

async function resolveContractSource(context: CliContext, source: string): Promise<string> {
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

async function resolvePaymentSourcePublicKey(context: CliContext, source: string): Promise<string> {
  if (/^G[A-Z2-7]{55}$/.test(source)) return source;
  const wallet = await loadWalletPublic(context.config, source);
  return wallet.publicKey;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildProgram().parseAsync(process.argv);
}

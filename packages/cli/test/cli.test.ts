import { EXIT_CODES, createDefaultConfig } from "@stellar-agent/core";
import { createTransactionXdrApprovalRequest, decideApprovalRequest, readApprovalRequest } from "@stellar-agent/freighter-bridge";
import { writeReceipt } from "@stellar-agent/ledger-logger";
import { DEFAULT_MAINNET_POLICY, DEFAULT_TESTNET_POLICY, policyToYaml } from "@stellar-agent/policy";
import { ensureWallet } from "@stellar-agent/testnet-suite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stringify } from "yaml";
import { buildProgram, isCliEntrypoint } from "../src/index.js";

const transactionHash = "a".repeat(64);
const contractId = "CB7Y2XA3ULT62HEH6DPAUGVGUTSVL7JO5T5VOYUW6UVZI6SG72UOKSYR";
const require = createRequire(import.meta.url);
const { version: cliVersion } = require("../package.json");
const { Account, Asset, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } = require("../../stellar/node_modules/@stellar/stellar-sdk");

const walletConnectMockState = vi.hoisted(() => ({
  signedTransactionXdr: "",
  signerPublicKey: "",
  signCalls: [] as any[],
  createClientCalls: [] as any[]
}));

vi.mock("@stellar-agent/walletconnect-bridge", () => ({
  createWalletConnectSignClient: vi.fn(async (args: any) => {
    walletConnectMockState.createClientCalls.push(args);
    return { mockWalletConnectClient: true };
  }),
  disconnectWalletConnectSession: vi.fn(async (_args: any) => ({ topic: _args.topic, disconnected: true })),
  listWalletConnectSessions: vi.fn(() => []),
  pairWalletConnectSession: vi.fn(async (args: any) => {
    args.onPairingUri?.("wc:test-pairing-uri");
    return { topic: "topic-test", namespaces: { stellar: { accounts: [], methods: ["stellar_signXDR"] } } };
  }),
  signTransactionXdrWithWalletConnect: vi.fn(async (args: any) => {
    walletConnectMockState.signCalls.push(args);
    args.onPairingUri?.("wc:test-pairing-uri");
    return {
      signedTransactionXdr: walletConnectMockState.signedTransactionXdr,
      signerPublicKey: walletConnectMockState.signerPublicKey,
      session: {
        topic: "topic-test",
        peer: { metadata: { name: "LOBSTR", url: "https://lobstr.co" } },
        namespaces: {
          stellar: {
            accounts: [`stellar:testnet:${walletConnectMockState.signerPublicKey}`],
            methods: ["stellar_signXDR"],
            events: []
          }
        }
      },
      chainId: "stellar:testnet",
      method: "stellar_signXDR"
    };
  }),
  walletConnectMetadata: vi.fn((wallet: string) => ({ name: "Stellar Agent", description: wallet, url: "https://example.test", icons: [] })),
  walletConnectSessionView: vi.fn((session: any) => ({
    topic: session.topic,
    peerName: session.peer?.metadata?.name,
    peerUrl: session.peer?.metadata?.url,
    accounts: [{ namespace: "stellar", chain: "testnet", address: walletConnectMockState.signerPublicKey, raw: `stellar:testnet:${walletConnectMockState.signerPublicKey}` }]
  }))
}));

describe("CLI package entrypoint", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("treats npm .bin symlinks as executable entrypoints", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-cli-entrypoint-"));
    const sourcePath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    const symlinkPath = join(root, "stellar-agent");
    await symlink(sourcePath, symlinkPath);

    expect(isCliEntrypoint(symlinkPath, pathToFileURL(sourcePath).href)).toBe(true);
  });

  it("prints plain and JSON version output", async () => {
    await expect(runCliText(["--version"])).resolves.toBe(`${cliVersion}\n`);
    await expect(runCli(["--json", "--version"])).resolves.toEqual({ ok: true, data: { version: cliVersion } });
  });

  it("stops before dispatching subcommands when the root version flag is present", async () => {
    const mutatingPaymentArgs = ["pay", "send", "--to", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "--amount", "1"];

    await expect(runCliText(["--version", ...mutatingPaymentArgs])).resolves.toBe(`${cliVersion}\n`);
    await expect(runCli(["--version", "--json", ...mutatingPaymentArgs])).resolves.toEqual({
      ok: true,
      data: { version: cliVersion }
    });
  });

  it("keeps Blend pool version options separate from the root version flag", () => {
    const program = buildProgram();
    const rootVersionOption = program.options.find((option) => option.long === "--version");
    const inspectCommand = program.commands
      .find((command) => command.name() === "defi")
      ?.commands.find((command) => command.name() === "blend")
      ?.commands.find((command) => command.name() === "pool")
      ?.commands.find((command) => command.name() === "inspect");
    const blendVersionOption = inspectCommand?.options.find((option) => option.long === "--version");

    expect(rootVersionOption?.required).toBe(false);
    expect(blendVersionOption?.required).toBe(true);
  });

  it("reports unknown commands as usage errors even when help is requested", async () => {
    await expect(runCli(["--json", "does-not-exist", "--help"])).resolves.toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Unknown command 'does-not-exist'."
      }
    });
    expect(process.exitCode).toBe(EXIT_CODES.usage);
    process.exitCode = undefined;

    await expect(runCli(["--json", "x402", "does-not-exist", "--help"])).resolves.toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Unknown command 'does-not-exist'."
      }
    });
    expect(process.exitCode).toBe(EXIT_CODES.usage);
  });

  it("keeps wallet use-env secretPrinted as a boolean", async () => {
    const originalSecret = process.env.STELLAR_SECRET_KEY;
    delete process.env.STELLAR_SECRET_KEY;
    try {
      await expect(runCli(["--json", "wallet", "use-env"])).resolves.toEqual({
        ok: true,
        data: { configured: false, secretPrinted: false }
      });
    } finally {
      if (originalSecret === undefined) delete process.env.STELLAR_SECRET_KEY;
      else process.env.STELLAR_SECRET_KEY = originalSecret;
    }
  });
});

describe("CLI contract receipts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("writes an operation receipt when a Testnet contract submission reports a transaction hash", async () => {
    const { configPath, stellarBinary } = await createCliFixture({
      stdout: `${contractId}\n`,
      stderr: `Signing transaction: ${transactionHash}\n`
    });

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "contract",
      "asset-deploy",
      "--source",
      "agent",
      "--asset",
      "native",
      "--stellar-binary",
      stellarBinary,
      "--stellar-config-dir",
      "/tmp/stellar-cli-test",
      "--stellar-no-cache"
    ]);

    expect(output.ok).toBe(true);
    expect(output.data).toMatchObject({
      stdout: `${contractId}\n`,
      transactionHash,
      receiptPath: expect.any(String)
    });

    const receipt = JSON.parse(await readFile(output.data.receiptPath, "utf8"));
    expect(receipt).toMatchObject({
      command: "contract asset-deploy",
      profile: "testnet",
      operation: {
        type: "contract.asset-deploy",
        source: "agent",
        asset: "native",
        details: {
          contractId
        }
      },
      transaction: {
        hash: transactionHash,
        successful: true
      }
    });
    expect(JSON.stringify(receipt)).not.toContain("\"S");
  });

  it("does not write a receipt for non-Testnet contract submissions", async () => {
    const { configPath, stellarBinary } = await createCliFixture({
      stdout: `${contractId}\n`,
      stderr: `Signing transaction: ${transactionHash}\n`
    });

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "contract",
      "asset-deploy",
      "--source",
      "agent",
      "--asset",
      "native",
      "--network",
      "local",
      "--stellar-binary",
      stellarBinary
    ]);

    expect(output.ok).toBe(true);
    expect(output.data.transactionHash).toBeUndefined();
    expect(output.data.receiptPath).toBeUndefined();
  });

  it("blocks Mainnet contract submissions unless guarded Mainnet mode is enabled", async () => {
    const { configPath, stellarBinary } = await createCliFixture({
      stdout: `${contractId}\n`,
      stderr: `Signing transaction: ${transactionHash}\n`
    });

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "contract",
      "asset-deploy",
      "--source",
      "agent",
      "--asset",
      "native",
      "--network",
      "mainnet",
      "--stellar-binary",
      stellarBinary
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "MAINNET_NOT_ENABLED",
        message: "Mainnet contract operations require mainnet enablement."
      }
    });
  });

  it("refuses local generated Testnet wallet secrets for guarded Mainnet contract submissions", async () => {
    const { configPath, stellarBinary } = await createCliFixture(
      {
        stdout: `${contractId}\n`,
        stderr: `Signing transaction: ${transactionHash}\n`
      },
      { mainnetEnabled: true }
    );

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "contract",
      "asset-deploy",
      "--source",
      "agent",
      "--asset",
      "native",
      "--network",
      "mainnet",
      "--allow-real-funds",
      "--i-understand-real-funds",
      "--stellar-binary",
      stellarBinary
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "MAINNET_NOT_ENABLED",
        message: "Local generated Testnet wallets cannot be used for Mainnet contract operations."
      }
    });
  });

  it("submits externally signed Mainnet XDR only with explicit real-funds flags and writes a receipt", async () => {
    const { configPath } = await createCliFixture(
      {
        stdout: `${contractId}\n`,
        stderr: `Signing transaction: ${transactionHash}\n`
      },
      { mainnetEnabled: true }
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          hash: transactionHash,
          ledger: 12345,
          successful: true,
          fee_charged: "100"
        })
      )
    );

    const output = await runCli([
      "--config",
      configPath,
      "--profile",
      "mainnet",
      "--json",
      "tx",
      "submit-xdr",
      "--xdr",
      signedPaymentXdrFixture(),
      "--allow-real-funds",
      "--i-understand-real-funds"
    ]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://horizon.stellar.org/transactions",
      expect.objectContaining({ method: "POST" })
    );
    expect(output).toMatchObject({
      ok: true,
      data: {
        transaction: { hash: transactionHash, ledger: 12345, successful: true },
        receiptPath: expect.any(String),
        realFunds: true
      }
    });
    const receipt = JSON.parse(await readFile(output.data.receiptPath, "utf8"));
    expect(receipt).toMatchObject({
      command: "tx submit-xdr",
      profile: "mainnet",
      network: { realFunds: true },
      operation: {
        type: "tx.submit_xdr"
      },
      policyDecision: {
        status: "requires_approval",
        matchedRules: ["signed_xdr_external_wallet", "real_funds_acknowledged"]
      },
      transaction: {
        hash: transactionHash,
        ledger: 12345,
        successful: true
      }
    });
    expect(JSON.stringify(receipt)).not.toContain("\"S");
  });

  it("writes payment receipts for signed payment approval submission", async () => {
    const { configPath, config } = await createCliFixture(
      {
        stdout: "",
        stderr: ""
      },
      { mainnetEnabled: true }
    );
    const { signerPublicKey, unsignedXdr, signedXdr } = signedPaymentXdrPair("0.01");
    const payment = {
      source: signerPublicKey,
      destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      amount: "0.01",
      asset: "XLM",
      network: "mainnet" as const
    };
    const approval = await createTransactionXdrApprovalRequest({
      approvalsDir: config.storage.approvalsDir,
      network: "mainnet",
      transactionXdr: unsignedXdr,
      summary: "Sign small Mainnet payment",
      payment
    });
    await decideApprovalRequest({
      approvalsDir: config.storage.approvalsDir,
      id: approval.id,
      approved: true,
      signerPublicKey,
      signedTransactionXdr: signedXdr
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          hash: transactionHash,
          ledger: 12345,
          successful: true,
          fee_charged: "100"
        })
      )
    );

    const output = await runCli([
      "--config",
      configPath,
      "--profile",
      "mainnet",
      "--json",
      "tx",
      "submit-approval",
      approval.id,
      "--allow-real-funds",
      "--i-understand-real-funds"
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        receiptPath: expect.any(String),
        realFunds: true
      }
    });
    const receipt = JSON.parse(await readFile(output.data.receiptPath, "utf8"));
    expect(receipt).toMatchObject({
      command: "tx submit-approval",
      profile: "mainnet",
      network: { realFunds: true },
      payment: {
        source: signerPublicKey,
        destination: payment.destination,
        amount: "0.01",
        asset: "XLM"
      },
      operation: {
        type: "tx.submit_payment_approval",
        details: {
          approvalId: approval.id,
          signerPublicKey
        }
      },
      policyDecision: {
        status: "requires_approval",
        matchedRules: expect.arrayContaining(["mainnet_requires_approval"])
      },
      transaction: {
        hash: transactionHash,
        ledger: 12345,
        successful: true
      }
    });
    expect(JSON.stringify(receipt)).not.toContain("\"S");
  });

  it("records WalletConnect signed XDR on an approval without submitting it", async () => {
    const { configPath, config } = await createCliFixture({ stdout: "", stderr: "" });
    const { signerPublicKey, unsignedXdr, signedXdr } = signedTestnetPaymentXdrPair("1");
    walletConnectMockState.signerPublicKey = signerPublicKey;
    walletConnectMockState.signedTransactionXdr = signedXdr;
    walletConnectMockState.signCalls = [];
    walletConnectMockState.createClientCalls = [];
    const payment = {
      source: signerPublicKey,
      destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      amount: "1",
      asset: "XLM",
      network: "testnet" as const
    };
    const approval = await createTransactionXdrApprovalRequest({
      approvalsDir: config.storage.approvalsDir,
      network: "testnet",
      transactionXdr: unsignedXdr,
      summary: "Sign testnet payment with LOBSTR",
      payment
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "approval",
      "sign-walletconnect",
      approval.id,
      "--wallet",
      "lobstr",
      "--project-id",
      "project-test",
      "--timeout-ms",
      "10"
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        approval: { id: approval.id, status: "signed" },
        walletConnect: {
          wallet: "lobstr",
          method: "stellar_signXDR",
          submitted: false,
          custody: "external_wallet"
        }
      }
    });
    expect(walletConnectMockState.createClientCalls).toEqual([
      expect.objectContaining({
        projectId: "project-test",
        metadata: expect.objectContaining({ description: "lobstr" }),
        storagePath: join(config.storage.rootDir, "walletconnect", "sessions.db")
      })
    ]);
    expect(walletConnectMockState.signCalls).toEqual([
      expect.objectContaining({
        network: "testnet",
        transactionXdr: unsignedXdr,
        expectedSignerPublicKey: signerPublicKey,
        timeoutMs: 10
      })
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(readApprovalRequest(config.storage.approvalsDir, approval.id)).resolves.toMatchObject({
      id: approval.id,
      status: "signed",
      decision: {
        signerPublicKey,
        signedTransactionXdr: signedXdr
      }
    });
    const eventLog = await readFile(join(config.storage.logsDir, "events.jsonl"), "utf8");
    expect(eventLog).toContain("approval sign-walletconnect");
    expect(eventLog).not.toContain("wc:test-pairing-uri");
  });

  it("uses stable WalletConnect storage for session CLI commands", async () => {
    const { configPath, config } = await createCliFixture({ stdout: "", stderr: "" });
    walletConnectMockState.createClientCalls = [];

    await expect(
      runCli(["--config", configPath, "--json", "wallet", "walletconnect", "status", "--project-id", "project-test"])
    ).resolves.toMatchObject({
      ok: true,
      data: { wallet: "lobstr", sessions: [], custody: "external_wallet" }
    });
    await expect(
      runCli([
        "--config",
        configPath,
        "--json",
        "wallet",
        "walletconnect",
        "disconnect",
        "--topic",
        "topic-test",
        "--project-id",
        "project-test"
      ])
    ).resolves.toMatchObject({
      ok: true,
      data: { wallet: "lobstr", topic: "topic-test", disconnected: true, custody: "external_wallet" }
    });
    await expect(
      runCli([
        "--config",
        configPath,
        "--json",
        "wallet",
        "walletconnect",
        "pair",
        "--project-id",
        "project-test",
        "--timeout-ms",
        "10"
      ])
    ).resolves.toMatchObject({
      ok: true,
      data: { wallet: "lobstr", network: "testnet", pairingUriPrinted: true, custody: "external_wallet" }
    });

    expect(walletConnectMockState.createClientCalls).toEqual([
      expect.objectContaining({ storagePath: join(config.storage.rootDir, "walletconnect", "sessions.db") }),
      expect.objectContaining({ storagePath: join(config.storage.rootDir, "walletconnect", "sessions.db") }),
      expect.objectContaining({ storagePath: join(config.storage.rootDir, "walletconnect", "sessions.db") })
    ]);
  });

  it("refuses Mainnet WalletConnect signing without real-funds acknowledgements", async () => {
    const { configPath, config } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const { signerPublicKey, unsignedXdr } = signedPaymentXdrPair("0.01");
    const approval = await createTransactionXdrApprovalRequest({
      approvalsDir: config.storage.approvalsDir,
      network: "mainnet",
      transactionXdr: unsignedXdr,
      summary: "Sign small Mainnet payment",
      payment: {
        source: signerPublicKey,
        destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        amount: "0.01",
        asset: "XLM",
        network: "mainnet"
      }
    });

    const output = await runCli([
      "--config",
      configPath,
      "--profile",
      "mainnet",
      "--json",
      "approval",
      "sign-walletconnect",
      approval.id,
      "--wallet",
      "lobstr",
      "--project-id",
      "project-test"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "MAINNET_NOT_ENABLED",
        message: "Mainnet WalletConnect signing requires --allow-real-funds and --i-understand-real-funds."
      }
    });
  });

  it("quotes payments with fee stats metadata", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          last_ledger_base_fee: "100",
          fee_charged: { p50: "100", p80: "250", p90: "300", p95: "450" }
        })
      )
    );

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "pay",
      "quote",
      "--to",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "--amount",
      "1",
      "--fee-strategy",
      "p95"
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        estimatedFee: {
          source: "horizon",
          strategy: "p95",
          perOperationFee: "450",
          transactionFee: "450"
        },
        policyDecision: { status: "allowed" }
      }
    });
  });

  it("evaluates batch payment dry-runs without submitting a transaction", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" });
    const batchPath = join(tmpdir(), `stellar-agent-batch-${Date.now()}.json`);
    await writeFile(
      batchPath,
      JSON.stringify([
        { destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", amount: "1", asset: "XLM" },
        { destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", amount: "2", asset: "XLM" }
      ])
    );

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "pay",
      "batch",
      "--file",
      batchPath,
      "--dry-run"
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        dryRun: true,
        aggregate: { status: "allowed" },
        payments: [
          { request: { amount: "1.0000000" }, policyDecision: { status: "allowed" } },
          { request: { amount: "2.0000000" }, policyDecision: { status: "allowed" } }
        ]
      }
    });
  });

  it("rejects invalid fee strategies with a docs-linked hint", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" });
    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "pay",
      "quote",
      "--to",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "--amount",
      "1",
      "--fee-strategy",
      "fastest"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        hint: expect.stringContaining("--fee-strategy medium"),
        docs: "docs/troubleshooting.md#fee-too-low"
      }
    });
  });

  it("marks Mainnet payment quotes as real funds when a Testnet policy is supplied", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" });
    const policyRoot = await mkdtemp(join(tmpdir(), "stellar-agent-cli-policy-"));
    const policyPath = join(policyRoot, "default-testnet.yaml");
    await writeFile(policyPath, policyToYaml(DEFAULT_TESTNET_POLICY));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ last_ledger_base_fee: "100" })));

    const output = await runCli([
      "--config",
      configPath,
      "--policy",
      policyPath,
      "--profile",
      "mainnet",
      "--json",
      "--no-cache",
      "pay",
      "quote",
      "--to",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "--amount",
      "0.01"
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        policyDecision: {
          status: "denied",
          network: "mainnet",
          realFunds: true,
          matchedRules: expect.arrayContaining(["policy_network_mismatch", "mainnet_requires_approval"])
        }
      }
    });
  });

  it("uses the default local policy for local payment quotes", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" }, { localProfile: true, testnetPolicy: true });

    const output = await runCli([
      "--config",
      configPath,
      "--profile",
      "local",
      "--json",
      "pay",
      "quote",
      "--to",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "--amount",
      "1"
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        request: { network: "local" },
        estimatedFee: { source: "base_fee_fallback" },
        policyDecision: {
          status: "allowed",
          network: "local",
          realFunds: false
        }
      }
    });
    expect(output.data.policyDecision.matchedRules).not.toContain("policy_network_mismatch");
  });

  it("initializes local policies under a local-specific filename", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" }, { localProfile: true });

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "policy",
      "init",
      "--network",
      "local"
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        path: expect.stringContaining("default-local.yaml"),
        policy: { name: "default-local-policy", network: "local" }
      }
    });
  });

  it("summarizes local receipts by profile and asset", async () => {
    const { configPath, config } = await createCliFixture({ stdout: "", stderr: "" });
    await writeReceipt(config.storage.receiptsDir, {
      command: "pay send",
      profile: "testnet",
      networkPassphrase: config.profiles.testnet.networkPassphrase,
      realFunds: false,
      payment: {
        source: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        asset: "XLM",
        amount: "1.0000000"
      },
      policyDecision: { status: "allowed", matchedRules: ["test"] },
      transaction: { hash: transactionHash, successful: true }
    });

    const output = await runCli(["--config", configPath, "--json", "receipts", "summary"]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        receiptCount: 1,
        paymentCount: 1,
        totals: {
          "testnet:XLM": { amount: "1.0000000", count: 1 }
        },
        profiles: {
          testnet: { count: 1, realFundsCount: 0 }
        }
      }
    });
  });

  it("initializes a local x402 server scaffold", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" });
    const out = await mkdtemp(join(tmpdir(), "stellar-agent-x402-scaffold-"));

    const output = await runCli(["--config", configPath, "--json", "x402", "init-server", "--out", out]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        path: out,
        files: expect.arrayContaining(["package.json", "server.mjs", "README.md"]),
        network: "testnet",
        realFunds: false
      }
    });
    const server = await readFile(join(out, "server.mjs"), "utf8");
    expect(server).toContain("payment-required");
    expect(server).toContain("verifyPaymentProof");
    expect(server).toContain("payment_proof_replayed");
    expect(server).not.toContain("Replace this demo verifier before production.");

    const again = await runCli(["--config", configPath, "--json", "x402", "init-server", "--out", out]);
    expect(again).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", message: expect.stringContaining("Refusing to overwrite") }
    });
  });

  it("manages a risk-budgeted Mainnet agent wallet without storing a secret key", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const destination = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(accountFixture())));

    const created = await runCli([
      "--config",
      configPath,
      "--json",
      "mainnet",
      "agent-wallet",
      "create",
      "--address",
      address,
      "--max-balance",
      "125",
      "--daily-limit",
      "5",
      "--per-tx-limit",
      "1",
      "--asset",
      "XLM",
      "--allow-destination",
      destination
    ]);

    expect(created).toMatchObject({
      ok: true,
      data: {
        walletName: "mainnet-agent",
        publicKey: address,
        armed: false,
        status: "disarmed",
        realFunds: true,
        warning: expect.stringContaining("bounded, not safe")
      }
    });
    expect(JSON.stringify(created)).not.toContain("\"S");

    const armed = await runCli([
      "--config",
      configPath,
      "--json",
      "mainnet",
      "agent-wallet",
      "arm",
      "--i-understand-real-funds"
    ]);

    expect(armed).toMatchObject({
      ok: true,
      data: {
        armed: true,
        status: "armed",
        arming: {
          configPath,
          policyPath: expect.stringContaining("default-mainnet.yaml")
        }
      }
    });

    const status = await runCli(["--config", configPath, "--json", "mainnet", "agent-wallet", "status"]);
    expect(status).toMatchObject({
      ok: true,
      data: {
        configured: true,
        armed: true,
        integrity: { ok: true, checked: true, failures: [] }
      }
    });

    const disarmed = await runCli(["--config", configPath, "--json", "mainnet", "agent-wallet", "disarm"]);
    expect(disarmed).toMatchObject({
      ok: true,
      data: { armed: false, status: "disarmed" }
    });
  });

  it("refuses Mainnet agent-wallet payment-signature requests before arming", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

    await runCli([
      "--config",
      configPath,
      "--json",
      "mainnet",
      "agent-wallet",
      "create",
      "--address",
      address,
      "--allow-destination",
      address
    ]);

    const output = await runCli([
      "--config",
      configPath,
      "--profile",
      "mainnet",
      "--json",
      "tx",
      "request-payment-signature",
      "--from",
      "mainnet-agent",
      "--to",
      address,
      "--amount",
      "0.01",
      "--allow-real-funds",
      "--i-understand-real-funds"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "MAINNET_NOT_ENABLED",
        message: "Mainnet agent-wallet payment workflows require the wallet to be armed."
      }
    });
  });

  it("refuses to arm a Mainnet agent wallet over the configured balance cap", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(accountFixture())));

    await runCli([
      "--config",
      configPath,
      "--json",
      "mainnet",
      "agent-wallet",
      "create",
      "--address",
      address,
      "--max-balance",
      "25",
      "--allow-destination",
      address
    ]);

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "mainnet",
      "agent-wallet",
      "arm",
      "--i-understand-real-funds"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "POLICY_DENIED",
        message: "Mainnet agent-wallet balance exceeds the configured risk budget."
      }
    });
  });

  it("enables Mainnet agent-wallet autosigning without storing a secret key", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const signer = Keypair.random();

    const enabled = await runCli([
      "--config",
      configPath,
      "--json",
      "mainnet",
      "agent-wallet",
      "enable",
      "--address",
      signer.publicKey(),
      "--max-balance",
      "125",
      "--daily-limit",
      "5",
      "--per-tx-limit",
      "1",
      "--allow-destination",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "--enable-autosign",
      "--secret-key-env",
      "STELLAR_AGENT_TEST_SECRET",
      "--i-understand-agent-wallet-autosign"
    ]);

    expect(enabled).toMatchObject({
      ok: true,
      data: {
        autosign: {
          enabled: true,
          secretKeyEnvVar: "[REDACTED]",
          warning: expect.stringContaining("can spend real funds")
        }
      }
    });
    const rawConfig = await readFile(configPath, "utf8");
    expect(rawConfig).toContain("STELLAR_AGENT_TEST_SECRET");
    expect(rawConfig).not.toContain(signer.secret());
  });

  it("keeps Mainnet pay send blocked outside the configured agent-wallet account", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });

    const output = await runCli([
      "--config",
      configPath,
      "--profile",
      "mainnet",
      "--json",
      "pay",
      "send",
      "--from",
      "agent",
      "--to",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "--amount",
      "0.01",
      "--allow-real-funds",
      "--i-understand-real-funds",
      "--i-understand-agent-wallet-autosign"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "WALLET_NOT_FOUND",
        message: "Mainnet agent wallet is not configured."
      }
    });
  });

  it("refuses Mainnet agent-wallet autosign when policy still requires approval", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const signer = Keypair.random();
    const destination = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    let transactionSubmitCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.includes("/transactions")) transactionSubmitCalls += 1;
      if (url.includes("/accounts/")) return new Response(JSON.stringify(accountFixture(signer.publicKey())));
      if (url.includes("/fee_stats")) return new Response(JSON.stringify({ last_ledger_base_fee: "100" }));
      return new Response(JSON.stringify({ hash: transactionHash, ledger: 12345, successful: true, fee_charged: "100" }));
    });
    await enableArmedAutosignWallet(configPath, signer.publicKey(), destination);

    const output = await runCli([
      "--config",
      configPath,
      "--profile",
      "mainnet",
      "--json",
      "pay",
      "send",
      "--from",
      "mainnet-agent",
      "--to",
      destination,
      "--amount",
      "0.01",
      "--allow-real-funds",
      "--i-understand-real-funds",
      "--i-understand-agent-wallet-autosign"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "APPROVAL_REQUIRED",
        message: "Mainnet agent-wallet autosigning requires policy status 'allowed'.",
        details: {
          policyDecision: {
            status: "requires_approval",
            matchedRules: expect.arrayContaining(["mainnet_requires_approval"])
          }
        }
      }
    });
    expect(transactionSubmitCalls).toBe(0);
  });

  it("autosigns only the armed Mainnet agent-wallet payment path with explicit acknowledgements", async () => {
    const { configPath, config } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const signer = Keypair.random();
    const destination = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const previousSecret = process.env.STELLAR_AGENT_TEST_SECRET;
    process.env.STELLAR_AGENT_TEST_SECRET = signer.secret();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.includes("/accounts/")) return new Response(JSON.stringify(accountFixture(signer.publicKey())));
      if (url.includes("/fee_stats")) return new Response(JSON.stringify({ last_ledger_base_fee: "100" }));
      if (url.includes("/transactions")) {
        return new Response(JSON.stringify({ hash: transactionHash, ledger: 12345, successful: true, fee_charged: "100" }));
      }
      return new Response(JSON.stringify({}));
    });

    try {
      await writeMainnetAgentWalletAutosignPolicy(config);
      const enabled = await runCli([
        "--config",
        configPath,
        "--json",
        "mainnet",
        "agent-wallet",
        "enable",
        "--address",
        signer.publicKey(),
        "--max-balance",
        "125",
        "--daily-limit",
        "5",
        "--per-tx-limit",
        "1",
        "--allow-destination",
        destination,
        "--enable-autosign",
        "--secret-key-env",
        "STELLAR_AGENT_TEST_SECRET",
        "--i-understand-agent-wallet-autosign",
        "--arm",
        "--i-understand-real-funds"
      ]);
      expect(enabled).toMatchObject({ ok: true, data: { armed: true, status: "armed" } });

      const output = await runCli([
        "--config",
        configPath,
        "--profile",
        "mainnet",
        "--json",
        "pay",
        "send",
        "--from",
        "mainnet-agent",
        "--to",
        destination,
        "--amount",
        "0.01",
        "--allow-real-funds",
        "--i-understand-real-funds",
        "--i-understand-agent-wallet-autosign"
      ]);

      expect(output).toMatchObject({
        ok: true,
        data: {
          realFunds: true,
          autosign: { enabled: true, warning: expect.stringContaining("can spend real funds") },
          transaction: { hash: transactionHash, ledger: 12345, successful: true },
          receiptPath: expect.any(String)
        }
      });
      const receipt = JSON.parse(await readFile(output.data.receiptPath, "utf8"));
      expect(receipt).toMatchObject({
        command: "pay send",
        profile: "mainnet",
        network: { realFunds: true },
        operation: {
          type: "pay.send",
          details: {
            mainnetAgentWallet: {
              autosign: true,
              secretKeyEnvVar: "[REDACTED]",
              riskBudgetState: {
                before: { dailyTotal: "0.0000000" },
                after: { dailyTotal: "0.0100000" }
              }
            }
          }
        },
        policyDecision: {
          matchedRules: expect.arrayContaining(["mainnet_agent_wallet_autosign_acknowledged"])
        }
      });
      expect(JSON.stringify(receipt)).not.toContain(signer.secret());

      const configText = await readFile(configPath, "utf8");
      expect(configText).toContain("spendCounters");
      expect(configText).not.toContain(signer.secret());
    } finally {
      if (previousSecret === undefined) delete process.env.STELLAR_AGENT_TEST_SECRET;
      else process.env.STELLAR_AGENT_TEST_SECRET = previousSecret;
    }
  });

  it("refuses Mainnet agent-wallet autosign payments over the per-transaction cap", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const signer = Keypair.random();
    const destination = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    process.env.STELLAR_AGENT_TEST_SECRET = signer.secret();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(accountFixture(signer.publicKey()))));

    try {
      const enabled = await runCli([
        "--config",
        configPath,
        "--json",
        "mainnet",
        "agent-wallet",
        "enable",
        "--address",
        signer.publicKey(),
        "--max-balance",
        "125",
        "--daily-limit",
        "5",
        "--per-tx-limit",
        "0.01",
        "--allow-destination",
        destination,
        "--enable-autosign",
        "--secret-key-env",
        "STELLAR_AGENT_TEST_SECRET",
        "--i-understand-agent-wallet-autosign",
        "--arm",
        "--i-understand-real-funds"
      ]);
      expect(enabled).toMatchObject({ ok: true, data: { armed: true, status: "armed" } });

      const output = await runCli([
        "--config",
        configPath,
        "--profile",
        "mainnet",
        "--json",
        "pay",
        "send",
        "--from",
        "mainnet-agent",
        "--to",
        destination,
        "--amount",
        "0.02",
        "--allow-real-funds",
        "--i-understand-real-funds",
        "--i-understand-agent-wallet-autosign"
      ]);

      expect(output).toMatchObject({
        ok: false,
        error: {
          code: "POLICY_DENIED",
          message: "Mainnet agent-wallet payment exceeds the per-transaction risk budget."
        }
      });
    } finally {
      delete process.env.STELLAR_AGENT_TEST_SECRET;
    }
  });

  it("refuses Mainnet agent-wallet autosign payments over the daily receipt-derived cap", async () => {
    const { configPath, config } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const signer = Keypair.random();
    const destination = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(accountFixture(signer.publicKey()))));
    await enableArmedAutosignWallet(configPath, signer.publicKey(), destination, { dailyLimit: "0.01" });
    await writeMainnetPaymentReceipt(config, signer.publicKey(), destination, "0.0090000");

    const output = await runCli([
      "--config",
      configPath,
      "--profile",
      "mainnet",
      "--json",
      "pay",
      "send",
      "--from",
      "mainnet-agent",
      "--to",
      destination,
      "--amount",
      "0.002",
      "--allow-real-funds",
      "--i-understand-real-funds",
      "--i-understand-agent-wallet-autosign"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "POLICY_DENIED",
        message: "Mainnet agent-wallet payment would exceed the daily risk budget."
      }
    });
  });

  it("refuses Mainnet agent-wallet autosign payments over the monthly receipt-derived cap", async () => {
    const { configPath, config } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const signer = Keypair.random();
    const destination = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(accountFixture(signer.publicKey()))));
    await enableArmedAutosignWallet(configPath, signer.publicKey(), destination, { monthlyLimit: "0.01" });
    await writeMainnetPaymentReceipt(config, signer.publicKey(), destination, "0.0090000");

    const output = await runCli([
      "--config",
      configPath,
      "--profile",
      "mainnet",
      "--json",
      "pay",
      "send",
      "--from",
      "mainnet-agent",
      "--to",
      destination,
      "--amount",
      "0.002",
      "--allow-real-funds",
      "--i-understand-real-funds",
      "--i-understand-agent-wallet-autosign"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "POLICY_DENIED",
        message: "Mainnet agent-wallet payment would exceed the monthly risk budget."
      }
    });
  });

  it("fails closed when Mainnet agent-wallet receipt history cannot be read", async () => {
    const { configPath, config } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const signer = Keypair.random();
    const destination = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(accountFixture(signer.publicKey()))));
    await enableArmedAutosignWallet(configPath, signer.publicKey(), destination);
    await mkdir(config.storage.receiptsDir, { recursive: true });
    await writeFile(join(config.storage.receiptsDir, "bad-receipt.json"), "{not-json");

    const output = await runCli([
      "--config",
      configPath,
      "--profile",
      "mainnet",
      "--json",
      "pay",
      "send",
      "--from",
      "mainnet-agent",
      "--to",
      destination,
      "--amount",
      "0.001",
      "--allow-real-funds",
      "--i-understand-real-funds",
      "--i-understand-agent-wallet-autosign"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "POLICY_DENIED",
        message: "Mainnet agent-wallet spend history could not be read, so payment fails closed."
      }
    });
  });

  it("fails closed when policy changes after Mainnet agent-wallet arming", async () => {
    const { configPath, config } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const signer = Keypair.random();
    const destination = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(accountFixture(signer.publicKey()))));
    await enableArmedAutosignWallet(configPath, signer.publicKey(), destination);
    await mkdir(config.storage.policiesDir, { recursive: true });
    await writeFile(join(config.storage.policiesDir, "default-mainnet.yaml"), `${policyToYaml(DEFAULT_MAINNET_POLICY)}\n# changed after arming\n`, {
      mode: 0o600
    });

    const output = await runCli([
      "--config",
      configPath,
      "--profile",
      "mainnet",
      "--json",
      "pay",
      "send",
      "--from",
      "mainnet-agent",
      "--to",
      destination,
      "--amount",
      "0.001",
      "--allow-real-funds",
      "--i-understand-real-funds",
      "--i-understand-agent-wallet-autosign"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "POLICY_DENIED",
        message: "Mainnet agent-wallet arming is stale and must be refreshed.",
        details: { failures: expect.arrayContaining(["policy_changed_after_arming"]) }
      }
    });
  });

  it("fails closed when the config path changes after Mainnet agent-wallet arming", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const signer = Keypair.random();
    const destination = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(accountFixture(signer.publicKey()))));
    await enableArmedAutosignWallet(configPath, signer.publicKey(), destination);
    const copiedConfigPath = join(tmpdir(), `stellar-agent-config-copy-${Date.now()}.yaml`);
    await writeFile(copiedConfigPath, await readFile(configPath, "utf8"), { mode: 0o600 });

    const output = await runCli([
      "--config",
      copiedConfigPath,
      "--profile",
      "mainnet",
      "--json",
      "pay",
      "send",
      "--from",
      "mainnet-agent",
      "--to",
      destination,
      "--amount",
      "0.001",
      "--allow-real-funds",
      "--i-understand-real-funds",
      "--i-understand-agent-wallet-autosign"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "POLICY_DENIED",
        message: "Mainnet agent-wallet arming is stale and must be refreshed.",
        details: { failures: expect.arrayContaining(["config_path_changed"]) }
      }
    });
  });

  it("prints human-readable Mainnet agent-wallet status with warnings", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });
    const signer = Keypair.random();
    const destination = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(accountFixture(signer.publicKey()))));
    await enableArmedAutosignWallet(configPath, signer.publicKey(), destination);

    const output = await runCliText(["--config", configPath, "mainnet", "agent-wallet", "status"]);

    expect(output).toContain("Mainnet agent wallet status loaded.");
    expect(output).toContain("bounded, not safe");
    expect(output).toContain("autosign");
  });
});

describe("CLI DeFi commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("prints known Blend deployments without network access", async () => {
    const output = await runCli(["--json", "defi", "blend", "deployments", "--network", "testnet"]);
    expect(output).toMatchObject({
      ok: true,
      data: {
        network: "testnet",
        pools: expect.arrayContaining([expect.objectContaining({ name: "TestnetV2" })]),
        assets: expect.arrayContaining([
          expect.objectContaining({ symbol: "USDC", classicAsset: expect.stringContaining("USDC:G") })
        ])
      }
    });
  });

  it("guides Blend trustline creation from SAC aliases", async () => {
    const output = await runCli([
      "--json",
      "defi",
      "blend",
      "trustline",
      "guide",
      "--asset",
      "USDC",
      "--account",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
    ]);
    expect(output).toMatchObject({
      ok: true,
      data: {
        requiresTrustline: true,
        hasTrustline: false,
        asset: {
          symbol: "USDC",
          classicAsset: expect.stringContaining("USDC:G")
        },
        command: null
      }
    });
  });

  it("prints known Aquarius deployments without network access", async () => {
    const output = await runCli(["--json", "defi", "aquarius", "deployments", "--network", "testnet"]);
    expect(output).toMatchObject({
      ok: true,
      data: {
        network: "testnet",
        routerContractId: "CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD",
        apiBaseUrl: expect.stringContaining("amm-api-testnet"),
        assets: expect.arrayContaining([
          expect.objectContaining({ symbol: "AQUA", classicAsset: expect.stringContaining("AQUA:G") })
        ])
      }
    });
  });

  it("prints public Aquarius pool assets without redacting them", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              index: "pool-hash",
              address: "CPOOL",
              tokens_addresses: ["CXLM", "CAQUA"],
              tokens_str: ["native", "AQUA:GISSUER"],
              pool_type: "constant_product",
              fee: "0.0030"
            }
          ]
        })
      )
    );

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "defi",
      "aquarius",
      "pool",
      "inspect",
      "--pool",
      "XLM",
      "--network",
      "testnet"
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        pool: {
          assetLabels: ["native", "AQUA:GISSUER"],
          assetContractIds: ["CXLM", "CAQUA"]
        },
        raw: {
          results: [
            expect.objectContaining({
              assetLabels: ["native", "AQUA:GISSUER"],
              assetContractIds: ["CXLM", "CAQUA"]
            })
          ]
        }
      }
    });
    expect(JSON.stringify(output)).not.toContain("[REDACTED]");
  });

  it("accepts Aquarius swap slippage bounds above list limits", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          amount: 57842595,
          amount_with_fee: 57842595,
          swap_chain_xdr: "AAAA",
          pools: ["CPOOL"],
          tokens: ["native", "AQUA:GISSUER"],
          tokens_addresses: [
            "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
            "CDNVQW44C3HALYNVQ4SOBXY5EWYTGVYXX6JPESOLQDABJI5FC5LTRRUE"
          ]
        })
      )
    );

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "defi",
      "aquarius",
      "swap",
      "preflight",
      "--from",
      "XLM",
      "--to",
      "AQUA",
      "--amount",
      "0.01",
      "--slippage-bps",
      "500",
      "--network",
      "testnet"
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        policyDecision: { status: "allowed" },
        preflight: {
          slippageBps: 500,
          assets: expect.arrayContaining(["XLM", "AQUA", "native", "AQUA:GISSUER"]),
          assetGroups: expect.arrayContaining([
            expect.arrayContaining(["XLM", "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"]),
            expect.arrayContaining(["AQUA", "CDNVQW44C3HALYNVQ4SOBXY5EWYTGVYXX6JPESOLQDABJI5FC5LTRRUE"])
          ])
        }
      }
    });
  });

  it("prints JSON for Aquarius parse-time slippage errors", async () => {
    const output = await runCli([
      "--json",
      "defi",
      "aquarius",
      "swap",
      "preflight",
      "--from",
      "XLM",
      "--to",
      "AQUA",
      "--amount",
      "0.01",
      "--slippage-bps",
      "10001"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Slippage must be an integer between 0 and 10000 basis points.",
        docs: "docs/defi-aquarius.md#swap-quoting-and-preflight"
      }
    });
  });

  it("prints JSON for missing required Aquarius options", async () => {
    const output = await runCli([
      "--json",
      "defi",
      "aquarius",
      "swap",
      "preflight",
      "--from",
      "XLM",
      "--to",
      "AQUA",
      "--amount",
      "0.01"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "required option '--slippage-bps <bps>' not specified",
        docs: "docs/defi-aquarius.md#swap-quoting-and-preflight"
      }
    });
  });

  it("uses the Mainnet default policy for Mainnet Aquarius preflight", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              index: "pool-hash",
              address: "CPOOL",
              tokens_addresses: ["CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA", "CAQUA"],
              tokens_str: ["native", "AQUA:GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA"],
              pool_type: "constant_product",
              fee: "0.0030"
            }
          ]
        })
      )
    );

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "defi",
      "aquarius",
      "lp",
      "preflight",
      "--pool",
      "XLM",
      "--action",
      "deposit",
      "--account",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "--amount",
      "0.01",
      "--amount",
      "0.01",
      "--min-shares",
      "0.0000001",
      "--network",
      "mainnet"
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        policyDecision: {
          status: "denied",
          network: "mainnet",
          realFunds: true,
          matchedRules: expect.arrayContaining(["defi_aquarius_disabled", "defi_aquarius_mainnet_requires_approval"])
        },
        preflight: { network: "mainnet" }
      }
    });
  });
});

describe("CLI market liquidity commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("inspects core liquidity pools through Horizon", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(poolFixture())));

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "market",
      "pool",
      "inspect",
      "--pool",
      poolIdFixture()
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        id: poolIdFixture(),
        feeBp: 30,
        totalShares: "50.0000000",
        reserves: [
          { asset: "XLM", amount: "100.0000000" },
          { asset: expect.stringContaining("USD:G"), amount: "200.0000000" }
        ]
      }
    });
  });

  it("preflights liquidity deposits with policy context before submission", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.includes("/accounts/")) return new Response(JSON.stringify(accountFixture()));
      return new Response(JSON.stringify(poolFixture()));
    });

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "market",
      "lp",
      "preflight",
      "--pool",
      poolIdFixture(),
      "--max-a",
      "1",
      "--max-b",
      "2",
      "--min-price",
      "1.5",
      "--max-price",
      "2.5"
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        policyDecision: { status: "allowed" },
        preflight: {
          action: "deposit",
          pool: { id: poolIdFixture() },
          deposit: {
            maxAmountA: "1.0000000",
            maxAmountB: "2.0000000",
            estimatedShares: "0.5000000"
          },
          nominalExposure: {
            value: "3.0000000",
            semantics: "sum_of_max_reserve_amounts_not_mark_to_market"
          },
          trustlines: {
            reserveAssetsSatisfied: true,
            poolShareSatisfied: true
          }
        }
      }
    });
  });

  it("exposes fee strategy for liquidity pool trustline creation", async () => {
    const program = buildProgram();
    const market = program.commands.find((command) => command.name() === "market");
    const lp = market?.commands.find((command) => command.name() === "lp");
    const trustline = lp?.commands.find((command) => command.name() === "trustline");
    const add = trustline?.commands.find((command) => command.name() === "add");

    expect(add?.helpInformation()).toContain("--fee-strategy <strategy>");
  });

  it("evaluates price listeners as finite JSON events", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(poolFixture())));

    const output = await runCli([
      "--config",
      configPath,
      "--json",
      "market",
      "listen",
      "price",
      "--pool",
      poolIdFixture(),
      "--above",
      "1.5"
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        triggered: true,
        events: [
          {
            type: "market.alert",
            status: "triggered",
            observed: "2.0000000"
          }
        ]
      }
    });
  });

  it("rejects invalid market listener thresholds and reversed LP price bounds", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" });

    const listener = await runCli([
      "--config",
      configPath,
      "--json",
      "market",
      "listen",
      "price",
      "--pool",
      poolIdFixture(),
      "--above",
      "not-a-price"
    ]);
    expect(listener).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "above must be a decimal number."
      }
    });

    const preflight = await runCli([
      "--config",
      configPath,
      "--json",
      "market",
      "lp",
      "preflight",
      "--pool",
      poolIdFixture(),
      "--max-a",
      "1",
      "--max-b",
      "2",
      "--min-price",
      "3",
      "--max-price",
      "2"
    ]);
    expect(preflight).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Liquidity deposit --min-price must be less than or equal to --max-price."
      }
    });
  });

  it("blocks local Mainnet liquidity mutation", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" }, { mainnetEnabled: true });

    const output = await runCli([
      "--config",
      configPath,
      "--profile",
      "mainnet",
      "--json",
      "market",
      "lp",
      "deposit",
      "--pool",
      poolIdFixture(),
      "--max-a",
      "1",
      "--max-b",
      "1",
      "--min-price",
      "0.9",
      "--max-price",
      "1.1"
    ]);

    expect(output).toMatchObject({
      ok: false,
      error: {
        code: "MAINNET_NOT_ENABLED",
        message: "Mainnet liquidity pool mutation requires an external signer and is not available through local auto-signing."
      }
    });
  });

  it("explains strategy files without signing or submitting", async () => {
    const { configPath } = await createCliFixture({ stdout: "", stderr: "" });
    const strategyPath = join(tmpdir(), `stellar-agent-strategy-${Date.now()}.json`);
    await writeFile(
      strategyPath,
      JSON.stringify({
        kind: "liquidity",
        actions: [{ type: "deposit", pool: poolIdFixture(), maxA: "1", maxB: "2" }]
      })
    );

    const output = await runCli(["--config", configPath, "--json", "strategy", "simulate", strategyPath]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        status: "explained",
        submitted: false,
        signing: false,
        simulation: { submitted: false, signing: false, mode: "dry_run" }
      }
    });
  });

  it("keeps Soroban pool mutation behind an adapter-required boundary", async () => {
    const output = await runCli([
      "--json",
      "market",
      "soroban",
      "pool",
      "preflight",
      "--id",
      contractId,
      "--action",
      "deposit"
    ]);

    expect(output).toMatchObject({
      ok: true,
      data: {
        contractId,
        status: "adapter_required",
        mutationSupported: false
      }
    });
  });
});

async function createCliFixture(
  args: { stdout: string; stderr: string },
  options: { mainnetEnabled?: boolean; localProfile?: boolean; testnetPolicy?: boolean } = {}
) {
  const root = await mkdtemp(join(tmpdir(), "stellar-agent-cli-test-"));
  const config = createDefaultConfig(root);
  if (options.mainnetEnabled && config.profiles.mainnet) config.profiles.mainnet.enabled = true;
  if (options.localProfile) {
    config.profiles.local = {
      name: "local",
      network: "local",
      networkPassphrase: "Standalone Network ; February 2017",
      horizonUrl: null,
      rpcUrl: null,
      friendbotUrl: null,
      defaultAsset: "XLM",
      realFunds: false
    };
  }
  const configPath = join(root, "config.yaml");
  await mkdir(config.storage.walletsDir, { recursive: true });
  if (options.testnetPolicy) {
    await mkdir(config.storage.policiesDir, { recursive: true });
    await writeFile(join(config.storage.policiesDir, "default-testnet.yaml"), policyToYaml(DEFAULT_TESTNET_POLICY), { mode: 0o600 });
  }
  await ensureWallet(config, "agent");
  await writeFile(configPath, stringify(config), { mode: 0o600 });

  const stellarBinary = join(root, "stellar");
  await writeFile(
    stellarBinary,
    `#!/bin/sh\nprintf '%s' '${escapeSingleQuotedShell(args.stderr)}' >&2\nprintf '%s' '${escapeSingleQuotedShell(args.stdout)}'\n`,
    { mode: 0o755 }
  );

  return { configPath, stellarBinary, config };
}

async function runCli(args: string[]) {
  return JSON.parse(await runCliText(args));
}

async function runCliText(args: string[]) {
  let stdout = "";
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    const program = buildProgram();
    program.exitOverride();
    try {
      await program.parseAsync(args, { from: "user" });
    } catch (error) {
      if (!isCommanderVersionExit(error)) throw error;
    }
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
  return stdout;
}

function isCommanderVersionExit(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "exitCode" in error &&
    error.code === "commander.version" &&
    error.exitCode === 0
  );
}

function escapeSingleQuotedShell(value: string): string {
  return value.replaceAll("'", "'\\''");
}

function signedPaymentXdrFixture(): string {
  return signedPaymentXdrPair("1").signedXdr;
}

function signedPaymentXdrPair(amount: string): { signerPublicKey: string; unsignedXdr: string; signedXdr: string } {
  const signer = Keypair.random();
  const destination = Keypair.random().publicKey();
  const account = new Account(signer.publicKey(), "1");
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.PUBLIC
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount
      })
    )
    .setTimeout(60)
    .build();
  const unsignedXdr = transaction.toXDR();
  transaction.sign(signer);
  return { signerPublicKey: signer.publicKey(), unsignedXdr, signedXdr: transaction.toXDR() };
}

function signedTestnetPaymentXdrPair(amount: string): { signerPublicKey: string; unsignedXdr: string; signedXdr: string } {
  const signer = Keypair.random();
  const destination = Keypair.random().publicKey();
  const account = new Account(signer.publicKey(), "1");
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount
      })
    )
    .setTimeout(60)
    .build();
  const unsignedXdr = transaction.toXDR();
  transaction.sign(signer);
  return { signerPublicKey: signer.publicKey(), unsignedXdr, signedXdr: transaction.toXDR() };
}

function poolIdFixture(): string {
  return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
}

function poolFixture() {
  return {
    id: poolIdFixture(),
    paging_token: poolIdFixture(),
    fee_bp: 30,
    type: "constant_product",
    total_trustlines: "3",
    total_shares: "50.0000000",
    reserves: [
      { asset: "native", amount: "100.0000000" },
      { asset: "USD:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", amount: "200.0000000" }
    ],
    _links: {
      self: { href: `https://horizon-testnet.stellar.org/liquidity_pools/${poolIdFixture()}` }
    }
  };
}

async function enableArmedAutosignWallet(
  configPath: string,
  publicKey: string,
  destination: string,
  options: { perTxLimit?: string; dailyLimit?: string; monthlyLimit?: string } = {}
) {
  const args = [
    "--config",
    configPath,
    "--json",
    "mainnet",
    "agent-wallet",
    "enable",
    "--address",
    publicKey,
    "--max-balance",
    "125",
    "--daily-limit",
    options.dailyLimit ?? "5",
    "--per-tx-limit",
    options.perTxLimit ?? "1",
    "--allow-destination",
    destination,
    "--enable-autosign",
    "--secret-key-env",
    "STELLAR_AGENT_TEST_SECRET",
    "--i-understand-agent-wallet-autosign",
    "--arm",
    "--i-understand-real-funds"
  ];
  if (options.monthlyLimit) args.splice(args.indexOf("--allow-destination"), 0, "--monthly-limit", options.monthlyLimit);
  const output = await runCli(args);
  expect(output).toMatchObject({ ok: true, data: { armed: true, status: "armed" } });
  return output;
}

async function writeMainnetPaymentReceipt(
  config: ReturnType<typeof createDefaultConfig>,
  source: string,
  destination: string,
  amount: string
) {
  await writeReceipt(config.storage.receiptsDir, {
    command: "pay send",
    profile: "mainnet",
    networkPassphrase: config.profiles.mainnet.networkPassphrase,
    realFunds: true,
    payment: {
      source,
      destination,
      asset: "XLM",
      amount
    },
    policyDecision: { status: "requires_approval", matchedRules: ["test"] },
    transaction: { hash: "b".repeat(64), successful: true }
  });
}

async function writeMainnetAgentWalletAutosignPolicy(config: ReturnType<typeof createDefaultConfig>) {
  await mkdir(config.storage.policiesDir, { recursive: true });
  await writeFile(
    join(config.storage.policiesDir, "default-mainnet.yaml"),
    policyToYaml({
      ...DEFAULT_MAINNET_POLICY,
      limits: {
        perTransaction: "1 XLM",
        dailyTotal: "5 XLM",
        monthlyTotal: "25 XLM"
      },
      approval: {
        requireForAllPayments: false,
        requireForNewRecipient: false,
        requireForNewDomain: false,
        requireAbove: "1 XLM",
        allowMainnetAgentWalletAutosign: true
      }
    }),
    { mode: 0o600 }
  );
}

function accountFixture(address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF") {
  return {
    id: address,
    account_id: address,
    sequence: "1",
    balances: [
      { asset_type: "native", balance: "100.0000000" },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USD",
        asset_issuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        balance: "100.0000000",
        limit: "1000.0000000"
      },
      {
        asset_type: "liquidity_pool_shares",
        liquidity_pool_id: poolIdFixture(),
        balance: "5.0000000",
        limit: "1000.0000000"
      }
    ]
  };
}

import { createDefaultConfig } from "@stellar-agent/core";
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
const { Account, Asset, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } = require("../../stellar/node_modules/@stellar/stellar-sdk");

describe("CLI package entrypoint", () => {
  it("treats npm .bin symlinks as executable entrypoints", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-cli-entrypoint-"));
    const sourcePath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    const symlinkPath = join(root, "stellar-agent");
    await symlink(sourcePath, symlinkPath);

    expect(isCliEntrypoint(symlinkPath, pathToFileURL(sourcePath).href)).toBe(true);
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
});

async function createCliFixture(args: { stdout: string; stderr: string }, options: { mainnetEnabled?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "stellar-agent-cli-test-"));
  const config = createDefaultConfig(root);
  if (options.mainnetEnabled && config.profiles.mainnet) config.profiles.mainnet.enabled = true;
  const configPath = join(root, "config.yaml");
  await mkdir(config.storage.walletsDir, { recursive: true });
  await ensureWallet(config, "agent");
  await writeFile(configPath, stringify(config), { mode: 0o600 });

  const stellarBinary = join(root, "stellar");
  await writeFile(
    stellarBinary,
    `#!/bin/sh\nprintf '%s' '${escapeSingleQuotedShell(args.stderr)}' >&2\nprintf '%s' '${escapeSingleQuotedShell(args.stdout)}'\n`,
    { mode: 0o755 }
  );

  return { configPath, stellarBinary };
}

async function runCli(args: string[]) {
  let stdout = "";
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    const program = buildProgram();
    await program.parseAsync(args, { from: "user" });
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
  return JSON.parse(stdout);
}

function escapeSingleQuotedShell(value: string): string {
  return value.replaceAll("'", "'\\''");
}

function signedPaymentXdrFixture(): string {
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
        amount: "1"
      })
    )
    .setTimeout(60)
    .build();
  transaction.sign(signer);
  return transaction.toXDR();
}

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "@stellar-agent/core";
import {
  createTestnetHarness,
  ensureWallet,
  importPublicWallet,
  listWalletPublicViews,
  loadWalletPublic,
  trustlinesFromBalances
} from "../src/index.js";

const publicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("wallet storage", () => {
  it("imports and loads watch-only public wallets", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "stellar-agent-wallets-"));
    const config = createDefaultConfig(rootDir);
    await importPublicWallet({
      config,
      name: "treasury",
      publicKey,
      network: "mainnet"
    });

    await expect(loadWalletPublic(config, "treasury")).resolves.toMatchObject({
      name: "treasury",
      network: "mainnet",
      publicKey,
      hasSecret: false
    });
  });

  it("lists signing and watch-only wallet public views without secrets", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "stellar-agent-wallets-"));
    const config = createDefaultConfig(rootDir);
    await ensureWallet(config, "agent");
    await importPublicWallet({
      config,
      name: "treasury",
      publicKey,
      network: "mainnet"
    });

    const views = await listWalletPublicViews(config);
    expect(views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "agent", hasSecret: true }),
        expect.objectContaining({ name: "treasury", hasSecret: false })
      ])
    );
    expect(JSON.stringify(views)).not.toContain("secretKey");
  });

  it("filters native XLM out of trustline views", () => {
    expect(
      trustlinesFromBalances([
        { asset: "XLM", balance: "10000.0000000" },
        { asset: "USD:GISSUER", balance: "1.0000000" }
      ])
    ).toEqual([{ asset: "USD:GISSUER", balance: "1.0000000" }]);
  });

  it("plans an issued-asset scenario without network submission in dry-run mode", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "stellar-agent-issued-asset-"));
    const config = createDefaultConfig(rootDir);
    const result = await createTestnetHarness(config).runIssuedAssetPaymentScenario({
      issuer: "issuer",
      recipient: "merchant",
      assetCode: "USD",
      amount: "0.0000001",
      dryRun: true
    });

    expect(result).toMatchObject({
      amount: "0.0000001",
      dryRun: true,
      policyDecision: { status: "allowed" }
    });
    expect(result.asset).toMatch(/^USD:G[A-Z2-7]{55}$/);
    expect(result.trustline).toBeUndefined();
    expect(result.payment).toBeUndefined();
  });

  it("runs a contract asset smoke scenario through a fake Stellar CLI without leaking secrets", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "stellar-agent-contract-smoke-"));
    const config = createDefaultConfig(rootDir);
    const stellarBinary = await fakeStellarBinary(rootDir);
    const result = await createTestnetHarness(config).runContractAssetSmokeScenario({
      source: "agent",
      asset: "native",
      ledgersToExtend: 123,
      stellarBinary,
      stellarConfigDir: join(rootDir, "stellar-cli"),
      noCache: true,
      fund: false
    });

    expect(result.deploy).toMatchObject({
      contractId,
      transactionHash,
      receiptPath: expect.any(String)
    });
    expect(result.assetId).toMatchObject({ contractId });
    expect(result.read?.stdout).toContain("LedgerKeyContractInstance");
    expect(result.info?.stdout).toContain("symbol");
    expect(result.invoke?.stdout.trim()).toBe("native");
    expect(result.extend).toMatchObject({
      transactionHash: extendTransactionHash,
      receiptPath: expect.any(String)
    });
    expect(JSON.stringify(result)).not.toMatch(/\bS[A-Z2-7]{55}\b/);
    expect(result.deploy?.command).toContain("[REDACTED_SECRET_KEY]");

    const deployReceipt = JSON.parse(await readFile(result.deploy!.receiptPath!, "utf8"));
    expect(deployReceipt).toMatchObject({
      command: "testnet scenario contract-asset-smoke",
      operation: {
        type: "contract.asset-deploy",
        source: "agent",
        asset: "native",
        details: { contractId }
      },
      transaction: { hash: transactionHash, successful: true }
    });
  });
});

const transactionHash = "a".repeat(64);
const extendTransactionHash = "b".repeat(64);
const contractId = "CB7Y2XA3ULT62HEH6DPAUGVGUTSVL7JO5T5VOYUW6UVZI6SG72UOKSYR";

async function fakeStellarBinary(rootDir: string): Promise<string> {
  const path = join(rootDir, "stellar");
  await writeFile(
    path,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'stellar 26.1.0\\n'
  exit 0
fi
args=" $* "
if printf '%s' "$args" | grep -q ' contract asset deploy '; then
  printf 'Signing transaction: ${transactionHash}\\n' >&2
  printf '${contractId}\\n'
  exit 0
fi
if printf '%s' "$args" | grep -q ' contract id asset '; then
  printf '${contractId}\\n'
  exit 0
fi
if printf '%s' "$args" | grep -q ' contract read '; then
  printf 'LedgerKeyContractInstance(${contractId})\\n'
  exit 0
fi
if printf '%s' "$args" | grep -q ' contract info interface '; then
  printf 'fn symbol() -> string\\n'
  exit 0
fi
if printf '%s' "$args" | grep -q ' contract invoke '; then
  printf 'native\\n'
  exit 0
fi
if printf '%s' "$args" | grep -q ' contract extend '; then
  printf 'Signing transaction: ${extendTransactionHash}\\n' >&2
  printf 'New ttl ledger: 123456\\n'
  exit 0
fi
printf 'unexpected fake stellar args: %s\\n' "$*" >&2
exit 1
`,
    { mode: 0o755 }
  );
  return path;
}

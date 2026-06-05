import { describe, expect, it } from "vitest";
import {
  MCP_TOOLS,
  buildCliArgs,
  callMcpTool,
  createMcpMessageParser,
  encodeMcpMessage,
  handleMcpRequest
} from "../src/index.js";

describe("mcp server", () => {
  it("lists concrete Stellar Agent tools", async () => {
    const response = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, async () => ({
      status: 0,
      stdout: "",
      stderr: ""
    }));
    expect(response?.result).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "stellar_pay_send" }),
        expect.objectContaining({ name: "stellar_pay_batch" }),
        expect.objectContaining({ name: "stellar_pay_x402" }),
        expect.objectContaining({ name: "stellar_pay_mpp" }),
        expect.objectContaining({ name: "stellar_pay_mpp_session" }),
        expect.objectContaining({ name: "stellar_testnet_fund" }),
        expect.objectContaining({ name: "stellar_testnet_scenario_issued_asset_payment" }),
        expect.objectContaining({ name: "stellar_testnet_scenario_contract_asset_smoke" }),
        expect.objectContaining({ name: "stellar_tx_build_payment" }),
        expect.objectContaining({ name: "stellar_tx_submit_approval" }),
        expect.objectContaining({ name: "stellar_wallet_trustline_list" }),
        expect.objectContaining({ name: "stellar_claimable_claim" }),
        expect.objectContaining({ name: "stellar_contract_invoke" }),
        expect.objectContaining({ name: "stellar_contract_asset_deploy" }),
        expect.objectContaining({ name: "stellar_contract_read" }),
        expect.objectContaining({ name: "stellar_contract_info" }),
        expect.objectContaining({ name: "stellar_contract_fetch" }),
        expect.objectContaining({ name: "stellar_contract_asset_id" })
      ])
    });
  });

  it("builds CLI arguments for signed-XDR approval submission", () => {
    expect(
      buildCliArgs("stellar_tx_submit_approval", {
        configPath: "/tmp/config.yaml",
        id: "appr_123"
      })
    ).toEqual(["--config", "/tmp/config.yaml", "--json", "tx", "submit-approval", "appr_123"]);
  });

  it("builds CLI arguments for fee-aware batch payments with cache disabled", () => {
    expect(
      buildCliArgs("stellar_pay_batch", {
        configPath: "/tmp/config.yaml",
        noCache: true,
        file: "/tmp/payments.json",
        from: "agent",
        feeStrategy: "p95",
        dryRun: true
      })
    ).toEqual([
      "--config",
      "/tmp/config.yaml",
      "--no-cache",
      "--json",
      "pay",
      "batch",
      "--file",
      "/tmp/payments.json",
      "--from",
      "agent",
      "--fee-strategy",
      "p95",
      "--dry-run"
    ]);
  });

  it("builds CLI arguments for guarded Mainnet signed-XDR submission", () => {
    expect(
      buildCliArgs("stellar_tx_submit_xdr", {
        profile: "mainnet",
        xdr: "AAAA...",
        allowRealFunds: true,
        iUnderstandRealFunds: true
      })
    ).toEqual([
      "--profile",
      "mainnet",
      "--json",
      "tx",
      "submit-xdr",
      "--xdr",
      "AAAA...",
      "--allow-real-funds",
      "--i-understand-real-funds"
    ]);
  });

  it("builds CLI arguments for funded Testnet wallet spin-up", () => {
    expect(
      buildCliArgs("stellar_wallet_create_testnet", {
        name: "issuer",
        fund: true
      })
    ).toEqual(["--json", "wallet", "create-testnet", "issuer", "--fund"]);

    expect(
      buildCliArgs("stellar_testnet_fund", {
        account: "issuer"
      })
    ).toEqual(["--json", "testnet", "fund", "--account", "issuer"]);

    expect(
      buildCliArgs("stellar_testnet_fund", {
        address: "GDEST"
      })
    ).toEqual(["--json", "testnet", "fund", "--address", "GDEST"]);
  });

  it("builds CLI arguments for the issued-asset scenario", () => {
    expect(
      buildCliArgs("stellar_testnet_scenario_issued_asset_payment", {
        issuer: "issuer",
        recipient: "merchant",
        assetCode: "USD",
        amount: "0.0000001",
        memo: "scenario",
        dryRun: true,
        fund: false
      })
    ).toEqual([
      "--json",
      "testnet",
      "scenario",
      "issued-asset-payment",
      "--issuer",
      "issuer",
      "--recipient",
      "merchant",
      "--amount",
      "0.0000001",
      "--memo",
      "scenario",
      "--asset-code",
      "USD",
      "--no-fund",
      "--dry-run"
    ]);
  });

  it("builds CLI arguments for the contract asset smoke scenario", () => {
    expect(
      buildCliArgs("stellar_testnet_scenario_contract_asset_smoke", {
        source: "agent",
        asset: "native",
        alias: "native-sac",
        ledgersToExtend: 123,
        stellarBinary: "stellar",
        stellarConfigDir: "/tmp/stellar-config",
        stellarNoCache: true,
        dryRun: true,
        fund: false
      })
    ).toEqual([
      "--json",
      "testnet",
      "scenario",
      "contract-asset-smoke",
      "--source",
      "agent",
      "--asset",
      "native",
      "--ledgers-to-extend",
      "123",
      "--alias",
      "native-sac",
      "--stellar-binary",
      "stellar",
      "--stellar-config-dir",
      "/tmp/stellar-config",
      "--stellar-no-cache",
      "--no-fund",
      "--dry-run"
    ]);
  });

  it("builds CLI arguments for payment signature requests", () => {
    expect(
      buildCliArgs("stellar_tx_request_payment_signature", {
        to: "GDEST",
        amount: "1",
        from: "treasury",
        memo: "review"
      })
    ).toEqual([
      "--json",
      "tx",
      "request-payment-signature",
      "--to",
      "GDEST",
      "--amount",
      "1",
      "--asset",
      "XLM",
      "--from",
      "treasury",
      "--memo",
      "review"
    ]);
  });

  it("builds CLI arguments for time-bound claimable balances", () => {
    expect(
      buildCliArgs("stellar_claimable_create", {
        to: "GCLAIMANT",
        amount: "1",
        from: "agent",
        claimants: ["GAUDITOR"],
        claimableAfter: "2030-01-01T00:00:00Z",
        claimableBefore: "2030-01-02T00:00:00Z"
      })
    ).toEqual([
      "--json",
      "claimable",
      "create",
      "--to",
      "GCLAIMANT",
      "--amount",
      "1",
      "--asset",
      "XLM",
      "--from",
      "agent",
      "--claimant",
      "GAUDITOR",
      "--claimable-after",
      "2030-01-01T00:00:00Z",
      "--claimable-before",
      "2030-01-02T00:00:00Z"
    ]);
  });

  it("builds CLI arguments for HTTP payment flows", () => {
    expect(
      buildCliArgs("stellar_pay_x402", {
        url: "http://127.0.0.1:3000/paid-report",
        from: "agent",
        allowLocalhostDemo: true,
        dryRun: true
      })
    ).toEqual([
      "--json",
      "pay",
      "x402",
      "http://127.0.0.1:3000/paid-report",
      "--from",
      "agent",
      "--allow-localhost-demo",
      "--dry-run"
    ]);

    expect(
      buildCliArgs("stellar_pay_mpp", {
        url: "http://127.0.0.1:3000/mpp-report",
        allowLocalhostDemo: true
      })
    ).toEqual(["--json", "pay", "mpp", "http://127.0.0.1:3000/mpp-report", "--from", "agent", "--allow-localhost-demo"]);

    expect(
      buildCliArgs("stellar_pay_mpp_session", {
        url: "http://127.0.0.1:3000/mpp-session",
        requests: 3,
        dryRun: true
      })
    ).toEqual(["--json", "pay", "mpp-session", "http://127.0.0.1:3000/mpp-session", "--from", "agent", "--requests", "3", "--dry-run"]);
  });

  it("builds CLI arguments with global config and repeated contract args", () => {
    expect(
      buildCliArgs("stellar_contract_invoke", {
        configPath: "/tmp/config.yaml",
        id: "C123",
        source: "agent",
        fn: "hello",
        arg: { to: "world" }
      })
    ).toEqual([
      "--config",
      "/tmp/config.yaml",
      "--json",
      "contract",
      "invoke",
      "--id",
      "C123",
      "--source",
      "agent",
      "--fn",
      "hello",
      "--arg",
      "to=world"
    ]);
  });

  it("builds CLI arguments for contract read and asset id", () => {
    expect(
      buildCliArgs("stellar_contract_read", {
        id: "C123",
        output: "json"
      })
    ).toEqual(["--json", "contract", "read", "--id", "C123", "--output", "json"]);

    expect(
      buildCliArgs("stellar_contract_asset_id", {
        asset: "native",
        network: "testnet",
        stellarConfigDir: "/tmp/stellar-config",
        stellarNoCache: true
      })
    ).toEqual([
      "--json",
      "contract",
      "asset-id",
      "--asset",
      "native",
      "--network",
      "testnet",
      "--stellar-config-dir",
      "/tmp/stellar-config",
      "--stellar-no-cache"
    ]);

    expect(
      buildCliArgs("stellar_contract_asset_deploy", {
        source: "agent",
        asset: "native",
        alias: "native-sac",
        stellarBinary: "stellar"
      })
    ).toEqual([
      "--json",
      "contract",
      "asset-deploy",
      "--source",
      "agent",
      "--asset",
      "native",
      "--alias",
      "native-sac",
      "--stellar-binary",
      "stellar"
    ]);

    expect(
      buildCliArgs("stellar_contract_info", {
        id: "C123",
        kind: "interface"
      })
    ).toEqual(["--json", "contract", "info", "--kind", "interface", "--id", "C123"]);

    expect(
      buildCliArgs("stellar_contract_fetch", {
        wasmHash: "0123456789abcdef",
        outFile: "/tmp/contract.wasm"
      })
    ).toEqual([
      "--json",
      "contract",
      "fetch",
      "--wasm-hash",
      "0123456789abcdef",
      "--out-file",
      "/tmp/contract.wasm"
    ]);
  });

  it("calls the CLI runner and returns parsed JSON output", async () => {
    const result = await callMcpTool(
      "stellar_pay_quote",
      { to: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", amount: "1" },
      async (args) => ({
        status: 0,
        stdout: JSON.stringify({ ok: true, args }),
        stderr: ""
      })
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      exitCode: 0,
      stdout: { ok: true }
    });
  });

  it("parses content-length framed MCP messages", () => {
    const messages: unknown[] = [];
    const parse = createMcpMessageParser((message) => messages.push(message));
    parse(encodeMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize" }));
    expect(messages).toEqual([{ jsonrpc: "2.0", id: 1, method: "initialize" }]);
  });

  it("keeps tool names unique", () => {
    expect(new Set(MCP_TOOLS.map((tool) => tool.name)).size).toBe(MCP_TOOLS.length);
  });
});

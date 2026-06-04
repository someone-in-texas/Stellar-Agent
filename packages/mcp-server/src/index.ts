import { redactSensitive } from "@stellar-agent/core";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  buildArgs(input: Record<string, unknown>): string[];
}

export interface CliExecutionResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type CliRunner = (args: string[]) => Promise<CliExecutionResult>;

export interface McpRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: any;
}

export interface McpResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

const commonProperties = {
  configPath: { type: "string", description: "Optional path to stellar-agent config.yaml." },
  profile: { type: "string", enum: ["testnet", "mainnet", "local"], description: "Network profile name." },
  policyPath: { type: "string", description: "Optional path to a policy YAML file." }
};

export const MCP_TOOLS: McpTool[] = [
  tool("stellar_testnet_doctor", "Run Testnet readiness checks.", {}, (input) => [
    "testnet",
    "doctor",
    ...(bool(input, "live") ? ["--live"] : [])
  ], { live: { type: "boolean" } }),
  tool("stellar_testnet_init", "Initialize local Testnet wallets, config, policy, logs, and receipts.", {}, (input) => [
    "testnet",
    "init",
    ...(bool(input, "fund") === false ? ["--no-fund"] : []),
    ...(bool(input, "overwritePolicy") ? ["--overwrite-policy"] : [])
  ], { fund: { type: "boolean" }, overwritePolicy: { type: "boolean" } }),
  tool("stellar_testnet_fund", "Fund a Testnet account or local wallet with Friendbot.", {}, (input) => [
    "testnet",
    "fund",
    ...(string(input, "address") ? ["--address", requiredString(input, "address")] : ["--account", string(input, "account") ?? "agent"])
  ], { account: { type: "string" }, address: { type: "string" } }),
  tool("stellar_testnet_scenario_issued_asset_payment", "Run the issued-asset trustline and payment Testnet scenario.", {}, (input) => [
    "testnet",
    "scenario",
    "issued-asset-payment",
    "--issuer",
    string(input, "issuer") ?? "issuer",
    "--recipient",
    string(input, "recipient") ?? "merchant",
    "--amount",
    string(input, "amount") ?? "0.0000001",
    "--memo",
    string(input, "memo") ?? "issued-asset scenario",
    ...option(input, "assetCode", "--asset-code"),
    ...(bool(input, "fund") === false ? ["--no-fund"] : []),
    ...(bool(input, "dryRun") ? ["--dry-run"] : [])
  ], {
    issuer: { type: "string" },
    recipient: { type: "string" },
    assetCode: { type: "string" },
    amount: { type: "string" },
    memo: { type: "string" },
    fund: { type: "boolean" },
    dryRun: { type: "boolean" }
  }),
  tool("stellar_testnet_scenario_contract_asset_smoke", "Run the Stellar CLI-backed asset contract Testnet smoke scenario.", {}, (input) => [
    "testnet",
    "scenario",
    "contract-asset-smoke",
    "--source",
    string(input, "source") ?? "agent",
    "--asset",
    string(input, "asset") ?? "native",
    "--ledgers-to-extend",
    String(number(input, "ledgersToExtend") ?? 535679),
    ...option(input, "alias", "--alias"),
    ...option(input, "stellarBinary", "--stellar-binary"),
    ...option(input, "stellarConfigDir", "--stellar-config-dir"),
    ...(bool(input, "stellarNoCache") ? ["--stellar-no-cache"] : []),
    ...(bool(input, "fund") === false ? ["--no-fund"] : []),
    ...(bool(input, "dryRun") ? ["--dry-run"] : [])
  ], {
    source: { type: "string" },
    asset: { type: "string" },
    alias: { type: "string" },
    ledgersToExtend: { type: "number" },
    stellarBinary: { type: "string" },
    stellarConfigDir: { type: "string" },
    stellarNoCache: { type: "boolean" },
    fund: { type: "boolean" },
    dryRun: { type: "boolean" }
  }),
  tool("stellar_wallet_create_testnet", "Create or load a named local Testnet wallet.", {}, (input) => [
    "wallet",
    "create-testnet",
    string(input, "name") ?? "agent",
    ...(bool(input, "fund") ? ["--fund"] : [])
  ], { name: { type: "string" }, fund: { type: "boolean" } }),
  tool("stellar_wallet_balance", "Read balances for a local wallet.", {}, (input) => [
    "wallet",
    "balance",
    "--account",
    string(input, "account") ?? "agent"
  ], { account: { type: "string" } }),
  tool("stellar_wallet_trustline_list", "List issued-asset trustlines for a local wallet.", {}, (input) => [
    "wallet",
    "trustline",
    "list",
    "--account",
    string(input, "account") ?? "merchant"
  ], { account: { type: "string" } }),
  tool("stellar_wallet_trustline_add", "Add or update an issued-asset trustline.", { asset: true }, (input) => [
    "wallet",
    "trustline",
    "add",
    "--asset",
    requiredString(input, "asset"),
    "--account",
    string(input, "account") ?? "merchant",
    ...(string(input, "limit") ? ["--limit", requiredString(input, "limit")] : [])
  ], { asset: { type: "string" }, account: { type: "string" }, limit: { type: "string" } }),
  tool("stellar_wallet_trustline_remove", "Remove an issued-asset trustline by setting its limit to zero.", { asset: true }, (input) => [
    "wallet",
    "trustline",
    "remove",
    "--asset",
    requiredString(input, "asset"),
    "--account",
    string(input, "account") ?? "merchant"
  ], { asset: { type: "string" }, account: { type: "string" } }),
  tool("stellar_approval_create_payment", "Create a local payment approval request.", { to: true, amount: true }, (input) => [
    "approval",
    "create-payment",
    "--to",
    requiredString(input, "to"),
    "--amount",
    requiredString(input, "amount"),
    "--asset",
    string(input, "asset") ?? "XLM",
    "--from",
    string(input, "from") ?? "agent",
    ...option(input, "memo", "--memo")
  ], { ...paymentProperties(), from: { type: "string" } }),
  tool("stellar_approval_create_transaction", "Create a local transaction-XDR approval request for browser-wallet signing.", { xdr: true }, (input) => [
    "approval",
    "create-transaction",
    "--xdr",
    requiredString(input, "xdr"),
    "--summary",
    string(input, "summary") ?? "Approve transaction XDR",
    ...option(input, "network", "--network")
  ], { xdr: { type: "string" }, summary: { type: "string" }, network: { type: "string", enum: ["testnet", "mainnet", "local"] } }),
  tool("stellar_approval_list", "List local approval requests.", {}, () => ["approval", "list"], {}),
  tool("stellar_approval_decide", "Approve or deny a local approval request.", { id: true, decision: true }, (input) => [
    "approval",
    "decide",
    requiredString(input, "id"),
    approvalDecisionFlag(input),
    ...option(input, "reason", "--reason")
  ], {
    id: { type: "string" },
    decision: { type: "string", enum: ["approve", "deny"] },
    reason: { type: "string" }
  }),
  tool("stellar_approval_record_signed_transaction", "Record signed transaction XDR on an approval request.", { id: true, signerPublicKey: true, signedTransactionXdr: true }, (input) => [
    "approval",
    "decide",
    requiredString(input, "id"),
    "--signer-public-key",
    requiredString(input, "signerPublicKey"),
    "--signed-transaction-xdr",
    requiredString(input, "signedTransactionXdr"),
    ...option(input, "reason", "--reason")
  ], {
    id: { type: "string" },
    signerPublicKey: { type: "string" },
    signedTransactionXdr: { type: "string" },
    reason: { type: "string" }
  }),
  tool("stellar_tx_submit_xdr", "Submit signed transaction XDR to Horizon on Testnet or guarded Mainnet.", { xdr: true }, (input) => [
    "tx",
    "submit-xdr",
    "--xdr",
    requiredString(input, "xdr"),
    ...realFundsFlags(input)
  ], { xdr: { type: "string" }, ...realFundsProperties() }),
  tool("stellar_tx_build_payment", "Build unsigned payment transaction XDR for browser-wallet signing on Testnet or guarded Mainnet.", { to: true, amount: true }, (input) => [
    "tx",
    "build-payment",
    "--to",
    requiredString(input, "to"),
    "--amount",
    requiredString(input, "amount"),
    "--asset",
    string(input, "asset") ?? "XLM",
    "--from",
    string(input, "from") ?? "agent",
    ...option(input, "memo", "--memo"),
    ...realFundsFlags(input)
  ], { ...paymentProperties(), from: { type: "string" }, ...realFundsProperties() }),
  tool("stellar_tx_request_payment_signature", "Build payment XDR and create a transaction approval request.", { to: true, amount: true }, (input) => [
    "tx",
    "request-payment-signature",
    "--to",
    requiredString(input, "to"),
    "--amount",
    requiredString(input, "amount"),
    "--asset",
    string(input, "asset") ?? "XLM",
    "--from",
    string(input, "from") ?? "agent",
    ...option(input, "memo", "--memo"),
    ...option(input, "summary", "--summary"),
    ...realFundsFlags(input)
  ], { ...paymentProperties(), from: { type: "string" }, summary: { type: "string" }, ...realFundsProperties() }),
  tool("stellar_tx_submit_approval", "Submit signed transaction XDR from a local approval request on Testnet or guarded Mainnet.", { id: true }, (input) => [
    "tx",
    "submit-approval",
    requiredString(input, "id"),
    ...realFundsFlags(input)
  ], { id: { type: "string" }, ...realFundsProperties() }),
  tool("stellar_pay_quote", "Quote and policy-check a payment without submitting it.", { to: true, amount: true }, (input) => [
    "pay",
    "quote",
    "--to",
    requiredString(input, "to"),
    "--amount",
    requiredString(input, "amount"),
    "--asset",
    string(input, "asset") ?? "XLM",
    ...option(input, "memo", "--memo")
  ], paymentProperties()),
  tool("stellar_pay_send", "Submit a Testnet payment after policy allows it.", { to: true, amount: true }, (input) => [
    "pay",
    "send",
    "--to",
    requiredString(input, "to"),
    "--amount",
    requiredString(input, "amount"),
    "--asset",
    string(input, "asset") ?? "XLM",
    "--from",
    string(input, "from") ?? "agent",
    ...option(input, "approvalId", "--approval-id"),
    ...option(input, "memo", "--memo"),
    ...(bool(input, "dryRun") ? ["--dry-run"] : [])
  ], { ...paymentProperties(), from: { type: "string" }, approvalId: { type: "string" }, dryRun: { type: "boolean" } }),
  tool("stellar_pay_x402", "Pay a local x402-style HTTP 402 resource on Testnet.", { url: true }, (input) => [
    "pay",
    "x402",
    requiredString(input, "url"),
    "--from",
    string(input, "from") ?? "agent",
    ...(bool(input, "allowLocalhostDemo") ? ["--allow-localhost-demo"] : []),
    ...(bool(input, "dryRun") ? ["--dry-run"] : [])
  ], httpPaymentProperties()),
  tool("stellar_pay_mpp", "Pay a local MPP one-time charge resource on Testnet.", { url: true }, (input) => [
    "pay",
    "mpp",
    requiredString(input, "url"),
    "--from",
    string(input, "from") ?? "agent",
    ...(bool(input, "allowLocalhostDemo") ? ["--allow-localhost-demo"] : []),
    ...(bool(input, "dryRun") ? ["--dry-run"] : [])
  ], httpPaymentProperties()),
  tool("stellar_pay_mpp_session", "Pay and use a local MPP session-budget resource on Testnet.", { url: true }, (input) => [
    "pay",
    "mpp-session",
    requiredString(input, "url"),
    "--from",
    string(input, "from") ?? "agent",
    "--requests",
    String(number(input, "requests") ?? 2),
    ...(bool(input, "allowLocalhostDemo") ? ["--allow-localhost-demo"] : []),
    ...(bool(input, "dryRun") ? ["--dry-run"] : [])
  ], {
    url: { type: "string" },
    from: { type: "string" },
    requests: { type: "number" },
    allowLocalhostDemo: { type: "boolean" },
    dryRun: { type: "boolean" }
  }),
  tool("stellar_claimable_create", "Create a Testnet claimable balance.", { to: true, amount: true }, (input) => [
    "claimable",
    "create",
    "--to",
    requiredString(input, "to"),
    "--amount",
    requiredString(input, "amount"),
    "--asset",
    string(input, "asset") ?? "XLM",
    "--from",
    string(input, "from") ?? "agent",
    ...stringArray(input, "claimants").flatMap((claimant) => ["--claimant", claimant]),
    ...option(input, "claimableAfter", "--claimable-after"),
    ...option(input, "claimableBefore", "--claimable-before")
  ], {
    to: { type: "string" },
    amount: { type: "string" },
    asset: { type: "string" },
    from: { type: "string" },
    claimants: { type: "array", items: { type: "string" } },
    claimableAfter: { type: "string" },
    claimableBefore: { type: "string" }
  }),
  tool("stellar_claimable_list", "List claimable balances for an account or address.", {}, (input) => [
    "claimable",
    "list",
    ...(string(input, "address") ? ["--address", requiredString(input, "address")] : ["--account", string(input, "account") ?? "merchant"])
  ], { account: { type: "string" }, address: { type: "string" } }),
  tool("stellar_claimable_claim", "Claim a claimable balance by id.", { balanceId: true }, (input) => [
    "claimable",
    "claim",
    "--balance-id",
    requiredString(input, "balanceId"),
    "--account",
    string(input, "account") ?? "merchant"
  ], { balanceId: { type: "string" }, account: { type: "string" } }),
  tool("stellar_contract_doctor", "Check whether the Stellar CLI is available.", {}, (input) => [
    "contract",
    "doctor",
    ...option(input, "stellarBinary", "--stellar-binary")
  ], { stellarBinary: { type: "string" } }),
  tool("stellar_contract_invoke", "Invoke a deployed Soroban contract through Stellar CLI.", { id: true, source: true, fn: true }, (input) => [
    "contract",
    "invoke",
    "--id",
    requiredString(input, "id"),
    "--source",
    requiredString(input, "source"),
    "--fn",
    requiredString(input, "fn"),
    ...contractArgs(input),
    ...networkAndStellarBinary(input)
  ], contractProperties({ id: true, source: true, fn: true, arg: true })),
  tool("stellar_contract_upload", "Upload contract Wasm bytecode through Stellar CLI.", { source: true, wasm: true }, (input) => [
    "contract",
    "upload",
    "--source",
    requiredString(input, "source"),
    "--wasm",
    requiredString(input, "wasm"),
    ...networkAndStellarBinary(input)
  ], contractProperties({ source: true, wasm: true })),
  tool("stellar_contract_deploy", "Deploy a Wasm contract through Stellar CLI.", { source: true }, (input) => [
    "contract",
    "deploy",
    "--source",
    requiredString(input, "source"),
    ...option(input, "wasm", "--wasm"),
    ...option(input, "wasmHash", "--wasm-hash"),
    ...option(input, "alias", "--alias"),
    ...contractArgs(input),
    ...networkAndStellarBinary(input)
  ], contractProperties({ source: true, wasm: true, wasmHash: true, alias: true, arg: true })),
  tool("stellar_contract_asset_deploy", "Deploy a Stellar Asset Contract through Stellar CLI.", { source: true, asset: true }, (input) => [
    "contract",
    "asset-deploy",
    "--source",
    requiredString(input, "source"),
    "--asset",
    requiredString(input, "asset"),
    ...option(input, "alias", "--alias"),
    ...networkAndStellarBinary(input)
  ], contractProperties({ source: true, asset: true, alias: true })),
  tool("stellar_contract_asset_id", "Calculate a Stellar Asset Contract id through Stellar CLI.", { asset: true }, (input) => [
    "contract",
    "asset-id",
    "--asset",
    requiredString(input, "asset"),
    ...networkAndStellarBinary(input)
  ], contractProperties({ asset: true })),
  tool("stellar_contract_info", "Read contract interface, metadata, build info, env metadata, or hash through Stellar CLI.", {}, (input) => [
    "contract",
    "info",
    "--kind",
    string(input, "kind") ?? "interface",
    ...option(input, "id", "--id"),
    ...option(input, "wasm", "--wasm"),
    ...option(input, "wasmHash", "--wasm-hash"),
    ...networkAndStellarBinary(input)
  ], contractProperties({ id: true, wasm: true, wasmHash: true, kind: true })),
  tool("stellar_contract_read", "Read contract instance, storage, or Wasm ledger data through Stellar CLI.", {}, (input) => [
    "contract",
    "read",
    ...footprintArgs(input),
    ...option(input, "output", "--output"),
    ...networkAndStellarBinary(input)
  ], contractProperties({ footprint: true, output: true })),
  tool("stellar_contract_fetch", "Fetch contract Wasm bytecode through Stellar CLI.", {}, (input) => [
    "contract",
    "fetch",
    ...option(input, "id", "--id"),
    ...option(input, "wasmHash", "--wasm-hash"),
    ...option(input, "outFile", "--out-file"),
    ...networkAndStellarBinary(input)
  ], contractProperties({ id: true, wasmHash: true, outFile: true })),
  tool("stellar_contract_extend", "Extend contract instance, storage, or Wasm TTL through Stellar CLI.", { source: true, ledgersToExtend: true }, (input) => [
    "contract",
    "extend",
    "--source",
    requiredString(input, "source"),
    "--ledgers-to-extend",
    String(requiredNumber(input, "ledgersToExtend")),
    ...footprintArgs(input),
    ...(bool(input, "ttlLedgerOnly") ? ["--ttl-ledger-only"] : []),
    ...networkAndStellarBinary(input)
  ], contractProperties({ source: true, ledgersToExtend: true, footprint: true, ttlLedgerOnly: true })),
  tool("stellar_contract_restore", "Restore archived contract instance, storage, or Wasm through Stellar CLI.", { source: true }, (input) => [
    "contract",
    "restore",
    "--source",
    requiredString(input, "source"),
    ...footprintArgs(input),
    ...networkAndStellarBinary(input)
  ], contractProperties({ source: true, footprint: true }))
];

export function buildCliArgs(toolName: string, input: Record<string, unknown> = {}): string[] {
  const found = MCP_TOOLS.find((candidate) => candidate.name === toolName);
  if (!found) throw new Error(`Unknown MCP tool '${toolName}'.`);
  return [
    ...option(input, "configPath", "--config"),
    ...option(input, "profile", "--profile"),
    ...option(input, "policyPath", "--policy"),
    "--json",
    ...found.buildArgs(input)
  ];
}

export async function callMcpTool(
  name: string,
  input: Record<string, unknown>,
  runner: CliRunner
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const args = buildCliArgs(name, input);
  const result = await runner(args);
  const payload = {
    command: ["stellar-agent", ...redactSensitive(args)],
    exitCode: result.status,
    stdout: parseJsonOrText(result.stdout),
    stderr: result.stderr.trim()
  };
  return {
    content: [{ type: "text", text: JSON.stringify(redactSensitive(payload), null, 2) }],
    ...(result.status === 0 ? {} : { isError: true })
  };
}

export async function handleMcpRequest(request: McpRequest, runner: CliRunner): Promise<McpResponse | undefined> {
  if (request.id === undefined && request.method.startsWith("notifications/")) return undefined;
  if (request.method === "initialize") {
    return response(request, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "stellar-agent-mcp", version: "0.0.0" }
    });
  }
  if (request.method === "tools/list") {
    return response(request, {
      tools: MCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
    });
  }
  if (request.method === "tools/call") {
    const params = request.params ?? {};
    try {
      return response(request, await callMcpTool(params.name, params.arguments ?? {}, runner));
    } catch (error) {
      return mcpError(request, -32602, error instanceof Error ? error.message : "Invalid tool call.");
    }
  }
  return mcpError(request, -32601, `Method '${request.method}' is not supported.`);
}

export function createChildProcessCliRunner(cliBinary = process.env.STELLAR_AGENT_CLI ?? "stellar-agent"): CliRunner {
  return async (args) =>
    new Promise((resolve) => {
      const executable = cliBinary.endsWith(".js") ? process.execPath : cliBinary;
      const childArgs = cliBinary.endsWith(".js") ? [cliBinary, ...args] : args;
      const child = spawn(executable, childArgs, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        resolve({ status: 127, stdout, stderr: `${stderr}${error.message}` });
      });
      child.on("close", (status) => {
        resolve({ status: status ?? 1, stdout, stderr });
      });
    });
}

export function encodeMcpMessage(message: unknown): string {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
}

export function createMcpMessageParser(onMessage: (message: McpRequest) => void): (chunk: Buffer | string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString();
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.slice(0, headerEnd);
      const lengthMatch = /content-length:\s*(\d+)/i.exec(header);
      if (!lengthMatch?.[1]) throw new Error("Missing MCP Content-Length header.");
      const length = Number.parseInt(lengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) return;
      onMessage(JSON.parse(buffer.slice(bodyStart, bodyEnd)));
      buffer = buffer.slice(bodyEnd);
    }
  };
}

function tool(
  name: string,
  description: string,
  required: Record<string, true>,
  buildArgs: (input: Record<string, unknown>) => string[],
  properties: Record<string, unknown>
): McpTool {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { ...commonProperties, ...properties },
      required: Object.keys(required),
      additionalProperties: false
    },
    buildArgs
  };
}

function paymentProperties(): Record<string, unknown> {
  return { to: { type: "string" }, amount: { type: "string" }, asset: { type: "string" }, memo: { type: "string" } };
}

function httpPaymentProperties(): Record<string, unknown> {
  return {
    url: { type: "string" },
    from: { type: "string" },
    allowLocalhostDemo: { type: "boolean" },
    dryRun: { type: "boolean" }
  };
}

function realFundsProperties(): Record<string, unknown> {
  return {
    allowRealFunds: { type: "boolean" },
    iUnderstandRealFunds: { type: "boolean" }
  };
}

function contractProperties(flags: Record<string, boolean>): Record<string, unknown> {
  return {
    ...(flags.id ? { id: { type: "string" } } : {}),
    ...(flags.source ? { source: { type: "string" } } : {}),
    ...(flags.asset ? { asset: { type: "string" } } : {}),
    ...(flags.fn ? { fn: { type: "string" } } : {}),
    ...(flags.kind ? { kind: { type: "string", enum: ["interface", "meta", "env-meta", "build", "hash"] } } : {}),
    ...(flags.wasm ? { wasm: { type: "string" } } : {}),
    ...(flags.wasmHash ? { wasmHash: { type: "string" } } : {}),
    ...(flags.outFile ? { outFile: { type: "string" } } : {}),
    ...(flags.alias ? { alias: { type: "string" } } : {}),
    ...(flags.arg ? { arg: { type: "object", additionalProperties: { type: "string" } } } : {}),
    ...(flags.ledgersToExtend ? { ledgersToExtend: { type: "number" } } : {}),
    ...(flags.output ? { output: { type: "string", enum: ["string", "json", "xdr"] } } : {}),
    ...(flags.footprint
      ? {
          id: { type: "string" },
          key: { type: "string" },
          keyXdr: { type: "string" },
          wasm: { type: "string" },
          wasmHash: { type: "string" },
          durability: { type: "string", enum: ["persistent", "temporary"] }
        }
      : {}),
    ...(flags.ttlLedgerOnly ? { ttlLedgerOnly: { type: "boolean" } } : {}),
    network: { type: "string" },
    stellarBinary: { type: "string" },
    stellarConfigDir: { type: "string" },
    stellarNoCache: { type: "boolean" }
  };
}

function option(input: Record<string, unknown>, key: string, flag: string): string[] {
  const value = string(input, key);
  return value === undefined ? [] : [flag, value];
}

function realFundsFlags(input: Record<string, unknown>): string[] {
  return [
    ...(bool(input, "allowRealFunds") ? ["--allow-real-funds"] : []),
    ...(bool(input, "iUnderstandRealFunds") ? ["--i-understand-real-funds"] : [])
  ];
}

function networkAndStellarBinary(input: Record<string, unknown>): string[] {
  return [
    ...option(input, "network", "--network"),
    ...option(input, "stellarBinary", "--stellar-binary"),
    ...option(input, "stellarConfigDir", "--stellar-config-dir"),
    ...(bool(input, "stellarNoCache") ? ["--stellar-no-cache"] : [])
  ];
}

function contractArgs(input: Record<string, unknown>): string[] {
  const raw = input.arg;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw).flatMap(([key, value]) => ["--arg", `${key}=${String(value)}`]);
}

function footprintArgs(input: Record<string, unknown>): string[] {
  return [
    ...option(input, "id", "--id"),
    ...option(input, "key", "--key"),
    ...option(input, "keyXdr", "--key-xdr"),
    ...option(input, "wasm", "--wasm"),
    ...option(input, "wasmHash", "--wasm-hash"),
    ...option(input, "durability", "--durability")
  ];
}

function approvalDecisionFlag(input: Record<string, unknown>): "--approve" | "--deny" {
  const decision = requiredString(input, "decision");
  if (decision === "approve") return "--approve";
  if (decision === "deny") return "--deny";
  throw new Error("decision must be approve or deny.");
}

function string(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string.`);
  return value;
}

function stringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${key} must be an array of strings.`);
  }
  return value.filter((item) => item !== "");
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = string(input, key);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function requiredNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a number.`);
  return value;
}

function number(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a number.`);
  return value;
}

function bool(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean.`);
  return value;
}

function parseJsonOrText(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function response(request: McpRequest, result: unknown): McpResponse {
  return { jsonrpc: "2.0", id: request.id ?? null, result };
}

function mcpError(request: McpRequest, code: number, message: string, data?: unknown): McpResponse {
  return { jsonrpc: "2.0", id: request.id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

import { redactSensitive } from "@stellar-agent/core";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

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
  policyPath: { type: "string", description: "Optional path to a policy YAML file." },
  noCache: { type: "boolean", description: "Disable session caches for network lookups." }
};

const require = createRequire(import.meta.url);
const { version: MCP_VERSION } = require("../package.json") as { version: string };

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
  tool("stellar_mainnet_agent_wallet_status", "Show risk-budgeted Mainnet agent-wallet status and arming integrity.", {}, () => [
    "mainnet",
    "agent-wallet",
    "status"
  ], {}),
  tool("stellar_mainnet_agent_wallet_create", "Create or replace the dedicated watch-only Mainnet agent wallet.", { address: true }, (input) => [
    "mainnet",
    "agent-wallet",
    "create",
    "--address",
    requiredString(input, "address"),
    "--max-balance",
    string(input, "maxBalance") ?? "25",
    "--daily-limit",
    string(input, "dailyLimit") ?? "5",
    "--per-tx-limit",
    string(input, "perTxLimit") ?? "1",
    ...option(input, "monthlyLimit", "--monthly-limit"),
    ...stringArray(input, "assets").flatMap((asset) => ["--asset", asset]),
    ...stringArray(input, "allowDestinations").flatMap((destination) => ["--allow-destination", destination])
  ], {
    address: { type: "string" },
    maxBalance: { type: "string" },
    dailyLimit: { type: "string" },
    perTxLimit: { type: "string" },
    monthlyLimit: { type: "string" },
    assets: { type: "array", items: { type: "string" } },
    allowDestinations: { type: "array", items: { type: "string" } }
  }),
  tool("stellar_mainnet_agent_wallet_arm", "Arm the Mainnet agent wallet after explicit real-funds acknowledgement.", { iUnderstandRealFunds: true }, (input) => [
    "mainnet",
    "agent-wallet",
    "arm",
    ...(bool(input, "iUnderstandRealFunds") ? ["--i-understand-real-funds"] : [])
  ], { iUnderstandRealFunds: { type: "boolean" } }),
  tool("stellar_mainnet_agent_wallet_disarm", "Disarm the Mainnet agent wallet.", {}, () => [
    "mainnet",
    "agent-wallet",
    "disarm"
  ], {}),
  tool("stellar_mainnet_agent_wallet_autosign_enable", "Enable env-var based autosigning for the dedicated Mainnet agent wallet only.", { iUnderstandAgentWalletAutosign: true }, (input) => [
    "mainnet",
    "agent-wallet",
    "autosign",
    "enable",
    "--secret-key-env",
    string(input, "secretKeyEnv") ?? "STELLAR_AGENT_MAINNET_AGENT_SECRET_KEY",
    ...(bool(input, "iUnderstandAgentWalletAutosign") ? ["--i-understand-agent-wallet-autosign"] : [])
  ], {
    secretKeyEnv: { type: "string" },
    iUnderstandAgentWalletAutosign: { type: "boolean" }
  }),
  tool("stellar_mainnet_agent_wallet_autosign_disable", "Disable Mainnet agent-wallet autosigning and disarm the wallet.", {}, () => [
    "mainnet",
    "agent-wallet",
    "autosign",
    "disable"
  ], {}),
  tool("stellar_mainnet_agent_wallet_autosign_status", "Show Mainnet agent-wallet autosign status without reading secret material.", {}, () => [
    "mainnet",
    "agent-wallet",
    "autosign",
    "status"
  ], {}),
  tool("stellar_receipts_summary", "Summarize local receipt spend, Mainnet exposure, and recent activity.", {}, (input) => [
    "receipts",
    "summary",
    ...option(input, "receiptProfile", "--profile"),
    ...option(input, "asset", "--asset")
  ], {
    receiptProfile: { type: "string", enum: ["testnet", "mainnet", "local"] },
    asset: { type: "string" }
  }),
  tool("stellar_x402_init_server", "Create a local Testnet x402-style paid API server scaffold.", {}, (input) => [
    "x402",
    "init-server",
    "--out",
    string(input, "out") ?? "./stellar-agent-x402-server",
    ...(bool(input, "force") ? ["--force"] : [])
  ], {
    out: { type: "string" },
    force: { type: "boolean" }
  }),
  tool("stellar_pay_quote", "Quote and policy-check a payment without submitting it.", { to: true, amount: true }, (input) => [
    "pay",
    "quote",
    "--to",
    requiredString(input, "to"),
    "--amount",
    requiredString(input, "amount"),
    "--asset",
    string(input, "asset") ?? "XLM",
    ...option(input, "memo", "--memo"),
    ...option(input, "feeStrategy", "--fee-strategy")
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
    ...option(input, "feeStrategy", "--fee-strategy"),
    ...realFundsFlags(input),
    ...(bool(input, "iUnderstandAgentWalletAutosign") ? ["--i-understand-agent-wallet-autosign"] : []),
    ...(bool(input, "dryRun") ? ["--dry-run"] : [])
  ], { ...paymentProperties(), from: { type: "string" }, approvalId: { type: "string" }, dryRun: { type: "boolean" }, ...realFundsProperties(), iUnderstandAgentWalletAutosign: { type: "boolean" } }),
  tool("stellar_pay_batch", "Submit multiple guarded Testnet payments in one transaction.", { file: true }, (input) => [
    "pay",
    "batch",
    "--file",
    requiredString(input, "file"),
    "--from",
    string(input, "from") ?? "agent",
    ...option(input, "memo", "--memo"),
    ...option(input, "feeStrategy", "--fee-strategy"),
    ...(bool(input, "dryRun") ? ["--dry-run"] : [])
  ], {
    file: { type: "string" },
    from: { type: "string" },
    memo: { type: "string" },
    feeStrategy: { type: "string", enum: ["base", "low", "medium", "high", "p95"] },
    dryRun: { type: "boolean" }
  }),
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
  tool("stellar_market_pools_list", "List core Stellar liquidity pools, optionally filtered by reserve assets or account.", {}, (input) => [
    "market",
    "pools",
    "list",
    ...option(input, "assetA", "--asset-a"),
    ...option(input, "assetB", "--asset-b"),
    ...option(input, "account", "--account"),
    ...option(input, "network", "--network"),
    ...numberOption(input, "limit", "--limit")
  ], marketListProperties()),
  tool("stellar_market_pool_inspect", "Inspect one core Stellar liquidity pool.", { pool: true }, (input) => [
    "market",
    "pool",
    "inspect",
    "--pool",
    requiredString(input, "pool"),
    ...option(input, "network", "--network")
  ], marketPoolProperties({ pool: true })),
  tool("stellar_market_pool_trades", "Fetch recent Horizon trades for a core Stellar liquidity pool.", { pool: true }, (input) => [
    "market",
    "pool",
    "trades",
    "--pool",
    requiredString(input, "pool"),
    ...option(input, "network", "--network"),
    ...numberOption(input, "limit", "--limit")
  ], { ...marketPoolProperties({ pool: true }), limit: { type: "number" } }),
  tool("stellar_market_pool_position", "Inspect pool-share positions for a wallet or public key.", {}, (input) => [
    "market",
    "pool",
    "position",
    "--account",
    string(input, "account") ?? "agent",
    ...option(input, "pool", "--pool"),
    ...option(input, "network", "--network")
  ], { ...marketPoolProperties({ pool: false }), account: { type: "string" } }),
  tool("stellar_market_lp_preflight", "Preflight a core Stellar liquidity-pool deposit or withdrawal with policy context.", { pool: true }, (input) => [
    "market",
    "lp",
    "preflight",
    "--pool",
    requiredString(input, "pool"),
    "--account",
    string(input, "account") ?? "agent",
    ...option(input, "action", "--action"),
    ...option(input, "maxA", "--max-a"),
    ...option(input, "maxB", "--max-b"),
    ...option(input, "minPrice", "--min-price"),
    ...option(input, "maxPrice", "--max-price"),
    ...option(input, "shares", "--shares"),
    ...option(input, "minA", "--min-a"),
    ...option(input, "minB", "--min-b"),
    ...option(input, "network", "--network")
  ], marketLpPreflightProperties()),
  tool("stellar_market_listen_price", "Evaluate finite core-pool price alert checks.", { pool: true }, (input) => [
    "market",
    "listen",
    "price",
    "--pool",
    requiredString(input, "pool"),
    ...option(input, "above", "--above"),
    ...option(input, "below", "--below"),
    ...option(input, "network", "--network"),
    ...numberOption(input, "polls", "--polls"),
    ...numberOption(input, "intervalMs", "--interval-ms")
  ], marketPriceListenerProperties()),
  tool("stellar_market_listen_position", "Evaluate a finite pool-share position alert check.", { pool: true }, (input) => [
    "market",
    "listen",
    "position",
    "--pool",
    requiredString(input, "pool"),
    "--account",
    string(input, "account") ?? "agent",
    ...option(input, "sharesBelow", "--shares-below"),
    ...option(input, "network", "--network")
  ], {
    pool: { type: "string" },
    account: { type: "string" },
    sharesBelow: { type: "string" },
    network: { type: "string", enum: ["testnet", "mainnet"] }
  }),
  tool("stellar_strategy_investigate_liquidity", "Investigate liquidity-pool context for an asset pair or explicit pool without execution.", {}, (input) => [
    "strategy",
    "investigate",
    "liquidity",
    ...option(input, "pair", "--pair"),
    ...option(input, "pool", "--pool"),
    ...option(input, "network", "--network"),
    ...numberOption(input, "limit", "--limit")
  ], {
    pair: { type: "string" },
    pool: { type: "string" },
    network: { type: "string", enum: ["testnet", "mainnet"] },
    limit: { type: "number" }
  }),
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
    ...(bool(input, "noCache") ? ["--no-cache"] : []),
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
      serverInfo: { name: "stellar-agent-mcp", version: MCP_VERSION }
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
  return {
    to: { type: "string" },
    amount: { type: "string" },
    asset: { type: "string" },
    memo: { type: "string" },
    feeStrategy: { type: "string", enum: ["base", "low", "medium", "high", "p95"] }
  };
}

function marketListProperties(): Record<string, unknown> {
  return {
    assetA: { type: "string" },
    assetB: { type: "string" },
    account: { type: "string" },
    network: { type: "string", enum: ["testnet", "mainnet"] },
    limit: { type: "number" }
  };
}

function marketPoolProperties(flags: { pool: boolean }): Record<string, unknown> {
  return {
    ...(flags.pool ? { pool: { type: "string" } } : { pool: { type: "string" } }),
    network: { type: "string", enum: ["testnet", "mainnet"] }
  };
}

function marketLpPreflightProperties(): Record<string, unknown> {
  return {
    pool: { type: "string" },
    account: { type: "string" },
    action: { type: "string", enum: ["deposit", "withdraw"] },
    maxA: { type: "string" },
    maxB: { type: "string" },
    minPrice: { type: "string" },
    maxPrice: { type: "string" },
    shares: { type: "string" },
    minA: { type: "string" },
    minB: { type: "string" },
    network: { type: "string", enum: ["testnet", "mainnet"] }
  };
}

function marketPriceListenerProperties(): Record<string, unknown> {
  return {
    pool: { type: "string" },
    above: { type: "string" },
    below: { type: "string" },
    network: { type: "string", enum: ["testnet", "mainnet"] },
    polls: { type: "number" },
    intervalMs: { type: "number" }
  };
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

function numberOption(input: Record<string, unknown>, key: string, flag: string): string[] {
  const value = number(input, key);
  return value === undefined ? [] : [flag, String(value)];
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

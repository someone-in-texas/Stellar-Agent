import { spawnSync } from "node:child_process";

const commands = [
  ["packages/cli/dist/index.js", "--help"],
  ["packages/cli/dist/index.js", "testnet", "doctor", "--json"],
  ["packages/cli/dist/index.js", "testnet", "fund", "--help"],
  ["packages/cli/dist/index.js", "testnet", "scenario", "issued-asset-payment", "--help"],
  ["packages/cli/dist/index.js", "testnet", "scenario", "contract-asset-smoke", "--help"],
  ["packages/cli/dist/index.js", "wallet", "import-public", "--help"],
  ["packages/cli/dist/index.js", "wallet", "trustline", "list", "--help"],
  ["packages/cli/dist/index.js", "wallet", "trustline", "add", "--help"],
  ["packages/cli/dist/index.js", "wallet", "connect-freighter", "--help"],
  ["packages/cli/dist/index.js", "wallet", "walletconnect", "--help"],
  ["packages/cli/dist/index.js", "wallet", "walletconnect", "pair", "--help"],
  ["packages/cli/dist/index.js", "wallet", "walletconnect", "status", "--help"],
  ["packages/cli/dist/index.js", "wallet", "walletconnect", "disconnect", "--help"],
  ["packages/cli/dist/index.js", "approval", "--help"],
  ["packages/cli/dist/index.js", "approval", "create-payment", "--help"],
  ["packages/cli/dist/index.js", "approval", "create-transaction", "--help"],
  ["packages/cli/dist/index.js", "approval", "decide", "--help"],
  ["packages/cli/dist/index.js", "approval", "sign-walletconnect", "--help"],
  ["packages/cli/dist/index.js", "approval", "serve", "--help"],
  ["packages/cli/dist/index.js", "tx", "--help"],
  ["packages/cli/dist/index.js", "tx", "build-payment", "--help"],
  ["packages/cli/dist/index.js", "tx", "request-payment-signature", "--help"],
  ["packages/cli/dist/index.js", "tx", "submit-xdr", "--help"],
  ["packages/cli/dist/index.js", "tx", "submit-approval", "--help"],
  ["packages/cli/dist/index.js", "claimable", "--help"],
  ["packages/cli/dist/index.js", "ledger", "payments", "--help"],
  ["packages/cli/dist/index.js", "ledger", "effects", "--help"],
  ["packages/cli/dist/index.js", "ledger", "export", "--help"],
  ["packages/cli/dist/index.js", "cache", "inspect", "--help"],
  ["packages/cli/dist/index.js", "cache", "clear", "--help"],
  ["packages/cli/dist/index.js", "testnet", "export-report", "--help"],
  ["packages/cli/dist/index.js", "contract", "doctor", "--json"],
  ["packages/cli/dist/index.js", "contract", "invoke", "--help"],
  ["packages/cli/dist/index.js", "contract", "deploy", "--help"],
  ["packages/cli/dist/index.js", "contract", "upload", "--help"],
  ["packages/cli/dist/index.js", "contract", "asset-deploy", "--help"],
  ["packages/cli/dist/index.js", "contract", "info", "--help"],
  ["packages/cli/dist/index.js", "contract", "extend", "--help"],
  ["packages/cli/dist/index.js", "contract", "restore", "--help"],
  ["packages/cli/dist/index.js", "market", "pools", "list", "--help"],
  ["packages/cli/dist/index.js", "market", "pool", "inspect", "--help"],
  ["packages/cli/dist/index.js", "market", "pool", "trades", "--help"],
  ["packages/cli/dist/index.js", "market", "pool", "position", "--help"],
  ["packages/cli/dist/index.js", "market", "lp", "preflight", "--help"],
  ["packages/cli/dist/index.js", "market", "lp", "deposit", "--help"],
  ["packages/cli/dist/index.js", "market", "lp", "withdraw", "--help"],
  ["packages/cli/dist/index.js", "market", "lp", "trustline", "add", "--help"],
  ["packages/cli/dist/index.js", "market", "listen", "price", "--help"],
  ["packages/cli/dist/index.js", "market", "listen", "position", "--help"],
  ["packages/cli/dist/index.js", "market", "soroban", "pool", "inspect", "--help"],
  ["packages/cli/dist/index.js", "market", "soroban", "pool", "preflight", "--help"],
  ["packages/cli/dist/index.js", "strategy", "explain", "--help"],
  ["packages/cli/dist/index.js", "strategy", "simulate", "--help"],
  ["packages/cli/dist/index.js", "strategy", "investigate", "liquidity", "--help"],
  ["packages/cli/dist/index.js", "defi", "blend", "deployments", "--help"],
  ["packages/cli/dist/index.js", "defi", "blend", "pool", "inspect", "--help"],
  ["packages/cli/dist/index.js", "defi", "blend", "position", "inspect", "--help"],
  ["packages/cli/dist/index.js", "defi", "blend", "preflight", "--help"],
  ["packages/cli/dist/index.js", "defi", "blend", "supply", "--help"],
  ["packages/cli/dist/index.js", "defi", "blend", "borrow", "--help"],
  ["packages/cli/dist/index.js", "defi", "blend", "repay", "--help"],
  ["packages/cli/dist/index.js", "defi", "blend", "withdraw", "--help"],
  ["packages/cli/dist/index.js", "defi", "blend", "batch", "--help"],
  ["packages/cli/dist/index.js", "defi", "blend", "trustline", "guide", "--help"],
  ["packages/cli/dist/index.js", "defi", "blend", "trustline", "add", "--help"],
  ["packages/cli/dist/index.js", "defi", "aquarius", "deployments", "--help"],
  ["packages/cli/dist/index.js", "defi", "aquarius", "pool", "inspect", "--help"],
  ["packages/cli/dist/index.js", "defi", "aquarius", "account", "position", "--help"],
  ["packages/cli/dist/index.js", "defi", "aquarius", "lp", "preflight", "--help"],
  ["packages/cli/dist/index.js", "defi", "aquarius", "swap", "quote", "--help"],
  ["packages/cli/dist/index.js", "defi", "aquarius", "swap", "preflight", "--help"],
  ["packages/cli/dist/index.js", "defi", "aquarius", "rewards", "inspect", "--help"],
  ["packages/cli/dist/index.js", "pay", "x402", "--help"],
  ["packages/cli/dist/index.js", "pay", "batch", "--help"],
  ["packages/cli/dist/index.js", "pay", "mpp", "--help"],
  ["packages/cli/dist/index.js", "pay", "mpp-session", "--help"]
];

for (const args of commands) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Command failed: node ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  }
  if (args.includes("--help")) {
    if (!result.stdout.includes("Usage:") || !result.stdout.includes("Options:")) {
      throw new Error(`Help output for node ${args.join(" ")} is missing usage/options sections.\n${result.stdout}`);
    }
    if (args.length === 2) {
      for (const expected of ["--json", "--profile", "--no-cache"]) {
        if (!result.stdout.includes(expected)) {
          throw new Error(`Top-level help output is missing ${expected}.\n${result.stdout}`);
        }
      }
    }
  }
}

const { MCP_TOOLS, buildCliArgs } = await import("../packages/mcp-server/dist/index.js");
if (!MCP_TOOLS.some((tool) => tool.name === "stellar_pay_send")) {
  throw new Error("MCP tool list does not include stellar_pay_send.");
}
if (!MCP_TOOLS.some((tool) => tool.name === "stellar_pay_x402")) {
  throw new Error("MCP tool list does not include stellar_pay_x402.");
}
if (!MCP_TOOLS.some((tool) => tool.name === "stellar_pay_mpp")) {
  throw new Error("MCP tool list does not include stellar_pay_mpp.");
}
if (!MCP_TOOLS.some((tool) => tool.name === "stellar_pay_batch")) {
  throw new Error("MCP tool list does not include stellar_pay_batch.");
}
if (!MCP_TOOLS.some((tool) => tool.name === "stellar_tx_submit_approval")) {
  throw new Error("MCP tool list does not include stellar_tx_submit_approval.");
}
if (!MCP_TOOLS.some((tool) => tool.name === "stellar_testnet_fund")) {
  throw new Error("MCP tool list does not include stellar_testnet_fund.");
}
if (!MCP_TOOLS.some((tool) => tool.name === "stellar_testnet_scenario_issued_asset_payment")) {
  throw new Error("MCP tool list does not include stellar_testnet_scenario_issued_asset_payment.");
}
if (!MCP_TOOLS.some((tool) => tool.name === "stellar_testnet_scenario_contract_asset_smoke")) {
  throw new Error("MCP tool list does not include stellar_testnet_scenario_contract_asset_smoke.");
}
for (const toolName of [
  "stellar_market_pools_list",
  "stellar_market_pool_inspect",
  "stellar_market_pool_trades",
  "stellar_market_pool_position",
  "stellar_market_lp_preflight",
  "stellar_market_listen_price",
  "stellar_market_listen_position",
  "stellar_strategy_investigate_liquidity"
]) {
  if (!MCP_TOOLS.some((tool) => tool.name === toolName)) {
    throw new Error(`MCP tool list does not include ${toolName}.`);
  }
}
const contractInvokeArgs = buildCliArgs("stellar_contract_invoke", {
  id: "C123",
  source: "agent",
  fn: "hello",
  arg: { to: "world" }
});
if (!contractInvokeArgs.includes("contract") || !contractInvokeArgs.includes("invoke")) {
  throw new Error("MCP contract invoke args were not generated.");
}
const contractAssetDeployArgs = buildCliArgs("stellar_contract_asset_deploy", {
  source: "agent",
  asset: "native"
});
if (!contractAssetDeployArgs.includes("asset-deploy")) {
  throw new Error("MCP contract asset deploy args were not generated.");
}

const { validateCodexPlugin } = await import("../packages/codex-plugin/dist/index.js");
const validation = await validateCodexPlugin("plugins/codex");
if (!validation.valid) {
  throw new Error(`Bundled Codex plugin is invalid: ${validation.errors.join("; ")}`);
}

console.log("Offline CLI smoke checks passed.");

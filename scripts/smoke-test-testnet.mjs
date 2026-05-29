import { spawnSync } from "node:child_process";

if (!process.env.LIVE_STELLAR_TESTNET) {
  console.error("Set LIVE_STELLAR_TESTNET=1 to run the live Testnet smoke test.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["packages/cli/dist/index.js", "testnet", "smoke-test", "--json"], {
  encoding: "utf8",
  stdio: "inherit"
});
process.exit(result.status ?? 1);

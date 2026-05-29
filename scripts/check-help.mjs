import { spawnSync } from "node:child_process";

const commands = [
  ["packages/cli/dist/index.js", "--help"],
  ["packages/cli/dist/index.js", "testnet", "doctor", "--json"],
  ["packages/cli/dist/index.js", "pay", "x402", "--json"]
];

for (const args of commands) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (args.includes("x402")) {
    if (result.status !== 8) {
      throw new Error(`Expected pay x402 placeholder exit 8, got ${result.status}: ${result.stderr}`);
    }
    continue;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: node ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  }
}

console.log("Offline CLI smoke checks passed.");

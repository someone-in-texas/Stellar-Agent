#!/usr/bin/env node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";

const root = resolve(new URL("../..", import.meta.url).pathname);
const cli = join(root, "packages", "cli", "dist", "index.js");
const configPath = join(await mkdtemp(join(tmpdir(), "stellar-agent-blend-example-")), "config.yaml");

run(["testnet", "init"]);

const deployments = run(["defi", "blend", "deployments", "--network", "testnet"]);
assert(deployments.data.pools?.some((pool) => pool.name === "TestnetV2"), "Blend TestnetV2 pool was not listed.");

const pool = run(["defi", "blend", "pool", "inspect", "--pool", "TestnetV2", "--network", "testnet"]);
assert(pool.data.pool?.id, "Blend pool inspect did not return a pool id.");

const preflight = run([
  "defi",
  "blend",
  "preflight",
  "--pool",
  "TestnetV2",
  "--account",
  "agent",
  "--request",
  "supply_collateral:XLM:0.01",
  "--network",
  "testnet"
]);
assert(preflight.data.policyDecision?.status === "allowed", "Blend Testnet supply-collateral preflight was not policy-allowed.");
assert(preflight.data.preflight?.actions?.[0]?.type === "supply_collateral", "Blend preflight did not preserve the action.");

console.log(JSON.stringify({ ok: true, example: "blend-testnet", configPath, pool: pool.data.pool.id }, null, 2));

function run(args) {
  const result = spawnSync(process.execPath, [cli, "--config", configPath, "--json", ...args], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: stellar-agent ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  }
  const envelope = JSON.parse(result.stdout);
  if (!envelope.ok) {
    throw new Error(`Command returned an error: stellar-agent ${args.join(" ")}\n${result.stdout}`);
  }
  return envelope;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

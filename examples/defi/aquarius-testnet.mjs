#!/usr/bin/env node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";

const root = resolve(new URL("../..", import.meta.url).pathname);
const cli = join(root, "packages", "cli", "dist", "index.js");
const configPath = join(await mkdtemp(join(tmpdir(), "stellar-agent-aquarius-example-")), "config.yaml");

run(["testnet", "init"]);

const deployments = run(["defi", "aquarius", "deployments", "--network", "testnet", "--pools", "--limit", "10"]);
assert(deployments.data.routerContractId === "CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD", "Unexpected Aquarius Testnet router.");
const pool = deployments.data.pools?.find((candidate) => candidate.tokens?.includes("native")) ?? deployments.data.pools?.[0];
assert(pool?.address, "Aquarius Testnet pools were not returned.");

const inspected = run(["defi", "aquarius", "pool", "inspect", "--pool", pool.address, "--network", "testnet"]);
assert(inspected.data.pool?.address === pool.address, "Aquarius pool inspect returned the wrong pool.");

const position = run(["defi", "aquarius", "account", "position", "--account", "agent", "--pool", pool.address, "--network", "testnet"]);
assert(position.data.submitted === false && position.data.signing === false, "Aquarius account position should be read-only.");

const depositPreflight = run([
  "defi",
  "aquarius",
  "lp",
  "preflight",
  "--pool",
  pool.address,
  "--action",
  "deposit",
  "--account",
  "agent",
  "--amount",
  "0.0000001",
  "--amount",
  "0.0000001",
  "--min-shares",
  "0.0000001",
  "--network",
  "testnet"
]);
assert(depositPreflight.data.policyDecision?.status === "allowed", "Aquarius deposit preflight was not policy-allowed.");

const withdrawPreflight = run([
  "defi",
  "aquarius",
  "lp",
  "preflight",
  "--pool",
  pool.address,
  "--action",
  "withdraw",
  "--account",
  "agent",
  "--shares",
  "0.0000001",
  "--min-amount",
  "0",
  "--min-amount",
  "0",
  "--network",
  "testnet"
]);
assert(withdrawPreflight.data.policyDecision?.status === "allowed", "Aquarius withdraw preflight was not policy-allowed.");

const quote = run([
  "defi",
  "aquarius",
  "swap",
  "quote",
  "--from",
  "XLM",
  "--to",
  "AQUA",
  "--amount",
  "0.01",
  "--network",
  "testnet"
]);
assert(quote.data.success === true && quote.data.pools?.length > 0, "Aquarius swap quote did not return a route.");

const swapPreflight = run([
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
  "100",
  "--network",
  "testnet"
]);
assert(swapPreflight.data.policyDecision?.status === "allowed", "Aquarius swap preflight was not policy-allowed.");

const rewards = run(["defi", "aquarius", "rewards", "inspect", "--account", "agent", "--pool", pool.address, "--network", "testnet"]);
assert(rewards.data.claimSubmitted === false && rewards.data.signing === false, "Aquarius rewards inspect should be read-only.");

console.log(JSON.stringify({ ok: true, example: "aquarius-testnet", configPath, pool: pool.address }, null, 2));

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

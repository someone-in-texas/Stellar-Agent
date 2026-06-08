import { startMppDemo, startMppSessionDemo } from "@stellar-agent/mpp-client";
import { startPaidApiDemo } from "@stellar-agent/x402-client";

const recipient = process.env.STELLAR_AGENT_DEMO_RECIPIENT;
if (!recipient) {
  console.error("Set STELLAR_AGENT_DEMO_RECIPIENT=G... to start the paid API demo.");
  process.exit(2);
}

const x402Server = await startPaidApiDemo({
  recipient,
  amount: process.env.STELLAR_AGENT_DEMO_AMOUNT ?? "0.0000001",
  asset: process.env.STELLAR_AGENT_DEMO_ASSET ?? "XLM",
  port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined
});
const mppServer = await startMppDemo({
  recipient,
  amount: process.env.STELLAR_AGENT_DEMO_AMOUNT ?? "0.0000001",
  asset: process.env.STELLAR_AGENT_DEMO_ASSET ?? "XLM",
  port: process.env.MPP_PORT ? Number.parseInt(process.env.MPP_PORT, 10) : undefined
});
const mppSessionServer = await startMppSessionDemo({
  recipient,
  budget: process.env.STELLAR_AGENT_DEMO_SESSION_BUDGET ?? "0.0000003",
  pricePerRequest: process.env.STELLAR_AGENT_DEMO_SESSION_PRICE ?? "0.0000001",
  asset: process.env.STELLAR_AGENT_DEMO_ASSET ?? "XLM",
  port: process.env.MPP_SESSION_PORT ? Number.parseInt(process.env.MPP_SESSION_PORT, 10) : undefined
});

console.log(`x402 paid API demo listening at ${x402Server.url}`);
console.log(`MPP paid API demo listening at ${mppServer.url}`);
console.log(`MPP session demo listening at ${mppSessionServer.url}`);

async function shutdown() {
  await x402Server.close();
  await mppServer.close();
  await mppSessionServer.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

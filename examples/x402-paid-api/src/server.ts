import { makeId, parseAmount } from "@stellar-agent/core";
import { X402PaymentProof, X402PaymentRequirement } from "@stellar-agent/x402-client";
import express, { type Express, type Request, type Response } from "express";
import { createServer, type Server } from "node:http";
import { loadExampleEnv } from "./env.js";

export interface X402PaidApiOptions {
  recipient: string;
  amount?: string;
  asset?: string;
  verificationMode?: "mock" | "facilitator";
  facilitatorUrl?: string;
}

export interface StartedX402PaidApi {
  app: Express;
  server: Server;
  baseUrl: string;
  paidUrl: string;
  close(): Promise<void>;
}

export function createX402PaidApi(options: X402PaidApiOptions): Express {
  const amount = options.amount ?? "0.0000001";
  const asset = options.asset ?? "XLM";
  const verificationMode = options.verificationMode ?? "mock";
  parseAmount(amount, asset);

  const app = express();
  app.use(express.json());
  const acceptedTransactions = new Set<string>();
  const issuedRequirements = new Map<string, X402PaymentRequirement>();

  app.get("/free", (_request, response) => {
    response.json({
      ok: true,
      tier: "free",
      message: "This endpoint is free so agents can discover the API before paying."
    });
  });

  app.get("/paid", async (request, response) => {
    const resource = `${originForRequest(request)}/paid`;
    const proofHeader = request.header("x-payment");
    const proof = parsePaymentProof(proofHeader);
    if (!proofHeader) {
      const issued = paymentRequirement({ amount, asset, recipient: options.recipient, resource });
      issuedRequirements.set(issued.nonce, issued);
      writePaymentRequired(response, issued);
      return;
    }
    if (!proof) {
      response.status(402).json({ ok: false, error: "invalid_payment_proof" });
      return;
    }

    const issuedRequirement = proof.nonce ? issuedRequirements.get(proof.nonce) : undefined;
    if (!issuedRequirement) {
      response.status(402).json({ ok: false, error: "payment_nonce_not_issued" });
      return;
    }

    const verification = await verifyPaymentProof({
      proof,
      requirement: issuedRequirement,
      acceptedTransactions,
      verificationMode,
      facilitatorUrl: options.facilitatorUrl
    });
    if (!verification.ok) {
      response.status(402).json({ ok: false, error: verification.error });
      return;
    }
    issuedRequirements.delete(issuedRequirement.nonce);

    response.json({
      ok: true,
      tier: "paid",
      report: {
        title: "Premium Testnet signal",
        summary: "Local x402 payment accepted. Replace this JSON with your paid API result.",
        confidence: 0.97
      },
      settlement: verification.settlement
    });
  });

  app.use((_request, response) => {
    response.status(404).json({ ok: false, error: "not_found" });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: () => void) => {
    response.status(500).json({
      ok: false,
      error: "server_error",
      message: error instanceof Error ? error.message : "Unknown server error."
    });
  });

  return app;
}

export async function startX402PaidApi(options: X402PaidApiOptions & { port?: number; host?: string }): Promise<StartedX402PaidApi> {
  const app = createX402PaidApi(options);
  const server = createServer(app);
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://${host}:${port}`;
  return {
    app,
    server,
    baseUrl,
    paidUrl: `${baseUrl}/paid`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

export function paymentRequirement(args: {
  amount: string;
  asset: string;
  recipient: string;
  resource: string;
  nonce?: string;
}): X402PaymentRequirement {
  return {
    protocol: "stellar-agent-local-x402",
    version: 1,
    network: "testnet",
    amount: args.amount,
    asset: args.asset,
    recipient: args.recipient,
    resource: args.resource,
    nonce: args.nonce ?? makeId("x402_req"),
    memo: "x402-example"
  };
}

async function verifyPaymentProof(args: {
  proof: X402PaymentProof;
  requirement: X402PaymentRequirement;
  acceptedTransactions: Set<string>;
  verificationMode: "mock" | "facilitator";
  facilitatorUrl?: string;
}): Promise<{ ok: true; settlement: Record<string, unknown> } | { ok: false; error: string }> {
  if (
    args.proof.protocol !== args.requirement.protocol ||
    args.proof.version !== args.requirement.version ||
    !args.proof.transactionHash ||
    args.proof.recipient !== args.requirement.recipient ||
    args.proof.asset !== args.requirement.asset ||
    args.proof.amount !== parseAmount(args.requirement.amount, args.requirement.asset).value ||
    args.proof.resource !== args.requirement.resource ||
    args.proof.nonce !== args.requirement.nonce
  ) {
    return { ok: false, error: "invalid_payment_proof" };
  }
  if (args.acceptedTransactions.has(args.proof.transactionHash)) {
    return { ok: false, error: "payment_proof_replayed" };
  }
  if (args.verificationMode === "facilitator") {
    const facilitator = await verifyWithFacilitator(args.facilitatorUrl, args.proof);
    if (facilitator.ok) args.acceptedTransactions.add(args.proof.transactionHash);
    return facilitator;
  }
  args.acceptedTransactions.add(args.proof.transactionHash);
  return {
    ok: true,
    settlement: {
      mode: "mock",
      transactionHash: args.proof.transactionHash,
      note: "Local verification checked the payment proof shape. A facilitator should verify settlement on Testnet."
    }
  };
}

async function verifyWithFacilitator(
  facilitatorUrl: string | undefined,
  proof: X402PaymentProof
): Promise<{ ok: true; settlement: Record<string, unknown> } | { ok: false; error: string }> {
  if (!facilitatorUrl) return { ok: false, error: "facilitator_not_configured" };
  const response = await fetch(facilitatorUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proof })
  });
  if (!response.ok) return { ok: false, error: "facilitator_rejected_payment" };
  return {
    ok: true,
    settlement: {
      mode: "facilitator",
      response: await response.json()
    }
  };
}

function writePaymentRequired(response: Response, requirement: X402PaymentRequirement): void {
  const encoded = JSON.stringify(requirement);
  response.setHeader("Payment-Required", encoded);
  response.setHeader("X-Payment-Required", encoded);
  response.status(402).json(requirement);
}

function parsePaymentProof(header: string | undefined): X402PaymentProof | null {
  if (!header) return null;
  try {
    return JSON.parse(header) as X402PaymentProof;
  } catch {
    return null;
  }
}

function originForRequest(request: Request): string {
  return `${request.protocol}://${request.get("host")}`;
}

export { loadExampleEnv };

if (import.meta.url === `file://${process.argv[1]}`) {
  loadExampleEnv();
  const server = await startX402PaidApi({
    recipient: process.env.X402_RECIPIENT ?? "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    amount: process.env.X402_PRICE ?? "0.0000001",
    asset: process.env.X402_ASSET ?? "XLM",
    port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8787,
    verificationMode: process.env.X402_VERIFICATION_MODE === "facilitator" ? "facilitator" : "mock",
    facilitatorUrl: process.env.X402_FACILITATOR_URL
  });
  console.log(`x402 paid API example listening at ${server.baseUrl}`);
  console.log(`free: ${server.baseUrl}/free`);
  console.log(`paid: ${server.paidUrl}`);
}

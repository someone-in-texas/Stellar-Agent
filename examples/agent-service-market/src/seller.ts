import { makeId, parseAmount } from "@stellar-agent/core";
import { X402PaymentProof, X402PaymentRequirement } from "@stellar-agent/x402-client";
import express, { type Express, type Request, type Response } from "express";
import { createServer, type Server } from "node:http";

export interface SellerServiceOptions {
  recipient: string;
  price?: string;
  asset?: string;
  serviceId?: string;
  forceVerificationFailure?: boolean;
}

export interface ServiceListing {
  id: string;
  name: string;
  description: string;
  protocol: "x402";
  endpoint: string;
  price: string;
  asset: string;
  network: "testnet";
  recipient: string;
}

export interface ServiceDirectory {
  seller: {
    name: string;
    homepage: string;
  };
  services: ServiceListing[];
}

export interface StartedSellerService {
  app: Express;
  server: Server;
  baseUrl: string;
  directoryUrl: string;
  serviceUrl: string;
  close(): Promise<void>;
}

export function createSellerService(options: SellerServiceOptions): Express {
  const price = options.price ?? "0.0000002";
  const asset = options.asset ?? "XLM";
  const serviceId = options.serviceId ?? "premium-summary";
  parseAmount(price, asset);

  const app = express();
  app.use(express.json());
  const nonce = makeId("market_x402");
  const acceptedTransactions = new Set<string>();

  app.get("/.well-known/agent-service.json", (request, response) => {
    response.json(serviceDirectory({ request, recipient: options.recipient, price, asset, serviceId }));
  });

  app.get("/free", (_request, response) => {
    response.json({
      ok: true,
      service: "free-preview",
      sample: "The paid endpoint returns a richer deterministic JSON summary."
    });
  });

  app.get(`/${serviceId}`, (request, response) => {
    const resource = `${originForRequest(request)}/${serviceId}`;
    const proofHeader = request.header("x-payment");
    if (!proofHeader) {
      writeRequirement(response, requirement({ recipient: options.recipient, price, asset, resource, nonce }));
      return;
    }
    const proof = parseProof(proofHeader);
    if (!proof || options.forceVerificationFailure) {
      response.status(402).json({ ok: false, error: "seller_verification_failed" });
      return;
    }
    const validation = validateProof(proof, requirement({ recipient: options.recipient, price, asset, resource, nonce }));
    if (!validation.ok) {
      response.status(402).json({ ok: false, error: validation.error });
      return;
    }
    if (acceptedTransactions.has(proof.transactionHash)) {
      response.status(402).json({ ok: false, error: "payment_proof_replayed" });
      return;
    }
    acceptedTransactions.add(proof.transactionHash);
    response.json({
      ok: true,
      service: serviceId,
      result: {
        title: "Seller agent premium summary",
        bullets: [
          "Buyer discovered the service directory.",
          "Buyer policy allowed the x402 price.",
          "Seller accepted the mocked Testnet payment proof."
        ]
      },
      paid: {
        transactionHash: proof.transactionHash,
        amount: proof.amount,
        asset: proof.asset
      }
    });
  });

  app.use((_request, response) => {
    response.status(404).json({ ok: false, error: "not_found" });
  });

  return app;
}

export async function startSellerService(options: SellerServiceOptions & { port?: number; host?: string }): Promise<StartedSellerService> {
  const app = createSellerService(options);
  const server = createServer(app);
  const host = options.host ?? "127.0.0.1";
  const serviceId = options.serviceId ?? "premium-summary";
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
    directoryUrl: `${baseUrl}/.well-known/agent-service.json`,
    serviceUrl: `${baseUrl}/${serviceId}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

function serviceDirectory(args: {
  request: Request;
  recipient: string;
  price: string;
  asset: string;
  serviceId: string;
}): ServiceDirectory {
  const baseUrl = originForRequest(args.request);
  return {
    seller: {
      name: "tiny-seller-agent",
      homepage: baseUrl
    },
    services: [
      {
        id: args.serviceId,
        name: "Premium JSON summary",
        description: "A deterministic paid JSON response for agent-to-agent commerce demos.",
        protocol: "x402",
        endpoint: `${baseUrl}/${args.serviceId}`,
        price: args.price,
        asset: args.asset,
        network: "testnet",
        recipient: args.recipient
      }
    ]
  };
}

function requirement(args: {
  recipient: string;
  price: string;
  asset: string;
  resource: string;
  nonce: string;
}): X402PaymentRequirement {
  return {
    protocol: "stellar-agent-local-x402",
    version: 1,
    network: "testnet",
    recipient: args.recipient,
    amount: args.price,
    asset: args.asset,
    resource: args.resource,
    nonce: args.nonce,
    memo: "agent-market"
  };
}

function validateProof(
  proof: X402PaymentProof,
  expected: X402PaymentRequirement
): { ok: true } | { ok: false; error: string } {
  if (
    proof.protocol !== expected.protocol ||
    proof.version !== expected.version ||
    proof.recipient !== expected.recipient ||
    proof.asset !== expected.asset ||
    proof.amount !== parseAmount(expected.amount, expected.asset).value ||
    proof.resource !== expected.resource ||
    proof.nonce !== expected.nonce ||
    !proof.transactionHash
  ) {
    return { ok: false, error: "invalid_payment_proof" };
  }
  return { ok: true };
}

function writeRequirement(response: Response, paymentRequirement: X402PaymentRequirement): void {
  const encoded = JSON.stringify(paymentRequirement);
  response.setHeader("Payment-Required", encoded);
  response.setHeader("X-Payment-Required", encoded);
  response.status(402).json(paymentRequirement);
}

function parseProof(header: string | undefined): X402PaymentProof | null {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const service = await startSellerService({
    recipient: process.env.SELLER_RECIPIENT ?? "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    price: process.env.SERVICE_PRICE ?? "0.0000002",
    asset: process.env.SERVICE_ASSET ?? "XLM",
    port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8790
  });
  console.log(`seller agent listening at ${service.baseUrl}`);
  console.log(`discovery: ${service.directoryUrl}`);
  console.log(`paid service: ${service.serviceUrl}`);
}

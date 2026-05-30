import {
  NetworkProfile,
  PaymentRequest,
  StellarAgentError,
  TestnetWallet,
  makeId,
  parseAmount
} from "@stellar-agent/core";
import { appendEvent, writeReceipt } from "@stellar-agent/ledger-logger";
import { Policy, evaluatePaymentRequest } from "@stellar-agent/policy";
import { sendPayment } from "@stellar-agent/stellar";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface X402PaymentRequirement {
  protocol: "stellar-agent-local-x402";
  version: 1;
  network: "testnet";
  asset: string;
  amount: string;
  recipient: string;
  resource: string;
  nonce: string;
  memo?: string;
}

export interface X402PaymentProof {
  protocol: "stellar-agent-local-x402";
  version: 1;
  transactionHash: string;
  ledger?: number;
  payer: string;
  recipient: string;
  asset: string;
  amount: string;
  resource: string;
  nonce: string;
}

export interface X402PaymentResult {
  firstStatus: number;
  finalStatus: number;
  requirement: X402PaymentRequirement;
  policyDecision: ReturnType<typeof evaluatePaymentRequest>;
  transaction?: {
    hash: string;
    ledger?: number;
    successful: boolean;
    feeCharged?: string;
  };
  receiptPath?: string;
  responseBody?: string;
}

export async function runX402Payment(args: {
  url: string;
  source: TestnetWallet;
  policy: Policy;
  profile: NetworkProfile;
  receiptsDir: string;
  eventLog: string;
  command: string;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<X402PaymentResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const first = await fetchResource(fetchImpl, args.url);
  if (first.status !== 402) {
    return {
      firstStatus: first.status,
      finalStatus: first.status,
      requirement: syntheticRequirement(args.url),
      policyDecision: evaluatePaymentRequest(args.policy, {
        destination: args.source.publicKey,
        amount: "0.0000001",
        asset: "XLM",
        network: "testnet"
      }),
      responseBody: await first.text()
    };
  }

  const requirement = await parseX402Requirement(first);
  assertSameResource(requirement.resource, args.url);
  const request: PaymentRequest = {
    source: args.source.publicKey,
    destination: requirement.recipient,
    amount: requirement.amount,
    asset: requirement.asset,
    memo: requirement.memo,
    network: "testnet",
    domain: new URL(args.url).host,
    url: args.url
  };
  const policyDecision = evaluatePaymentRequest(args.policy, request);
  await appendEvent(args.eventLog, {
    event: "policy_decision",
    status: policyDecision.status,
    command: args.command,
    profile: "testnet",
    data: { request, requirement, policyDecision }
  });
  if (policyDecision.status === "denied") {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "x402 payment request was denied by policy.",
      hint: "Enable x402 and allow the target domain in policy when appropriate.",
      docs: "docs/x402-and-mpp.md#local-x402-demo"
    });
  }
  if (policyDecision.status === "requires_approval") {
    throw new StellarAgentError({
      code: "APPROVAL_REQUIRED",
      message: "x402 payment requires approval.",
      docs: "docs/x402-and-mpp.md#local-x402-demo"
    });
  }
  if (args.dryRun) {
    return { firstStatus: 402, finalStatus: 402, requirement, policyDecision };
  }

  const transaction = await sendPayment({
    source: args.source,
    destination: requirement.recipient,
    amount: requirement.amount,
    asset: requirement.asset,
    ...(requirement.memo === undefined ? {} : { memo: requirement.memo }),
    profile: args.profile
  });
  const proof: X402PaymentProof = {
    protocol: "stellar-agent-local-x402",
    version: 1,
    transactionHash: transaction.hash,
    payer: args.source.publicKey,
    recipient: requirement.recipient,
    asset: requirement.asset,
    amount: parseAmount(requirement.amount).value,
    resource: requirement.resource,
    nonce: requirement.nonce,
    ...(transaction.ledger === undefined ? {} : { ledger: transaction.ledger })
  };
  const paid = await fetchResource(fetchImpl, args.url, {
    headers: {
      "X-Payment": JSON.stringify(proof),
      "X-Payment-Transaction": transaction.hash
    }
  });
  const responseBody = await paid.text();
  const { path: receiptPath } = await writeReceipt(args.receiptsDir, {
    command: args.command,
    profile: "testnet",
    networkPassphrase: args.profile.networkPassphrase,
    realFunds: false,
    payment: {
      source: args.source.publicKey,
      destination: requirement.recipient,
      asset: requirement.asset,
      amount: requirement.amount,
      ...(requirement.memo === undefined ? {} : { memo: requirement.memo })
    },
    policyDecision,
    transaction,
    ...(transaction.ledger === undefined ? {} : { ledger: { confirmedLedger: transaction.ledger } }),
    eventLog: args.eventLog
  });
  await appendEvent(args.eventLog, {
    event: "receipt_written",
    status: "success",
    command: args.command,
    profile: "testnet",
    data: { receiptPath, transactionHash: transaction.hash, finalStatus: paid.status }
  });
  return {
    firstStatus: 402,
    finalStatus: paid.status,
    requirement,
    policyDecision,
    transaction,
    receiptPath,
    responseBody
  };
}

async function fetchResource(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    throw new StellarAgentError({
      code: "X402_RESOURCE_UNAVAILABLE",
      message: "Could not fetch the x402 resource.",
      hint: "Check the URL and make sure the paid API is running.",
      docs: "docs/x402-and-mpp.md#local-x402-demo",
      details: String(error)
    });
  }
}

export async function parseX402Requirement(response: Response): Promise<X402PaymentRequirement> {
  const header =
    response.headers.get("Payment-Required") ??
    response.headers.get("PAYMENT-REQUIRED") ??
    response.headers.get("X-Payment-Required") ??
    response.headers.get("X-Payment");
  const parsed = header ? JSON.parse(header) : await response.json();
  return validateRequirement(parsed);
}

export function validateRequirement(value: unknown): X402PaymentRequirement {
  const candidate = value as Partial<X402PaymentRequirement>;
  if (
    candidate.protocol !== "stellar-agent-local-x402" ||
    candidate.version !== 1 ||
    candidate.network !== "testnet" ||
    !candidate.recipient ||
    !candidate.amount ||
    !candidate.asset ||
    !candidate.resource ||
    !candidate.nonce
  ) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "HTTP 402 response did not include a supported x402 payment requirement.",
      docs: "docs/x402-and-mpp.md#local-x402-demo"
    });
  }
  parseAmount(candidate.amount, candidate.asset);
  return {
    protocol: "stellar-agent-local-x402",
    version: 1,
    network: "testnet",
    recipient: candidate.recipient,
    amount: candidate.amount,
    asset: candidate.asset,
    resource: candidate.resource,
    nonce: candidate.nonce,
    ...(candidate.memo === undefined ? {} : { memo: candidate.memo })
  };
}

export async function startPaidApiDemo(args: {
  recipient: string;
  amount?: string;
  asset?: string;
  port?: number;
  host?: string;
}): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const host = args.host ?? "127.0.0.1";
  const amount = args.amount ?? "0.0000001";
  const asset = args.asset ?? "XLM";
  parseAmount(amount, asset);
  const nonce = makeId("x402_req");
  const acceptedTransactions = new Set<string>();
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url?.startsWith("/health")) {
      writeJson(response, 200, { ok: true });
      return;
    }
    if (!request.url?.startsWith("/paid-report")) {
      writeJson(response, 404, { ok: false, error: "not_found" });
      return;
    }
    const proofHeader = request.headers["x-payment"];
    if (!proofHeader) {
      const resource = paidResource(host, server);
      const requirement: X402PaymentRequirement = {
        protocol: "stellar-agent-local-x402",
        version: 1,
        network: "testnet",
        asset,
        amount,
        recipient: args.recipient,
        resource,
        nonce,
        memo: "x402-demo"
      };
      const encoded = JSON.stringify(requirement);
      response.setHeader("Payment-Required", encoded);
      response.setHeader("X-Payment-Required", encoded);
      writeJson(response, 402, requirement);
      return;
    }
    const proof = parseProofHeader(proofHeader);
    const resource = paidResource(host, server);
    if (
      !proof ||
      proof.protocol !== "stellar-agent-local-x402" ||
      proof.version !== 1 ||
      !proof.transactionHash ||
      !proof.payer ||
      proof.recipient !== args.recipient ||
      proof.asset !== asset ||
      proof.amount !== parseAmount(amount, asset).value ||
      proof.resource !== resource ||
      proof.nonce !== nonce
    ) {
      writeJson(response, 402, { ok: false, error: "invalid_payment_proof" });
      return;
    }
    if (acceptedTransactions.has(proof.transactionHash)) {
      writeJson(response, 402, { ok: false, error: "payment_proof_replayed" });
      return;
    }
    acceptedTransactions.add(proof.transactionHash);
    writeJson(response, 200, {
      ok: true,
      id: makeId("paid_report"),
      message: "Local x402 demo content unlocked.",
      paid: {
        transactionHash: proof.transactionHash,
        amount: proof.amount,
        asset: proof.asset
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(args.port ?? 0, host, () => resolve());
  });
  return {
    url: `http://${host}:${addressPort(server)}/paid-report`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

function syntheticRequirement(url: string): X402PaymentRequirement {
  return {
    protocol: "stellar-agent-local-x402",
    version: 1,
    network: "testnet",
    asset: "XLM",
    amount: "0.0000001",
    recipient: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    resource: url,
    nonce: makeId("x402_req")
  };
}

function paidResource(host: string, server: ReturnType<typeof createServer>): string {
  return `http://${host}:${addressPort(server)}/paid-report`;
}

function assertSameResource(advertisedResource: string, requestedUrl: string): void {
  const advertised = new URL(advertisedResource);
  const requested = new URL(requestedUrl);
  if (advertised.origin !== requested.origin || advertised.pathname !== requested.pathname) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "HTTP 402 payment requirement resource does not match the requested URL.",
      docs: "docs/x402-and-mpp.md#local-x402-demo"
    });
  }
}

function addressPort(server: ReturnType<typeof createServer>): number {
  const address = server.address();
  if (!address || typeof address === "string") return 0;
  return address.port;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function parseProofHeader(header: string | string[] | undefined): any | null {
  try {
    return JSON.parse(Array.isArray(header) ? header[0] ?? "{}" : header ?? "{}");
  } catch {
    return null;
  }
}

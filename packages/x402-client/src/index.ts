import {
  NetworkProfile,
  TESTNET_PROFILE,
  PaymentRequest,
  StellarAgentError,
  TestnetWallet,
  makeId,
  parseAmount
} from "@stellar-agent/core";
import { appendEvent, writeReceipt } from "@stellar-agent/ledger-logger";
import { Policy, SpendHistory, evaluatePaymentRequest } from "@stellar-agent/policy";
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
  issuedAt?: string;
  expiresAt?: string;
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
  submittedAt?: string;
}

export interface X402VerifiedPaymentOperation {
  source: string;
  destination: string;
  asset: string;
  amount: string;
}

export interface X402VerifiedPayment {
  transactionHash: string;
  successful: boolean;
  ledger?: number;
  createdAt?: string;
  memo?: string;
  operations: X402VerifiedPaymentOperation[];
}

export type X402PaymentLoader = (proof: X402PaymentProof) => Promise<X402VerifiedPayment | null>;

export type X402PaymentVerification =
  | {
      ok: true;
      settlement: {
        mode: "horizon" | "mock";
        transactionHash: string;
        ledger?: number;
        createdAt?: string;
        operation: X402VerifiedPaymentOperation;
      };
    }
  | {
      ok: false;
      error:
        | "invalid_payment_proof"
        | "payment_nonce_expired"
        | "payment_proof_replayed"
        | "payment_settlement_unavailable"
        | "payment_not_successful"
        | "payment_operation_mismatch";
    };

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
  paidResourceDelivered?: boolean;
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
  spendHistory?: SpendHistory;
  loadSpendHistory?: (request: PaymentRequest) => Promise<SpendHistory>;
  fetchImpl?: typeof fetch;
  sendPaymentImpl?: typeof sendPayment;
}): Promise<X402PaymentResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const sendPaymentImpl = args.sendPaymentImpl ?? sendPayment;
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
  const history = args.loadSpendHistory ? await args.loadSpendHistory(request) : args.spendHistory;
  const policyDecision = evaluatePaymentRequest(args.policy, request, history);
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

  const transaction = await sendPaymentImpl({
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
    submittedAt: new Date().toISOString(),
    ...(transaction.ledger === undefined ? {} : { ledger: transaction.ledger })
  };
  const paid = await fetchResource(fetchImpl, args.url, {
    headers: {
      "X-Payment": JSON.stringify(proof),
      "X-Payment-Transaction": transaction.hash
    }
  });
  const responseBody = await paid.text();
  const paidResourceDelivered = paid.status >= 200 && paid.status < 300;
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
      domain: new URL(args.url).host,
      url: args.url,
      ...(requirement.memo === undefined ? {} : { memo: requirement.memo })
    },
    policyDecision,
    transaction,
    ...(transaction.ledger === undefined ? {} : { ledger: { confirmedLedger: transaction.ledger } }),
    eventLog: args.eventLog
  });
  await appendEvent(args.eventLog, {
    event: "receipt_written",
    status: paidResourceDelivered ? "success" : "paid_resource_failed",
    command: args.command,
    profile: "testnet",
    data: { receiptPath, transactionHash: transaction.hash, finalStatus: paid.status, paidResourceDelivered }
  });
  return {
    firstStatus: 402,
    finalStatus: paid.status,
    requirement,
    policyDecision,
    transaction,
    receiptPath,
    responseBody,
    paidResourceDelivered
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
    ...(candidate.issuedAt === undefined ? {} : { issuedAt: candidate.issuedAt }),
    ...(candidate.expiresAt === undefined ? {} : { expiresAt: candidate.expiresAt }),
    ...(candidate.memo === undefined ? {} : { memo: candidate.memo })
  };
}

export async function verifyX402PaymentProof(args: {
  proof: X402PaymentProof;
  requirement: X402PaymentRequirement;
  acceptedTransactions?: Set<string>;
  mode?: "horizon" | "mock";
  now?: Date;
  maxChallengeAgeMs?: number;
  horizonUrl?: string | null;
  fetchImpl?: typeof fetch;
  loadPayment?: X402PaymentLoader;
}): Promise<X402PaymentVerification> {
  const expectedAmount = parseAmount(args.requirement.amount, args.requirement.asset).value;
  if (
    args.proof.protocol !== args.requirement.protocol ||
    args.proof.version !== args.requirement.version ||
    !/^[a-f0-9]{64}$/i.test(args.proof.transactionHash) ||
    !args.proof.payer ||
    args.requirement.network !== "testnet" ||
    args.proof.recipient !== args.requirement.recipient ||
    args.proof.asset !== args.requirement.asset ||
    parseAmount(args.proof.amount, args.proof.asset).value !== expectedAmount ||
    args.proof.resource !== args.requirement.resource ||
    args.proof.nonce !== args.requirement.nonce
  ) {
    return { ok: false, error: "invalid_payment_proof" };
  }
  if (isExpiredRequirement(args.requirement, args.now ?? new Date(), args.maxChallengeAgeMs ?? 5 * 60 * 1000)) {
    return { ok: false, error: "payment_nonce_expired" };
  }
  if (args.acceptedTransactions?.has(args.proof.transactionHash)) {
    return { ok: false, error: "payment_proof_replayed" };
  }

  const mode = args.mode ?? "horizon";
  const payment = args.loadPayment
    ? await args.loadPayment(args.proof)
    : mode === "mock"
      ? mockVerifiedPayment(args.proof)
      : await loadX402PaymentFromHorizon({
          transactionHash: args.proof.transactionHash,
          horizonUrl: args.horizonUrl ?? TESTNET_PROFILE.horizonUrl,
          ...(args.fetchImpl === undefined ? {} : { fetchImpl: args.fetchImpl })
        });
  if (!payment) return { ok: false, error: "payment_settlement_unavailable" };
  if (!payment.successful) return { ok: false, error: "payment_not_successful" };

  const operation = payment.operations.find(
    (candidate) =>
      candidate.source === args.proof.payer &&
      candidate.destination === args.requirement.recipient &&
      candidate.asset === args.requirement.asset &&
      parseAmount(candidate.amount, candidate.asset).value === expectedAmount
  );
  if (!operation) return { ok: false, error: "payment_operation_mismatch" };

  args.acceptedTransactions?.add(args.proof.transactionHash);
  return {
    ok: true,
    settlement: {
      mode,
      transactionHash: payment.transactionHash,
      ...(payment.ledger === undefined ? {} : { ledger: payment.ledger }),
      ...(payment.createdAt === undefined ? {} : { createdAt: payment.createdAt }),
      operation
    }
  };
}

export async function loadX402PaymentFromHorizon(args: {
  transactionHash: string;
  horizonUrl?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<X402VerifiedPayment | null> {
  if (!args.horizonUrl) return null;
  const fetchImpl = args.fetchImpl ?? fetch;
  const baseUrl = args.horizonUrl.replace(/\/$/, "");
  const transaction = await fetchJson(fetchImpl, `${baseUrl}/transactions/${args.transactionHash}`);
  if (!transaction) return null;
  const operationsUrl = `${baseUrl}/transactions/${args.transactionHash}/operations?limit=200`;
  const operations = await fetchJson(fetchImpl, operationsUrl);
  const records = Array.isArray(operations?._embedded?.records) ? operations._embedded.records : [];
  return {
    transactionHash: String(transaction.hash ?? args.transactionHash),
    successful: transaction.successful === true,
    ...(typeof transaction.ledger === "number" ? { ledger: transaction.ledger } : {}),
    ...(typeof transaction.created_at === "string" ? { createdAt: transaction.created_at } : {}),
    ...(typeof transaction.memo === "string" ? { memo: transaction.memo } : {}),
    operations: records.flatMap((record: any) => {
      if (record?.type !== "payment") return [];
      const asset = record.asset_type === "native" ? "XLM" : `${record.asset_code}:${record.asset_issuer}`;
      if (!record.from || !record.to || !record.amount) return [];
      return [
        {
          source: String(record.from),
          destination: String(record.to),
          asset,
          amount: String(record.amount)
        }
      ];
    })
  };
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<any | null> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function isExpiredRequirement(requirement: X402PaymentRequirement, now: Date, maxChallengeAgeMs: number): boolean {
  if (requirement.expiresAt && Number.isFinite(Date.parse(requirement.expiresAt)) && Date.parse(requirement.expiresAt) < now.getTime()) {
    return true;
  }
  if (!requirement.issuedAt) return false;
  const issuedAt = Date.parse(requirement.issuedAt);
  if (!Number.isFinite(issuedAt)) return true;
  return now.getTime() - issuedAt > maxChallengeAgeMs;
}

function mockVerifiedPayment(proof: X402PaymentProof): X402VerifiedPayment {
  return {
    transactionHash: proof.transactionHash,
    successful: true,
    ...(proof.ledger === undefined ? {} : { ledger: proof.ledger }),
    ...(proof.submittedAt === undefined ? {} : { createdAt: proof.submittedAt }),
    operations: [
      {
        source: proof.payer,
        destination: proof.recipient,
        asset: proof.asset,
        amount: proof.amount
      }
    ]
  };
}

export async function startPaidApiDemo(args: {
  recipient: string;
  amount?: string;
  asset?: string;
  port?: number;
  host?: string;
  verificationMode?: "mock" | "horizon";
  horizonUrl?: string | null;
  loadPayment?: X402PaymentLoader;
}): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const host = args.host ?? "127.0.0.1";
  const amount = args.amount ?? "0.0000001";
  const asset = args.asset ?? "XLM";
  parseAmount(amount, asset);
  const maxChallengeAgeMs = 5 * 60 * 1000;
  const issuedRequirements = new Map<string, X402PaymentRequirement>();
  const acceptedTransactions = new Set<string>();
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
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
      const issuedAt = new Date();
      const requirement: X402PaymentRequirement = {
        protocol: "stellar-agent-local-x402",
        version: 1,
        network: "testnet",
        asset,
        amount,
        recipient: args.recipient,
        resource,
        nonce: makeId("x402_req"),
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + maxChallengeAgeMs).toISOString(),
        memo: "x402-demo"
      };
      issuedRequirements.set(requirement.nonce, requirement);
      const encoded = JSON.stringify(requirement);
      response.setHeader("Payment-Required", encoded);
      response.setHeader("X-Payment-Required", encoded);
      writeJson(response, 402, requirement);
      return;
    }
    const proof = parseProofHeader(proofHeader);
    const resource = paidResource(host, server);
    if (!proof) {
      writeJson(response, 402, { ok: false, error: "invalid_payment_proof" });
      return;
    }
    if (acceptedTransactions.has(proof.transactionHash)) {
      writeJson(response, 402, { ok: false, error: "payment_proof_replayed" });
      return;
    }
    const issuedRequirement = proof.nonce ? issuedRequirements.get(proof.nonce) : undefined;
    if (!issuedRequirement) {
      writeJson(response, 402, { ok: false, error: "payment_nonce_not_issued" });
      return;
    }
    const verification = await verifyX402PaymentProof({
      proof,
      requirement: issuedRequirement,
      acceptedTransactions,
      mode: args.verificationMode ?? "mock",
      maxChallengeAgeMs,
      ...(args.horizonUrl === undefined ? {} : { horizonUrl: args.horizonUrl }),
      ...(args.loadPayment === undefined ? {} : { loadPayment: args.loadPayment })
    });
    if (!verification.ok) {
      writeJson(response, 402, { ok: false, error: verification.error });
      return;
    }
    issuedRequirements.delete(issuedRequirement.nonce);
    writeJson(response, 200, {
      ok: true,
      id: makeId("paid_report"),
      message: "Local x402 demo content unlocked.",
      paid: {
        transactionHash: proof.transactionHash,
        amount: proof.amount,
        asset: proof.asset,
        verifier: verification.settlement.mode
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
  if (advertised.origin !== requested.origin || advertised.pathname !== requested.pathname || advertised.search !== requested.search) {
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

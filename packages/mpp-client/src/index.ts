import {
  NetworkProfile,
  PaymentRequest,
  StellarAgentError,
  TestnetWallet,
  formatStroops,
  makeId,
  parseAmount
} from "@stellar-agent/core";
import { appendEvent, writeReceipt } from "@stellar-agent/ledger-logger";
import { Policy, SpendHistory, evaluatePaymentRequest } from "@stellar-agent/policy";
import { sendPayment } from "@stellar-agent/stellar";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface MppCharge {
  protocol: "stellar-agent-local-mpp";
  version: 1;
  chargeId: string;
  network: "testnet";
  asset: string;
  amount: string;
  recipient: string;
  resource: string;
  memo?: string;
}

export interface MppPaymentProof {
  protocol: "stellar-agent-local-mpp";
  version: 1;
  chargeId: string;
  transactionHash: string;
  ledger?: number;
  payer: string;
  recipient: string;
  asset: string;
  amount: string;
  resource: string;
}

export interface MppPaymentResult {
  firstStatus: number;
  finalStatus: number;
  charge: MppCharge;
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

export interface MppSessionRequirement {
  protocol: "stellar-agent-local-mpp-session";
  version: 1;
  sessionId: string;
  network: "testnet";
  asset: string;
  budget: string;
  pricePerRequest: string;
  recipient: string;
  resource: string;
  memo?: string;
}

export interface MppSessionProof {
  protocol: "stellar-agent-local-mpp-session";
  version: 1;
  sessionId: string;
  transactionHash: string;
  ledger?: number;
  payer: string;
  recipient: string;
  asset: string;
  budget: string;
  pricePerRequest: string;
  resource: string;
}

export interface MppSessionResult {
  firstStatus: number;
  finalStatus: number;
  requestCount: number;
  successfulRequests: number;
  session: MppSessionRequirement;
  proof?: MppSessionProof;
  policyDecision: ReturnType<typeof evaluatePaymentRequest>;
  transaction?: {
    hash: string;
    ledger?: number;
    successful: boolean;
    feeCharged?: string;
  };
  receiptPath?: string;
  paidResourceDelivered?: boolean;
  responses: Array<{
    status: number;
    body: string;
  }>;
}

export async function runMppPayment(args: {
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
}): Promise<MppPaymentResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const sendPaymentImpl = args.sendPaymentImpl ?? sendPayment;
  const first = await fetchResource(fetchImpl, args.url);
  if (first.status !== 402) {
    return {
      firstStatus: first.status,
      finalStatus: first.status,
      charge: syntheticCharge(args.url),
      policyDecision: evaluatePaymentRequest(args.policy, {
        destination: args.source.publicKey,
        amount: "0.0000001",
        asset: "XLM",
        network: "testnet"
      }),
      responseBody: await first.text()
    };
  }

  const charge = await parseMppCharge(first);
  assertSameResource(charge.resource, args.url, "docs/x402-and-mpp.md#local-mpp-demo");
  const request: PaymentRequest = {
    source: args.source.publicKey,
    destination: charge.recipient,
    amount: charge.amount,
    asset: charge.asset,
    memo: charge.memo,
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
    data: { request, charge, policyDecision }
  });
  if (policyDecision.status === "denied") {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "MPP charge was denied by policy.",
      hint: "Allow the target domain and price limit intentionally before paying.",
      docs: "docs/x402-and-mpp.md#local-mpp-demo"
    });
  }
  if (policyDecision.status === "requires_approval") {
    throw new StellarAgentError({
      code: "APPROVAL_REQUIRED",
      message: "MPP charge requires approval.",
      docs: "docs/x402-and-mpp.md#local-mpp-demo"
    });
  }
  if (args.dryRun) {
    return { firstStatus: 402, finalStatus: 402, charge, policyDecision };
  }

  const transaction = await sendPaymentImpl({
    source: args.source,
    destination: charge.recipient,
    amount: charge.amount,
    asset: charge.asset,
    ...(charge.memo === undefined ? {} : { memo: charge.memo }),
    profile: args.profile
  });
  const proof: MppPaymentProof = {
    protocol: "stellar-agent-local-mpp",
    version: 1,
    chargeId: charge.chargeId,
    transactionHash: transaction.hash,
    payer: args.source.publicKey,
    recipient: charge.recipient,
    asset: charge.asset,
    amount: parseAmount(charge.amount).value,
    resource: charge.resource,
    ...(transaction.ledger === undefined ? {} : { ledger: transaction.ledger })
  };
  const paid = await fetchResource(fetchImpl, args.url, {
    headers: {
      "X-MPP-Payment": JSON.stringify(proof),
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
      destination: charge.recipient,
      asset: charge.asset,
      amount: charge.amount,
      domain: new URL(args.url).host,
      url: args.url,
      ...(charge.memo === undefined ? {} : { memo: charge.memo })
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
    data: { receiptPath, transactionHash: transaction.hash, finalStatus: paid.status, chargeId: charge.chargeId, paidResourceDelivered }
  });
  return {
    firstStatus: 402,
    finalStatus: paid.status,
    charge,
    policyDecision,
    transaction,
    receiptPath,
    responseBody,
    paidResourceDelivered
  };
}

export async function runMppSession(args: {
  url: string;
  source: TestnetWallet;
  policy: Policy;
  profile: NetworkProfile;
  receiptsDir: string;
  eventLog: string;
  command: string;
  requestCount?: number;
  dryRun?: boolean;
  spendHistory?: SpendHistory;
  loadSpendHistory?: (request: PaymentRequest) => Promise<SpendHistory>;
  fetchImpl?: typeof fetch;
  sendPaymentImpl?: typeof sendPayment;
}): Promise<MppSessionResult> {
  const requestCount = args.requestCount ?? 2;
  if (!Number.isInteger(requestCount) || requestCount < 1) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "MPP session request count must be a positive integer.",
      docs: "docs/x402-and-mpp.md#local-mpp-session-demo"
    });
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const sendPaymentImpl = args.sendPaymentImpl ?? sendPayment;
  const first = await fetchResource(fetchImpl, args.url);
  if (first.status !== 402) {
    return {
      firstStatus: first.status,
      finalStatus: first.status,
      requestCount,
      successfulRequests: 0,
      session: syntheticSession(args.url),
      policyDecision: evaluatePaymentRequest(args.policy, {
        destination: args.source.publicKey,
        amount: "0.0000001",
        asset: "XLM",
        network: "testnet"
      }),
      responses: [{ status: first.status, body: await first.text() }]
    };
  }

  const session = await parseMppSessionRequirement(first);
  assertSameResource(session.resource, args.url, "docs/x402-and-mpp.md#local-mpp-session-demo");
  const request: PaymentRequest = {
    source: args.source.publicKey,
    destination: session.recipient,
    amount: session.budget,
    asset: session.asset,
    memo: session.memo,
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
    data: { request, session, policyDecision }
  });
  if (policyDecision.status === "denied") {
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "MPP session budget was denied by policy.",
      hint: "Allow the target domain and session budget intentionally before paying.",
      docs: "docs/x402-and-mpp.md#local-mpp-session-demo"
    });
  }
  if (policyDecision.status === "requires_approval") {
    throw new StellarAgentError({
      code: "APPROVAL_REQUIRED",
      message: "MPP session budget requires approval.",
      docs: "docs/x402-and-mpp.md#local-mpp-session-demo"
    });
  }
  if (args.dryRun) {
    return {
      firstStatus: 402,
      finalStatus: 402,
      requestCount,
      successfulRequests: 0,
      session,
      policyDecision,
      responses: []
    };
  }

  const transaction = await sendPaymentImpl({
    source: args.source,
    destination: session.recipient,
    amount: session.budget,
    asset: session.asset,
    ...(session.memo === undefined ? {} : { memo: session.memo }),
    profile: args.profile
  });
  const proof: MppSessionProof = {
    protocol: "stellar-agent-local-mpp-session",
    version: 1,
    sessionId: session.sessionId,
    transactionHash: transaction.hash,
    payer: args.source.publicKey,
    recipient: session.recipient,
    asset: session.asset,
    budget: parseAmount(session.budget).value,
    pricePerRequest: parseAmount(session.pricePerRequest).value,
    resource: session.resource,
    ...(transaction.ledger === undefined ? {} : { ledger: transaction.ledger })
  };

  const responses: MppSessionResult["responses"] = [];
  for (let index = 0; index < requestCount; index += 1) {
    const paid = await fetchResource(fetchImpl, args.url, {
      headers: {
        "X-MPP-Session": JSON.stringify(proof),
        "X-Payment-Transaction": transaction.hash
      }
    });
    responses.push({ status: paid.status, body: await paid.text() });
  }
  const finalStatus = responses.at(-1)?.status ?? 402;
  const successfulRequests = responses.filter((response) => response.status >= 200 && response.status < 300).length;
  const paidResourceDelivered = successfulRequests === requestCount;
  const { path: receiptPath } = await writeReceipt(args.receiptsDir, {
    command: args.command,
    profile: "testnet",
    networkPassphrase: args.profile.networkPassphrase,
    realFunds: false,
    payment: {
      source: args.source.publicKey,
      destination: session.recipient,
      asset: session.asset,
      amount: session.budget,
      domain: new URL(args.url).host,
      url: args.url,
      ...(session.memo === undefined ? {} : { memo: session.memo })
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
    data: {
      receiptPath,
      transactionHash: transaction.hash,
      finalStatus,
      sessionId: session.sessionId,
      successfulRequests,
      requestCount,
      paidResourceDelivered
    }
  });
  return {
    firstStatus: 402,
    finalStatus,
    requestCount,
    successfulRequests,
    session,
    proof,
    policyDecision,
    transaction,
    receiptPath,
    paidResourceDelivered,
    responses
  };
}

export async function parseMppCharge(response: Response): Promise<MppCharge> {
  const header = response.headers.get("MPP-Charge") ?? response.headers.get("X-MPP-Charge");
  const parsed = header ? JSON.parse(header) : await response.json();
  return validateCharge(parsed);
}

export async function parseMppSessionRequirement(response: Response): Promise<MppSessionRequirement> {
  const header = response.headers.get("MPP-Session") ?? response.headers.get("X-MPP-Session");
  const parsed = header ? JSON.parse(header) : await response.json();
  return validateSessionRequirement(parsed);
}

export function validateCharge(value: unknown): MppCharge {
  const candidate = value as Partial<MppCharge>;
  if (
    candidate.protocol !== "stellar-agent-local-mpp" ||
    candidate.version !== 1 ||
    candidate.network !== "testnet" ||
    !candidate.chargeId ||
    !candidate.recipient ||
    !candidate.amount ||
    !candidate.asset ||
    !candidate.resource
  ) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "HTTP 402 response did not include a supported MPP charge.",
      docs: "docs/x402-and-mpp.md#local-mpp-demo"
    });
  }
  parseAmount(candidate.amount, candidate.asset);
  return {
    protocol: "stellar-agent-local-mpp",
    version: 1,
    chargeId: candidate.chargeId,
    network: "testnet",
    recipient: candidate.recipient,
    amount: candidate.amount,
    asset: candidate.asset,
    resource: candidate.resource,
    ...(candidate.memo === undefined ? {} : { memo: candidate.memo })
  };
}

export function validateSessionRequirement(value: unknown): MppSessionRequirement {
  const candidate = value as Partial<MppSessionRequirement>;
  if (
    candidate.protocol !== "stellar-agent-local-mpp-session" ||
    candidate.version !== 1 ||
    candidate.network !== "testnet" ||
    !candidate.sessionId ||
    !candidate.recipient ||
    !candidate.budget ||
    !candidate.pricePerRequest ||
    !candidate.asset ||
    !candidate.resource
  ) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "HTTP 402 response did not include a supported MPP session requirement.",
      docs: "docs/x402-and-mpp.md#local-mpp-session-demo"
    });
  }
  const budget = parseAmount(candidate.budget, candidate.asset).value;
  const pricePerRequest = parseAmount(candidate.pricePerRequest, candidate.asset).value;
  if (parseAmount(budget).stroops < parseAmount(pricePerRequest).stroops) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "MPP session budget must be at least one request price.",
      docs: "docs/x402-and-mpp.md#local-mpp-session-demo"
    });
  }
  return {
    protocol: "stellar-agent-local-mpp-session",
    version: 1,
    sessionId: candidate.sessionId,
    network: "testnet",
    recipient: candidate.recipient,
    budget,
    pricePerRequest,
    asset: candidate.asset,
    resource: candidate.resource,
    ...(candidate.memo === undefined ? {} : { memo: candidate.memo })
  };
}

export async function startMppDemo(args: {
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
  const chargeId = makeId("mpp_charge");
  const acceptedTransactions = new Set<string>();
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url?.startsWith("/health")) {
      writeJson(response, 200, { ok: true });
      return;
    }
    if (!request.url?.startsWith("/mpp-report")) {
      writeJson(response, 404, { ok: false, error: "not_found" });
      return;
    }
    const proofHeader = request.headers["x-mpp-payment"];
    if (!proofHeader) {
      const resource = mppResource(host, server);
      const charge: MppCharge = {
        protocol: "stellar-agent-local-mpp",
        version: 1,
        chargeId,
        network: "testnet",
        asset,
        amount,
        recipient: args.recipient,
        resource,
        memo: "mpp-demo"
      };
      const encoded = JSON.stringify(charge);
      response.setHeader("MPP-Charge", encoded);
      response.setHeader("X-MPP-Charge", encoded);
      writeJson(response, 402, charge);
      return;
    }
    const proof = parseProofHeader(proofHeader);
    const resource = mppResource(host, server);
    if (
      !proof ||
      proof.protocol !== "stellar-agent-local-mpp" ||
      proof.version !== 1 ||
      proof.chargeId !== chargeId ||
      !proof.transactionHash ||
      !proof.payer ||
      proof.recipient !== args.recipient ||
      proof.asset !== asset ||
      proof.amount !== parseAmount(amount, asset).value ||
      proof.resource !== resource
    ) {
      writeJson(response, 402, { ok: false, error: "invalid_mpp_payment_proof" });
      return;
    }
    if (acceptedTransactions.has(proof.transactionHash)) {
      writeJson(response, 402, { ok: false, error: "mpp_payment_proof_replayed" });
      return;
    }
    acceptedTransactions.add(proof.transactionHash);
    writeJson(response, 200, {
      ok: true,
      id: makeId("mpp_report"),
      message: "Local MPP one-time charge content unlocked.",
      paid: {
        chargeId,
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
    url: `http://${host}:${addressPort(server)}/mpp-report`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

export async function startMppSessionDemo(args: {
  recipient: string;
  budget?: string;
  pricePerRequest?: string;
  asset?: string;
  port?: number;
  host?: string;
}): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const host = args.host ?? "127.0.0.1";
  const budget = args.budget ?? "0.0000003";
  const pricePerRequest = args.pricePerRequest ?? "0.0000001";
  const asset = args.asset ?? "XLM";
  const budgetAmount = parseAmount(budget, asset);
  const requestAmount = parseAmount(pricePerRequest, asset);
  if (budgetAmount.stroops < requestAmount.stroops) {
    throw new StellarAgentError({
      code: "INVALID_AMOUNT",
      message: "MPP session budget must be at least one request price.",
      docs: "docs/x402-and-mpp.md#local-mpp-session-demo"
    });
  }
  const sessionId = makeId("mpp_session");
  const sessions = new Map<string, { remaining: bigint; spent: bigint; requests: number }>();
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url?.startsWith("/health")) {
      writeJson(response, 200, { ok: true });
      return;
    }
    if (!request.url?.startsWith("/mpp-session")) {
      writeJson(response, 404, { ok: false, error: "not_found" });
      return;
    }
    const sessionHeader = request.headers["x-mpp-session"];
    if (!sessionHeader) {
      writeSessionRequirement(response, {
        host,
        server,
        sessionId,
        asset,
        budget: budgetAmount.value,
        pricePerRequest: requestAmount.value,
        recipient: args.recipient
      });
      return;
    }
    const proof = parseProofHeader(sessionHeader) as Partial<MppSessionProof> | null;
    if (
      !proof ||
      proof.protocol !== "stellar-agent-local-mpp-session" ||
      proof.sessionId !== sessionId ||
      !proof.transactionHash ||
      proof.recipient !== args.recipient ||
      proof.asset !== asset ||
      proof.budget !== budgetAmount.value ||
      proof.pricePerRequest !== requestAmount.value ||
      proof.resource !== sessionResource(host, server)
    ) {
      writeJson(response, 402, { ok: false, error: "invalid_mpp_session_proof" });
      return;
    }
    const state = sessions.get(proof.transactionHash) ?? {
      remaining: budgetAmount.stroops,
      spent: 0n,
      requests: 0
    };
    if (state.remaining < requestAmount.stroops) {
      writeJson(response, 402, {
        ok: false,
        error: "session_budget_exhausted",
        remaining: formatStroops(state.remaining),
        pricePerRequest: requestAmount.value
      });
      return;
    }
    const nextState = {
      remaining: state.remaining - requestAmount.stroops,
      spent: state.spent + requestAmount.stroops,
      requests: state.requests + 1
    };
    sessions.set(proof.transactionHash, nextState);
    writeJson(response, 200, {
      ok: true,
      id: makeId("mpp_session_report"),
      message: "Local MPP session content unlocked.",
      session: {
        sessionId,
        transactionHash: proof.transactionHash,
        requestNumber: nextState.requests,
        spent: formatStroops(nextState.spent),
        remaining: formatStroops(nextState.remaining),
        asset
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(args.port ?? 0, host, () => resolve());
  });
  return {
    url: `http://${host}:${addressPort(server)}/mpp-session`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function fetchResource(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    throw new StellarAgentError({
      code: "MPP_RESOURCE_UNAVAILABLE",
      message: "Could not fetch the MPP resource.",
      hint: "Check the URL and make sure the paid API is running.",
      docs: "docs/x402-and-mpp.md#local-mpp-demo",
      details: String(error)
    });
  }
}

function syntheticCharge(url: string): MppCharge {
  return {
    protocol: "stellar-agent-local-mpp",
    version: 1,
    chargeId: makeId("mpp_charge"),
    network: "testnet",
    asset: "XLM",
    amount: "0.0000001",
    recipient: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    resource: url
  };
}

function syntheticSession(url: string): MppSessionRequirement {
  return {
    protocol: "stellar-agent-local-mpp-session",
    version: 1,
    sessionId: makeId("mpp_session"),
    network: "testnet",
    asset: "XLM",
    budget: "0.0000003",
    pricePerRequest: "0.0000001",
    recipient: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    resource: url
  };
}

function writeSessionRequirement(
  response: ServerResponse,
  args: {
    host: string;
    server: ReturnType<typeof createServer>;
    sessionId: string;
    asset: string;
    budget: string;
    pricePerRequest: string;
    recipient: string;
  }
): void {
  const session: MppSessionRequirement = {
    protocol: "stellar-agent-local-mpp-session",
    version: 1,
    sessionId: args.sessionId,
    network: "testnet",
    asset: args.asset,
    budget: args.budget,
    pricePerRequest: args.pricePerRequest,
    recipient: args.recipient,
    resource: sessionResource(args.host, args.server),
    memo: "mpp-session"
  };
  const encoded = JSON.stringify(session);
  response.setHeader("MPP-Session", encoded);
  response.setHeader("X-MPP-Session", encoded);
  writeJson(response, 402, session);
}

function mppResource(host: string, server: ReturnType<typeof createServer>): string {
  return `http://${host}:${addressPort(server)}/mpp-report`;
}

function sessionResource(host: string, server: ReturnType<typeof createServer>): string {
  return `http://${host}:${addressPort(server)}/mpp-session`;
}

function assertSameResource(advertisedResource: string, requestedUrl: string, docs: string): void {
  const advertised = new URL(advertisedResource);
  const requested = new URL(requestedUrl);
  if (advertised.origin !== requested.origin || advertised.pathname !== requested.pathname) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "HTTP 402 payment resource does not match the requested URL.",
      docs
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

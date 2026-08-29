import { NetworkProfile, PaymentRequest, StellarAgentError, TestnetWallet, formatStroops, makeId, parseAmount, withFileLock, writeFileAtomic } from "@stellar-agent/core";
import { appendEvent, claimExecutionIntent, createExecutionIntent, readExecutionIntent, transitionExecutionIntent, updateExecutionIntent, writeReceipt } from "@stellar-agent/ledger-logger";
import { Policy, SpendHistory, evaluatePaymentRequest } from "@stellar-agent/policy";
import { sendPayment } from "@stellar-agent/stellar";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface DurableMppSession {
  schemaVersion: "stellar-agent.mpp-session.v1";
  sessionId: string;
  networkPassphraseHash: string;
  asset: string;
  budget: string;
  spent: string;
  recipient: string;
  facilitatorOrigin: string;
  revision: number;
}

export function mppSessionStatePath(sessionStateDir: string, sessionId: string): string {
  return join(sessionStateDir, `${createHash("sha256").update(sessionId).digest("hex")}.json`);
}

/** Atomically reserve one MPP debit so concurrent agents cannot overspend a session budget. */
export async function reserveMppSessionDebit(args: { path: string; session: Omit<DurableMppSession, "schemaVersion" | "spent" | "revision">; amount: string }): Promise<DurableMppSession> {
  await mkdir(dirname(args.path), { recursive: true });
  return withFileLock(args.path, async () => {
    let current: DurableMppSession = {
      ...args.session,
      schemaVersion: "stellar-agent.mpp-session.v1",
      spent: "0.0000000",
      revision: 0
    };
    try {
      current = validateDurableMppSession(JSON.parse(await readFile(args.path, "utf8")));
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        if (error instanceof StellarAgentError) throw error;
        throw new StellarAgentError({
          code: "CONFIG_INVALID",
          message: "MPP session state is unreadable and debit failed closed."
        });
      }
    }
    if (current.sessionId !== args.session.sessionId || current.networkPassphraseHash !== args.session.networkPassphraseHash || current.asset !== args.session.asset || current.recipient !== args.session.recipient || current.facilitatorOrigin !== args.session.facilitatorOrigin || parseAmount(current.budget).stroops !== parseAmount(args.session.budget).stroops)
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: "MPP session binding does not match persisted session state."
      });
    const nextSpent = parseNonNegativeAmount(current.spent) + parseAmount(args.amount).stroops;
    if (nextSpent > parseAmount(current.budget).stroops) {
      throw new StellarAgentError({
        code: "POLICY_DENIED",
        message: "MPP session debit would exceed its durable budget."
      });
    }
    const next: DurableMppSession = {
      ...current,
      spent: formatStroops(nextSpent),
      revision: current.revision + 1
    };
    await writeFileAtomic(args.path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    return next;
  });
}

export async function readDurableMppSession(path: string): Promise<DurableMppSession> {
  try {
    return validateDurableMppSession(JSON.parse(await readFile(path, "utf8")));
  } catch (error: any) {
    if (error instanceof StellarAgentError) throw error;
    throw new StellarAgentError({
      code: "CONFIG_INVALID",
      message: "MPP session state is missing or unreadable."
    });
  }
}

function validateDurableMppSession(value: unknown): DurableMppSession {
  const state = value as DurableMppSession;
  if (!state || state.schemaVersion !== "stellar-agent.mpp-session.v1" || !state.sessionId || !state.networkPassphraseHash || !state.asset || !state.recipient || !state.facilitatorOrigin || !Number.isInteger(state.revision) || state.revision < 0) {
    throw new StellarAgentError({
      code: "CONFIG_INVALID",
      message: "MPP session state is corrupt and debit failed closed."
    });
  }
  parseAmount(state.budget);
  parseNonNegativeAmount(state.spent);
  return state;
}

function parseNonNegativeAmount(value: string): bigint {
  return /^0(?:\.0{1,7})?$/.test(value) ? 0n : parseAmount(value).stroops;
}

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
  intent?: Awaited<ReturnType<typeof readExecutionIntent>>;
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
  intent?: Awaited<ReturnType<typeof readExecutionIntent>>;
}

export async function runMppPayment(args: { url: string; source: TestnetWallet; policy: Policy; profile: NetworkProfile; receiptsDir: string; eventLog: string; command: string; dryRun?: boolean; intentsDir?: string; idempotencyKey?: string; spendHistory?: SpendHistory; loadSpendHistory?: (request: PaymentRequest, excludeIntentId?: string) => Promise<SpendHistory>; fetchImpl?: typeof fetch; sendPaymentImpl?: typeof sendPayment }): Promise<MppPaymentResult> {
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
  let intent = args.intentsDir ? await prepareMppIntent(args.intentsDir, args.command, args.profile, args.idempotencyKey, request, { resource: charge.resource }) : undefined;
  if (intent?.status === "confirmed") {
    return {
      firstStatus: 402,
      finalStatus: 402,
      charge,
      policyDecision: { status: intent.policy?.status ?? "allowed", network: "testnet", realFunds: false, matchedRules: intent.policy?.matchedRules ?? ["idempotent_replay"], reasons: ["Existing confirmed payment was not resubmitted; resource delivery was not replayed."] },
      paidResourceDelivered: false,
      responseBody: "",
      intent
    };
  }
  const history = args.loadSpendHistory ? await args.loadSpendHistory(request, intent?.id) : args.spendHistory;
  const policyDecision = evaluatePaymentRequest(args.policy, request, history);
  if (intent && !["policy_checked", "approved"].includes(intent.status))
    intent = await transitionExecutionIntent(args.intentsDir!, intent.id, "policy_checked", {
      policy: { status: policyDecision.status, matchedRules: policyDecision.matchedRules }
    });
  await appendEvent(args.eventLog, {
    event: "policy_decision",
    status: policyDecision.status,
    command: args.command,
    profile: "testnet",
    data: { request, charge, policyDecision }
  });
  if (policyDecision.status === "denied") {
    if (intent)
      await transitionExecutionIntent(args.intentsDir!, intent.id, "denied", {
        spendReservation: { ...intent.spendReservation!, active: false },
        outcome: { changedOnChain: false, safeToRetry: false, reason: "policy_denied" }
      });
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "MPP charge was denied by policy.",
      hint: "Allow the target domain and price limit intentionally before paying.",
      docs: "docs/x402-and-mpp.md#local-mpp-demo"
    });
  }
  if (policyDecision.status === "requires_approval") {
    if (intent)
      intent = await transitionExecutionIntent(args.intentsDir!, intent.id, "cancelled", {
        spendReservation: { ...intent.spendReservation!, active: false },
        outcome: { changedOnChain: false, safeToRetry: false, reason: "interactive_approval_not_supported" }
      });
    throw new StellarAgentError({
      code: "APPROVAL_REQUIRED",
      message: "MPP charge requires approval.",
      docs: "docs/x402-and-mpp.md#local-mpp-demo",
      details: { ...(intent ? { intentId: intent.id } : {}), changedOnChain: false, safeToRetry: false }
    });
  }
  if (args.dryRun) {
    if (intent)
      intent = await transitionExecutionIntent(args.intentsDir!, intent.id, "cancelled", {
        spendReservation: { ...intent.spendReservation!, active: false },
        outcome: { changedOnChain: false, safeToRetry: true, reason: "dry_run" }
      });
    return {
      firstStatus: 402,
      finalStatus: 402,
      charge,
      policyDecision,
      ...(intent === undefined ? {} : { intent })
    };
  }
  if (intent) {
    intent = await claimExecutionIntent(args.intentsDir!, intent.id);
    intent = await transitionExecutionIntent(args.intentsDir!, intent.id, "approved");
  }
  let transaction;
  try {
    transaction = await sendPaymentImpl({
      source: args.source,
      destination: charge.recipient,
      amount: charge.amount,
      asset: charge.asset,
      ...(charge.memo === undefined ? {} : { memo: charge.memo }),
      profile: args.profile,
      ...(args.intentsDir === undefined ? {} : { executionLockPath: mppSequenceLock(args.intentsDir, args.source.publicKey) }),
      ...(intent === undefined
        ? {}
        : {
            lifecycle: mppIntentLifecycle(args.intentsDir!, intent.id, (next) => {
              intent = next;
            })
          })
    });
  } catch (error) {
    if (intent) await failMppIntent(args.intentsDir!, intent.id, error);
    throw error;
  }
  if (intent) intent = await confirmMppIntent(args.intentsDir!, intent, transaction);
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
    eventLog: args.eventLog,
    ...(intent === undefined
      ? {}
      : {
          intentId: intent.id,
          ...(intent.idempotencyKeyHash === undefined ? {} : { idempotencyKeyHash: intent.idempotencyKeyHash }),
          outcome: { status: "confirmed", changedOnChain: true, safeToRetry: false },
          ...(intent.submission?.attempts === undefined ? {} : { attempts: intent.submission.attempts })
        })
  });
  if (intent)
    intent = await updateExecutionIntent(args.intentsDir!, intent.id, (current) => ({
      ...current,
      receiptPath
    }));
  await appendEvent(args.eventLog, {
    event: "receipt_written",
    status: paidResourceDelivered ? "success" : "paid_resource_failed",
    command: args.command,
    profile: "testnet",
    data: {
      receiptPath,
      transactionHash: transaction.hash,
      finalStatus: paid.status,
      chargeId: charge.chargeId,
      paidResourceDelivered
    }
  });
  return {
    firstStatus: 402,
    finalStatus: paid.status,
    charge,
    policyDecision,
    transaction,
    receiptPath,
    responseBody,
    paidResourceDelivered,
    ...(intent === undefined ? {} : { intent })
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
  intentsDir?: string;
  idempotencyKey?: string;
  sessionStateDir?: string;
  spendHistory?: SpendHistory;
  loadSpendHistory?: (request: PaymentRequest, excludeIntentId?: string) => Promise<SpendHistory>;
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
  let intent = args.intentsDir ? await prepareMppIntent(args.intentsDir, args.command, args.profile, args.idempotencyKey, request, { resource: session.resource }) : undefined;
  if (intent?.status === "confirmed") {
    return {
      firstStatus: 402,
      finalStatus: 402,
      requestCount,
      successfulRequests: 0,
      session,
      policyDecision: { status: intent.policy?.status ?? "allowed", network: "testnet", realFunds: false, matchedRules: intent.policy?.matchedRules ?? ["idempotent_replay"], reasons: ["Existing confirmed session funding was not resubmitted; requests were not replayed."] },
      paidResourceDelivered: false,
      responses: [{ status: 402, body: "" }],
      intent
    };
  }
  const history = args.loadSpendHistory ? await args.loadSpendHistory(request, intent?.id) : args.spendHistory;
  const policyDecision = evaluatePaymentRequest(args.policy, request, history);
  if (intent && !["policy_checked", "approved"].includes(intent.status))
    intent = await transitionExecutionIntent(args.intentsDir!, intent.id, "policy_checked", {
      policy: { status: policyDecision.status, matchedRules: policyDecision.matchedRules }
    });
  await appendEvent(args.eventLog, {
    event: "policy_decision",
    status: policyDecision.status,
    command: args.command,
    profile: "testnet",
    data: { request, session, policyDecision }
  });
  if (policyDecision.status === "denied") {
    if (intent)
      await transitionExecutionIntent(args.intentsDir!, intent.id, "denied", {
        spendReservation: { ...intent.spendReservation!, active: false },
        outcome: { changedOnChain: false, safeToRetry: false, reason: "policy_denied" }
      });
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "MPP session budget was denied by policy.",
      hint: "Allow the target domain and session budget intentionally before paying.",
      docs: "docs/x402-and-mpp.md#local-mpp-session-demo"
    });
  }
  if (policyDecision.status === "requires_approval") {
    if (intent)
      intent = await transitionExecutionIntent(args.intentsDir!, intent.id, "cancelled", {
        spendReservation: { ...intent.spendReservation!, active: false },
        outcome: { changedOnChain: false, safeToRetry: false, reason: "interactive_approval_not_supported" }
      });
    throw new StellarAgentError({
      code: "APPROVAL_REQUIRED",
      message: "MPP session budget requires approval.",
      docs: "docs/x402-and-mpp.md#local-mpp-session-demo",
      details: { ...(intent ? { intentId: intent.id } : {}), changedOnChain: false, safeToRetry: false }
    });
  }
  if (args.dryRun) {
    if (intent)
      intent = await transitionExecutionIntent(args.intentsDir!, intent.id, "cancelled", {
        spendReservation: { ...intent.spendReservation!, active: false },
        outcome: { changedOnChain: false, safeToRetry: true, reason: "dry_run" }
      });
    return {
      firstStatus: 402,
      finalStatus: 402,
      requestCount,
      successfulRequests: 0,
      session,
      policyDecision,
      responses: [],
      ...(intent === undefined ? {} : { intent })
    };
  }
  if (intent) {
    intent = await claimExecutionIntent(args.intentsDir!, intent.id);
    intent = await transitionExecutionIntent(args.intentsDir!, intent.id, "approved");
  }
  let transaction;
  try {
    transaction = await sendPaymentImpl({
      source: args.source,
      destination: session.recipient,
      amount: session.budget,
      asset: session.asset,
      ...(session.memo === undefined ? {} : { memo: session.memo }),
      profile: args.profile,
      ...(args.intentsDir === undefined ? {} : { executionLockPath: mppSequenceLock(args.intentsDir, args.source.publicKey) }),
      ...(intent === undefined
        ? {}
        : {
            lifecycle: mppIntentLifecycle(args.intentsDir!, intent.id, (next) => {
              intent = next;
            })
          })
    });
  } catch (error) {
    if (intent) await failMppIntent(args.intentsDir!, intent.id, error);
    throw error;
  }
  if (intent) intent = await confirmMppIntent(args.intentsDir!, intent, transaction);
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
    if (args.sessionStateDir) {
      await reserveMppSessionDebit({
        path: mppSessionStatePath(args.sessionStateDir, session.sessionId),
        session: {
          sessionId: session.sessionId,
          networkPassphraseHash: createNetworkHash(args.profile.networkPassphrase),
          asset: session.asset,
          budget: session.budget,
          recipient: session.recipient,
          facilitatorOrigin: new URL(args.url).origin
        },
        amount: session.pricePerRequest
      });
    }
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
    eventLog: args.eventLog,
    ...(intent === undefined
      ? {}
      : {
          intentId: intent.id,
          ...(intent.idempotencyKeyHash === undefined ? {} : { idempotencyKeyHash: intent.idempotencyKeyHash }),
          outcome: { status: "confirmed", changedOnChain: true, safeToRetry: false },
          ...(intent.submission?.attempts === undefined ? {} : { attempts: intent.submission.attempts })
        })
  });
  if (intent)
    intent = await updateExecutionIntent(args.intentsDir!, intent.id, (current) => ({
      ...current,
      receiptPath
    }));
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
    responses,
    ...(intent === undefined ? {} : { intent })
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
  if (candidate.protocol !== "stellar-agent-local-mpp" || candidate.version !== 1 || candidate.network !== "testnet" || !candidate.chargeId || !candidate.recipient || !candidate.amount || !candidate.asset || !candidate.resource) {
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
  if (candidate.protocol !== "stellar-agent-local-mpp-session" || candidate.version !== 1 || candidate.network !== "testnet" || !candidate.sessionId || !candidate.recipient || !candidate.budget || !candidate.pricePerRequest || !candidate.asset || !candidate.resource) {
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

export async function startMppDemo(args: { recipient: string; amount?: string; asset?: string; port?: number; host?: string }): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const host = args.host ?? "127.0.0.1";
  const amount = args.amount ?? "0.0000001";
  const asset = args.asset ?? "XLM";
  parseAmount(amount, asset);
  const issuedCharges = new Map<string, MppCharge>();
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
        chargeId: makeId("mpp_charge"),
        network: "testnet",
        asset,
        amount,
        recipient: args.recipient,
        resource,
        memo: "mpp-demo"
      };
      issuedCharges.set(charge.chargeId, charge);
      const encoded = JSON.stringify(charge);
      response.setHeader("MPP-Charge", encoded);
      response.setHeader("X-MPP-Charge", encoded);
      writeJson(response, 402, charge);
      return;
    }
    const proof = parseProofHeader(proofHeader);
    const resource = mppResource(host, server);
    if (!proof || proof.protocol !== "stellar-agent-local-mpp" || proof.version !== 1 || !proof.transactionHash || !proof.payer) {
      writeJson(response, 402, { ok: false, error: "invalid_mpp_payment_proof" });
      return;
    }
    if (acceptedTransactions.has(proof.transactionHash)) {
      writeJson(response, 402, { ok: false, error: "mpp_payment_proof_replayed" });
      return;
    }
    const issuedCharge = proof.chargeId ? issuedCharges.get(proof.chargeId) : undefined;
    if (!issuedCharge) {
      writeJson(response, 402, { ok: false, error: "mpp_charge_not_issued" });
      return;
    }
    if (proof.recipient !== issuedCharge.recipient || proof.asset !== issuedCharge.asset || proof.amount !== parseAmount(issuedCharge.amount, issuedCharge.asset).value || proof.resource !== resource || proof.resource !== issuedCharge.resource) {
      writeJson(response, 402, { ok: false, error: "invalid_mpp_payment_proof" });
      return;
    }
    issuedCharges.delete(issuedCharge.chargeId);
    acceptedTransactions.add(proof.transactionHash);
    writeJson(response, 200, {
      ok: true,
      id: makeId("mpp_report"),
      message: "Local MPP one-time charge content unlocked.",
      paid: {
        chargeId: issuedCharge.chargeId,
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

export async function startMppSessionDemo(args: { recipient: string; budget?: string; pricePerRequest?: string; asset?: string; port?: number; host?: string }): Promise<{
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
  const issuedSessions = new Map<string, MppSessionRequirement>();
  const sessions = new Map<string, { session: MppSessionRequirement; remaining: bigint; spent: bigint; requests: number }>();
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
      const session = mppSessionRequirement({
        host,
        server,
        sessionId: makeId("mpp_session"),
        asset,
        budget: budgetAmount.value,
        pricePerRequest: requestAmount.value,
        recipient: args.recipient
      });
      issuedSessions.set(session.sessionId, session);
      writeSessionRequirement(response, session);
      return;
    }
    const proof = parseProofHeader(sessionHeader) as Partial<MppSessionProof> | null;
    if (!proof || proof.protocol !== "stellar-agent-local-mpp-session" || proof.version !== 1 || !proof.sessionId || !proof.transactionHash || !proof.payer) {
      writeJson(response, 402, { ok: false, error: "invalid_mpp_session_proof" });
      return;
    }
    let state = sessions.get(proof.transactionHash);
    const session = state?.session ?? issuedSessions.get(proof.sessionId);
    if (!session) {
      writeJson(response, 402, { ok: false, error: "mpp_session_not_issued" });
      return;
    }
    if (proof.sessionId !== session.sessionId || proof.recipient !== session.recipient || proof.asset !== session.asset || proof.budget !== session.budget || proof.pricePerRequest !== session.pricePerRequest || proof.resource !== session.resource || proof.resource !== sessionResource(host, server)) {
      writeJson(response, 402, { ok: false, error: "invalid_mpp_session_proof" });
      return;
    }
    if (!state) {
      issuedSessions.delete(session.sessionId);
      state = {
        session,
        remaining: budgetAmount.stroops,
        spent: 0n,
        requests: 0
      };
    }
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
      session,
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
        sessionId: session.sessionId,
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
    return await fetchImpl(url, { ...init, redirect: "error" });
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

function mppSessionRequirement(args: { host: string; server: ReturnType<typeof createServer>; sessionId: string; asset: string; budget: string; pricePerRequest: string; recipient: string }): MppSessionRequirement {
  return {
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
}

function writeSessionRequirement(response: ServerResponse, session: MppSessionRequirement): void {
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
  if (advertised.origin !== requested.origin || advertised.pathname !== requested.pathname || advertised.search !== requested.search) {
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
    return JSON.parse(Array.isArray(header) ? (header[0] ?? "{}") : (header ?? "{}"));
  } catch {
    return null;
  }
}

async function prepareMppIntent(intentsDir: string, command: string, profile: NetworkProfile, idempotencyKey: string | undefined, request: PaymentRequest, details: unknown) {
  const created = await createExecutionIntent(intentsDir, {
    command,
    profile: "testnet",
    networkPassphrase: profile.networkPassphrase,
    realFunds: false,
    operation: {
      type: "mpp.payment",
      ...(request.source === undefined ? {} : { source: request.source }),
      destination: request.destination,
      asset: request.asset,
      amount: request.amount,
      details
    },
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    spendReservation: {
      asset: request.asset,
      amount: request.amount,
      destination: request.destination,
      ...(request.domain === undefined ? {} : { domain: request.domain })
    }
  });
  if (!created.created) {
    if (created.intent.status === "confirmed" || ["proposed", "policy_checked", "approved"].includes(created.intent.status)) return created.intent;
    throw new StellarAgentError({
      code: "TRANSACTION_TIMEOUT",
      message: "This MPP payment may already have settled; reconcile its intent before retrying.",
      details: {
        intentId: created.intent.id,
        transactionHash: created.intent.transaction?.hash,
        changedOnChain: "unknown",
        safeToRetry: false
      }
    });
  }
  return created.intent;
}

function mppIntentLifecycle(intentsDir: string, intentId: string, setIntent: (intent: Awaited<ReturnType<typeof readExecutionIntent>>) => void) {
  return {
    onBuilt: async (built: { hash: string; signedXdr: string; source?: string; sequence?: string; expiresAt?: string }) =>
      setIntent(
        await transitionExecutionIntent(intentsDir, intentId, "signed", {
          transaction: {
            hash: built.hash,
            envelopeHash: built.hash,
            signedXdr: built.signedXdr,
            ...(built.source === undefined ? {} : { source: built.source }),
            ...(built.sequence === undefined ? {} : { sequence: built.sequence }),
            ...(built.expiresAt === undefined ? {} : { expiresAt: built.expiresAt })
          },
          outcome: { changedOnChain: false, safeToRetry: false }
        })
      ),
    onSubmission: async (attempt: { transport: "rpc" | "horizon"; endpoint: string; status: string; detail?: unknown }) =>
      setIntent(
        await updateExecutionIntent(intentsDir, intentId, (current) => ({
          ...current,
          status: attempt.status === "transport_unknown" ? "confirmation_unknown" : "submitted",
          submission: {
            attempts: [...(current.submission?.attempts ?? []), { ...attempt, at: new Date().toISOString() }]
          },
          outcome: { changedOnChain: "unknown", safeToRetry: false }
        }))
      )
  };
}

async function failMppIntent(intentsDir: string, intentId: string, error: unknown): Promise<void> {
  const current = await readExecutionIntent(intentsDir, intentId);
  if (["submitted", "confirmation_unknown"].includes(current.status)) return;
  await transitionExecutionIntent(intentsDir, intentId, "failed", {
    ...(current.spendReservation ? { spendReservation: { ...current.spendReservation, active: false } } : {}),
    outcome: {
      changedOnChain: false,
      safeToRetry: false,
      reason: error instanceof Error ? error.name : "unknown"
    }
  });
}

function createNetworkHash(passphrase: string): string {
  return createHash("sha256").update(passphrase).digest("hex");
}

function mppSequenceLock(intentsDir: string, source: string): string {
  return join(intentsDir, "sequences", createHash("sha256").update(`testnet:${source}`).digest("hex"));
}

async function confirmMppIntent(intentsDir: string, intent: Awaited<ReturnType<typeof readExecutionIntent>>, transaction: { hash: string }) {
  let current = intent;
  if (current.status === "approved")
    current = await transitionExecutionIntent(intentsDir, current.id, "signed", {
      transaction: { hash: transaction.hash, envelopeHash: transaction.hash },
      outcome: { changedOnChain: false, safeToRetry: false }
    });
  if (current.status === "signed")
    current = await transitionExecutionIntent(intentsDir, current.id, "submitted", {
      outcome: { changedOnChain: "unknown", safeToRetry: false }
    });
  return transitionExecutionIntent(intentsDir, current.id, "confirmed", {
    spendReservation: { ...current.spendReservation!, active: false },
    outcome: { changedOnChain: true, safeToRetry: false }
  });
}

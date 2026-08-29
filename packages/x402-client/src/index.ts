import { NetworkProfile, TESTNET_PROFILE, PaymentRequest, StellarAgentError, TestnetWallet, makeId, parseAmount, withFileLock, writeFileAtomic } from "@stellar-agent/core";
import { appendEvent, claimExecutionIntent, createExecutionIntent, readExecutionIntent, transitionExecutionIntent, updateExecutionIntent, writeReceipt } from "@stellar-agent/ledger-logger";
import { Policy, SpendHistory, evaluatePaymentRequest } from "@stellar-agent/policy";
import { sendPayment } from "@stellar-agent/stellar";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface X402FacilitatorBinding {
  protocol: "stellar-agent-facilitated-x402";
  version: 1;
  url: string;
  networkPassphraseHash: string;
}

export interface X402FacilitatorSettlement {
  protocol: "stellar-agent-facilitated-x402";
  version: 1;
  verified: boolean;
  transactionHash: string;
  networkPassphraseHash: string;
  recipient: string;
  asset: string;
  amount: string;
  challengeId: string;
  ledger?: number;
}

/** Verify an untrusted facilitator response against the locally pinned challenge. */
export async function verifyWithX402Facilitator(args: { facilitator: X402FacilitatorBinding; proof: X402PaymentProof; challengeId: string; replayStorePath: string; fetchImpl?: typeof fetch; allowInsecureLocalhost?: boolean }): Promise<X402FacilitatorSettlement> {
  const endpoint = new URL("/verify", assertFacilitatorUrl(args.facilitator.url, args.allowInsecureLocalhost));
  const response = await (args.fetchImpl ?? fetch)(endpoint, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocol: args.facilitator.protocol,
      version: args.facilitator.version,
      networkPassphraseHash: args.facilitator.networkPassphraseHash,
      challengeId: args.challengeId,
      proof: args.proof
    }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw facilitatorError("The x402 facilitator rejected or could not verify the proof.", response.status);
  const settlement = (await response.json()) as X402FacilitatorSettlement;
  if (settlement.protocol !== args.facilitator.protocol || settlement.version !== 1 || settlement.verified !== true || settlement.transactionHash !== args.proof.transactionHash || settlement.networkPassphraseHash !== args.facilitator.networkPassphraseHash || settlement.recipient !== args.proof.recipient || settlement.asset !== args.proof.asset || parseAmount(settlement.amount).stroops !== parseAmount(args.proof.amount).stroops || settlement.challengeId !== args.challengeId)
    throw facilitatorError("The x402 facilitator returned a settlement that does not match the pinned proof.");
  await recordFacilitatedReplay(args.replayStorePath, `${settlement.challengeId}:${settlement.transactionHash}`);
  return settlement;
}

function assertFacilitatorUrl(value: string, allowInsecureLocalhost = false): string {
  const url = new URL(value);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(allowInsecureLocalhost && local)) {
    throw facilitatorError("Facilitator URLs must use HTTPS; HTTP is allowed only for explicitly enabled localhost tests.");
  }
  if (url.username || url.password) throw facilitatorError("Facilitator URLs cannot contain credentials.");
  return url.toString();
}

async function recordFacilitatedReplay(path: string, key: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await withFileLock(path, async () => {
    let seen: string[] = [];
    try {
      seen = JSON.parse(await readFile(path, "utf8")) as string[];
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw facilitatorError("The x402 replay store is unreadable and verification failed closed.");
    }
    if (!Array.isArray(seen) || seen.some((item) => typeof item !== "string")) {
      throw facilitatorError("The x402 replay store is corrupt and verification failed closed.");
    }
    if (seen.includes(key)) throw facilitatorError("The x402 facilitator proof has already been accepted.");
    await writeFileAtomic(path, `${JSON.stringify([...seen, key], null, 2)}\n`, { mode: 0o600 });
  });
}

function facilitatorError(message: string, status?: number): StellarAgentError {
  return new StellarAgentError({
    code: "INVALID_INPUT",
    message,
    docs: "docs/x402-and-mpp.md#facilitator-adapters",
    ...(status === undefined ? {} : { details: { status } })
  });
}

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
      error: "invalid_payment_proof" | "payment_nonce_expired" | "payment_proof_replayed" | "payment_settlement_unavailable" | "payment_not_successful" | "payment_operation_mismatch";
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
  intent?: Awaited<ReturnType<typeof readExecutionIntent>>;
}

export async function runX402Payment(args: { url: string; source: TestnetWallet; policy: Policy; profile: NetworkProfile; receiptsDir: string; eventLog: string; command: string; dryRun?: boolean; intentsDir?: string; idempotencyKey?: string; spendHistory?: SpendHistory; loadSpendHistory?: (request: PaymentRequest, excludeIntentId?: string) => Promise<SpendHistory>; fetchImpl?: typeof fetch; sendPaymentImpl?: typeof sendPayment }): Promise<X402PaymentResult> {
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
  let intent: Awaited<ReturnType<typeof readExecutionIntent>> | undefined;
  if (args.intentsDir) {
    const created = await createExecutionIntent(args.intentsDir, {
      command: args.command,
      profile: "testnet",
      networkPassphrase: args.profile.networkPassphrase,
      realFunds: false,
      operation: {
        type: "x402.payment",
        source: args.source.publicKey,
        destination: request.destination,
        asset: request.asset,
        amount: request.amount,
        details: { resource: requirement.resource }
      },
      ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
      spendReservation: {
        asset: request.asset,
        amount: request.amount,
        destination: request.destination,
        domain: new URL(args.url).host
      }
    });
    intent = created.intent;
    if (!created.created && intent.status === "confirmed")
      return {
        firstStatus: 402,
        finalStatus: 402,
        requirement,
        policyDecision: {
          status: intent.policy?.status ?? "allowed",
          network: "testnet",
          realFunds: false,
          matchedRules: intent.policy?.matchedRules ?? ["idempotent_replay"],
          reasons: ["Existing confirmed payment was not resubmitted; resource delivery was not replayed."]
        },
        paidResourceDelivered: false,
        intent
      };
    if (!created.created && ["signed", "submitted", "confirmation_unknown"].includes(intent.status)) {
      throw new StellarAgentError({
        code: "TRANSACTION_TIMEOUT",
        message: "This x402 payment may already have settled; reconcile its intent before retrying.",
        details: {
          intentId: intent.id,
          transactionHash: intent.transaction?.hash,
          changedOnChain: "unknown",
          safeToRetry: false
        }
      });
    }
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
    data: { request, requirement, policyDecision }
  });
  if (policyDecision.status === "denied") {
    if (intent)
      await transitionExecutionIntent(args.intentsDir!, intent.id, "denied", {
        spendReservation: { ...intent.spendReservation!, active: false },
        outcome: { changedOnChain: false, safeToRetry: false, reason: "policy_denied" }
      });
    throw new StellarAgentError({
      code: "POLICY_DENIED",
      message: "x402 payment request was denied by policy.",
      hint: "Enable x402 and allow the target domain in policy when appropriate.",
      docs: "docs/x402-and-mpp.md#local-x402-demo"
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
      message: "x402 payment requires approval.",
      docs: "docs/x402-and-mpp.md#local-x402-demo",
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
      requirement,
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
      destination: requirement.recipient,
      amount: requirement.amount,
      asset: requirement.asset,
      ...(requirement.memo === undefined ? {} : { memo: requirement.memo }),
      profile: args.profile,
      ...(args.intentsDir === undefined ? {} : { executionLockPath: paymentSequenceLock(args.intentsDir, args.source.publicKey) }),
      ...(intent === undefined
        ? {}
        : {
            lifecycle: durableLifecycle(args.intentsDir!, intent.id, (next) => {
              intent = next;
            })
          })
    });
  } catch (error) {
    if (intent) await failDurableIntent(args.intentsDir!, intent.id, error);
    throw error;
  }
  if (intent) intent = await confirmDurableIntent(args.intentsDir!, intent, transaction);
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
      paidResourceDelivered
    }
  });
  return {
    firstStatus: 402,
    finalStatus: paid.status,
    requirement,
    policyDecision,
    transaction,
    receiptPath,
    responseBody,
    paidResourceDelivered,
    ...(intent === undefined ? {} : { intent })
  };
}

function durableLifecycle(intentsDir: string, intentId: string, setIntent: (intent: Awaited<ReturnType<typeof readExecutionIntent>>) => void) {
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

async function failDurableIntent(intentsDir: string, intentId: string, error: unknown): Promise<void> {
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

function paymentSequenceLock(intentsDir: string, source: string): string {
  return join(intentsDir, "sequences", createHash("sha256").update(`testnet:${source}`).digest("hex"));
}

async function confirmDurableIntent(intentsDir: string, intent: Awaited<ReturnType<typeof readExecutionIntent>>, transaction: { hash: string }) {
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

async function fetchResource(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, redirect: "error" });
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
  const header = response.headers.get("Payment-Required") ?? response.headers.get("PAYMENT-REQUIRED") ?? response.headers.get("X-Payment-Required") ?? response.headers.get("X-Payment");
  const parsed = header ? JSON.parse(header) : await response.json();
  return validateRequirement(parsed);
}

export function validateRequirement(value: unknown): X402PaymentRequirement {
  const candidate = value as Partial<X402PaymentRequirement>;
  if (candidate.protocol !== "stellar-agent-local-x402" || candidate.version !== 1 || candidate.network !== "testnet" || !candidate.recipient || !candidate.amount || !candidate.asset || !candidate.resource || !candidate.nonce) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "HTTP 402 response did not include a supported x402 payment requirement.",
      docs: "docs/x402-and-mpp.md#local-x402-demo"
    });
  }
  parseAmount(candidate.amount, candidate.asset);
  const expectedMemo = x402ChallengeMemo({
    resource: candidate.resource,
    nonce: candidate.nonce
  });
  if (candidate.memo !== undefined && candidate.memo !== expectedMemo) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "HTTP 402 response included an x402 memo that was not bound to the challenge.",
      docs: "docs/x402-and-mpp.md#local-x402-demo"
    });
  }
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
    memo: expectedMemo
  };
}

export async function verifyX402PaymentProof(args: { proof: X402PaymentProof; requirement: X402PaymentRequirement; acceptedTransactions?: Set<string>; mode?: "horizon" | "mock"; now?: Date; maxChallengeAgeMs?: number; horizonUrl?: string | null; fetchImpl?: typeof fetch; loadPayment?: X402PaymentLoader }): Promise<X402PaymentVerification> {
  const expectedAmount = parseAmount(args.requirement.amount, args.requirement.asset).value;
  let proofAmount: string;
  try {
    proofAmount = parseAmount(args.proof.amount, args.proof.asset).value;
  } catch {
    return { ok: false, error: "invalid_payment_proof" };
  }
  if (args.proof.protocol !== args.requirement.protocol || args.proof.version !== args.requirement.version || !/^[a-f0-9]{64}$/i.test(args.proof.transactionHash) || !args.proof.payer || args.requirement.network !== "testnet" || args.proof.recipient !== args.requirement.recipient || args.proof.asset !== args.requirement.asset || proofAmount !== expectedAmount || args.proof.resource !== args.requirement.resource || args.proof.nonce !== args.requirement.nonce) {
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

  const operation = payment.operations.find((candidate) => candidate.source === args.proof.payer && candidate.destination === args.requirement.recipient && candidate.asset === args.requirement.asset && parseAmount(candidate.amount, candidate.asset).value === expectedAmount);
  if (!operation) return { ok: false, error: "payment_operation_mismatch" };
  if (payment.memo !== x402ChallengeMemo(args.requirement)) {
    return { ok: false, error: "payment_operation_mismatch" };
  }

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

export function x402ChallengeMemo(requirement: Pick<X402PaymentRequirement, "nonce" | "resource">): string {
  return `x402:${createHash("sha256").update(`${requirement.nonce}\0${requirement.resource}`).digest("hex").slice(0, 22)}`;
}

export async function loadX402PaymentFromHorizon(args: { transactionHash: string; horizonUrl?: string | null; fetchImpl?: typeof fetch }): Promise<X402VerifiedPayment | null> {
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
    memo: x402ChallengeMemo(proof),
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

export async function startPaidApiDemo(args: { recipient: string; amount?: string; asset?: string; port?: number; host?: string; verificationMode?: "mock" | "horizon"; horizonUrl?: string | null; loadPayment?: X402PaymentLoader }): Promise<{
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
        expiresAt: new Date(issuedAt.getTime() + maxChallengeAgeMs).toISOString()
      };
      requirement.memo = x402ChallengeMemo(requirement);
      issuedRequirements.set(requirement.nonce, requirement);
      const encoded = JSON.stringify(requirement);
      response.setHeader("Payment-Required", encoded);
      response.setHeader("X-Payment-Required", encoded);
      writeJson(response, 402, requirement);
      return;
    }
    const proof = parseProofHeader(proofHeader);
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
    return JSON.parse(Array.isArray(header) ? (header[0] ?? "{}") : (header ?? "{}"));
  } catch {
    return null;
  }
}

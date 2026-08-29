import { NetworkName, PaymentRequest, StellarAgentError, formatStroops, makeId, nowIso, parseAmount, redactSensitive, resolvePath, withFileLock, writeFileAtomic } from "@stellar-agent/core";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ExecutionIntentStatus = "proposed" | "policy_checked" | "simulated" | "awaiting_approval" | "approved" | "signed" | "submitted" | "confirmation_unknown" | "confirmed" | "denied" | "expired" | "failed" | "cancelled";

export interface ExecutionIntent {
  schemaVersion: "stellar-agent.intent.v1";
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  command: string;
  profile: NetworkName;
  network: { passphrase: string; realFunds: boolean };
  status: ExecutionIntentStatus;
  idempotencyKeyHash?: string;
  semanticHash: string;
  operation: {
    type: string;
    source?: string;
    destination?: string;
    asset?: string;
    amount?: string;
    details?: unknown;
  };
  policy?: {
    status: "allowed" | "denied" | "requires_approval";
    fingerprint?: string;
    matchedRules: string[];
  };
  simulation?: {
    successful: boolean;
    latestLedger?: number;
    fingerprint?: string;
    expiresAtLedger?: number;
  };
  approval?: {
    id: string;
    status: "pending" | "claimed" | "consumed";
    requestHash: string;
    transactionHash?: string;
    policyFingerprint?: string;
    expiresAt?: string;
  };
  transaction?: {
    source?: string;
    sequence?: string;
    unsignedXdr?: string;
    signedXdr?: string;
    bodyHash?: string;
    envelopeHash?: string;
    hash?: string;
    expiresAt?: string;
  };
  submission?: {
    attempts: Array<{
      at: string;
      transport: "rpc" | "horizon";
      endpoint: string;
      status: string;
      detail?: unknown;
    }>;
    lastReconciledAt?: string;
  };
  spendReservation?: {
    active: boolean;
    asset: string;
    amount: string;
    destination?: string;
    domain?: string;
  };
  outcome?: {
    changedOnChain: boolean | "unknown";
    safeToRetry: boolean;
    reason?: string;
  };
  receiptPath?: string;
  execution?: {
    owner: string;
    claimedAt: string;
    expiresAt: string;
  };
}

export interface CreateExecutionIntentInput {
  command: string;
  profile: NetworkName;
  networkPassphrase: string;
  realFunds: boolean;
  operation: ExecutionIntent["operation"];
  idempotencyKey?: string;
  spendReservation?: Omit<NonNullable<ExecutionIntent["spendReservation"]>, "active">;
}

const intentTransitions: Record<ExecutionIntentStatus, ReadonlySet<ExecutionIntentStatus>> = {
  proposed: new Set(["policy_checked", "awaiting_approval", "approved", "denied", "cancelled", "failed"]),
  policy_checked: new Set(["simulated", "awaiting_approval", "approved", "denied", "cancelled", "failed"]),
  simulated: new Set(["awaiting_approval", "approved", "signed", "denied", "expired", "cancelled", "failed"]),
  awaiting_approval: new Set(["approved", "denied", "expired", "cancelled"]),
  approved: new Set(["signed", "expired", "cancelled", "failed"]),
  signed: new Set(["submitted", "confirmation_unknown", "expired", "failed"]),
  submitted: new Set(["confirmed", "confirmation_unknown", "failed", "expired"]),
  confirmation_unknown: new Set(["submitted", "confirmed", "failed", "expired"]),
  confirmed: new Set(),
  denied: new Set(),
  expired: new Set(),
  failed: new Set(),
  cancelled: new Set()
};

export async function createExecutionIntent(intentsDir: string, input: CreateExecutionIntentInput): Promise<{ intent: ExecutionIntent; created: boolean }> {
  const dir = resolvePath(intentsDir);
  const semanticHash = hashCanonical({
    command: input.command,
    profile: input.profile,
    networkPassphrase: input.networkPassphrase,
    operation: input.operation
  });
  const idempotencyKeyHash = input.idempotencyKey ? hashCanonical(input.idempotencyKey) : undefined;
  return withFileLock(join(dir, ".store"), async () => {
    await mkdir(join(dir, "idempotency"), { recursive: true });
    if (idempotencyKeyHash) {
      const indexPath = join(dir, "idempotency", `${idempotencyKeyHash}.json`);
      try {
        const index = JSON.parse(await readFile(indexPath, "utf8")) as {
          intentId?: string;
          semanticHash?: string;
        };
        if (!index.intentId || index.semanticHash !== semanticHash) {
          throw new StellarAgentError({
            code: "INVALID_INPUT",
            message: "Idempotency key was already used for a different operation.",
            details: { idempotencyKeyHash }
          });
        }
        return { intent: await readExecutionIntent(dir, index.intentId), created: false };
      } catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
      }
      // Recover an intent durably written just before a process crashed while writing its secondary index.
      const existing = (await listExecutionIntents(dir)).find((candidate) => candidate.idempotencyKeyHash === idempotencyKeyHash);
      if (existing) {
        if (existing.semanticHash !== semanticHash) {
          throw new StellarAgentError({
            code: "INVALID_INPUT",
            message: "Idempotency key was already used for a different operation.",
            details: { idempotencyKeyHash }
          });
        }
        await writeFileAtomic(indexPath, `${JSON.stringify({ intentId: existing.id, semanticHash }, null, 2)}\n`, { mode: 0o600 });
        return { intent: existing, created: false };
      }
    }

    const now = nowIso();
    const intent: ExecutionIntent = {
      schemaVersion: "stellar-agent.intent.v1",
      id: makeId("int"),
      revision: 1,
      createdAt: now,
      updatedAt: now,
      command: input.command,
      profile: input.profile,
      network: { passphrase: input.networkPassphrase, realFunds: input.realFunds },
      status: "proposed",
      ...(idempotencyKeyHash === undefined ? {} : { idempotencyKeyHash }),
      semanticHash,
      operation: redactSensitive(input.operation),
      ...(input.spendReservation === undefined ? {} : { spendReservation: { active: true, ...redactSensitive(input.spendReservation) } }),
      outcome: { changedOnChain: false, safeToRetry: true }
    };
    assertNoSecrets(intent);
    await writeFileAtomic(intentPath(dir, intent.id), `${JSON.stringify(intent, null, 2)}\n`, {
      mode: 0o600
    });
    if (idempotencyKeyHash) {
      await writeFileAtomic(join(dir, "idempotency", `${idempotencyKeyHash}.json`), `${JSON.stringify({ intentId: intent.id, semanticHash }, null, 2)}\n`, { mode: 0o600 });
    }
    return { intent, created: true };
  });
}

export async function readExecutionIntent(intentsDir: string, id: string): Promise<ExecutionIntent> {
  try {
    const parsed = JSON.parse(await readFile(intentPath(intentsDir, id), "utf8"));
    return verifyExecutionIntent(parsed);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: `Execution intent '${id}' was not found.`
      });
    }
    throw error;
  }
}

export async function listExecutionIntents(intentsDir: string): Promise<ExecutionIntent[]> {
  const dir = resolvePath(intentsDir);
  try {
    const entries = (await readdir(dir)).filter((entry) => /^int_[a-zA-Z0-9_-]+\.json$/.test(entry));
    const intents = await Promise.all(entries.map((entry) => readExecutionIntent(dir, entry.slice(0, -5))));
    return intents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function updateExecutionIntent(intentsDir: string, id: string, update: (current: ExecutionIntent) => ExecutionIntent): Promise<ExecutionIntent> {
  const path = intentPath(intentsDir, id);
  return withFileLock(path, async () => {
    const current = await readExecutionIntent(intentsDir, id);
    const candidate = update(structuredClone(current));
    if (candidate.id !== current.id || candidate.schemaVersion !== current.schemaVersion) {
      throw new StellarAgentError({
        code: "CONFIG_INVALID",
        message: "Execution intent identity cannot be changed."
      });
    }
    if (candidate.status !== current.status && !intentTransitions[current.status].has(candidate.status)) {
      throw new StellarAgentError({
        code: "CONFIG_INVALID",
        message: `Invalid execution intent transition from ${current.status} to ${candidate.status}.`,
        details: { intentId: id, revision: current.revision }
      });
    }
    candidate.revision = current.revision + 1;
    candidate.updatedAt = nowIso();
    const verified = verifyExecutionIntent(redactSensitive(candidate));
    assertNoSecrets(verified);
    await writeFileAtomic(path, `${JSON.stringify(verified, null, 2)}\n`, { mode: 0o600 });
    return verified;
  });
}

export async function transitionExecutionIntent(intentsDir: string, id: string, status: ExecutionIntentStatus, patch: Partial<Omit<ExecutionIntent, "id" | "schemaVersion" | "revision" | "createdAt" | "updatedAt" | "status">> = {}): Promise<ExecutionIntent> {
  return updateExecutionIntent(intentsDir, id, (current) => ({ ...current, ...patch, status }));
}

export async function claimExecutionIntent(intentsDir: string, id: string, owner = makeId("exec")): Promise<ExecutionIntent> {
  return updateExecutionIntent(intentsDir, id, (current) => {
    if (current.execution && Date.parse(current.execution.expiresAt) > Date.now()) {
      throw new StellarAgentError({
        code: "TRANSACTION_TIMEOUT",
        message: "This execution intent is already owned by another worker.",
        details: { intentId: id, changedOnChain: current.outcome?.changedOnChain ?? false, safeToRetry: false }
      });
    }
    if (!["proposed", "policy_checked", "awaiting_approval", "approved"].includes(current.status)) {
      throw new StellarAgentError({ code: "INVALID_INPUT", message: `Execution intent in status ${current.status} cannot be claimed.`, details: { intentId: id } });
    }
    const claimedAt = nowIso();
    return { ...current, execution: { owner, claimedAt, expiresAt: new Date(Date.parse(claimedAt) + 5 * 60_000).toISOString() } };
  });
}

export function verifyExecutionIntent(value: unknown): ExecutionIntent {
  const intent = value as ExecutionIntent;
  if (!intent || intent.schemaVersion !== "stellar-agent.intent.v1" || typeof intent.id !== "string" || !/^int_[a-zA-Z0-9_-]+$/.test(intent.id) || !Number.isInteger(intent.revision) || intent.revision < 1 || !intentTransitions[intent.status] || typeof intent.semanticHash !== "string" || !intent.operation?.type) {
    throw new StellarAgentError({
      code: "CONFIG_INVALID",
      message: "Execution intent is invalid or corrupted."
    });
  }
  assertNoSecrets(intent);
  return intent;
}

export async function activeSpendReservations(intentsDir: string, options: { profile?: NetworkName; asset?: string } = {}): Promise<Array<{ intentId: string; amount: string; asset: string; destination?: string; domain?: string }>> {
  const intents = await listExecutionIntents(intentsDir);
  return intents.flatMap((intent) => {
    const reservation = intent.spendReservation;
    // A confirmed intent is still charged until its receipt link is durable, closing the
    // crash window between ledger confirmation and receipt persistence.
    if (!reservation || (!reservation.active && !(intent.status === "confirmed" && !intent.receiptPath))) return [];
    if (options.profile && intent.profile !== options.profile) return [];
    if (options.asset && reservation.asset.toUpperCase() !== options.asset.toUpperCase()) return [];
    return [
      {
        intentId: intent.id,
        amount: reservation.amount,
        asset: reservation.asset,
        ...(reservation.destination === undefined ? {} : { destination: reservation.destination }),
        ...(reservation.domain === undefined ? {} : { domain: reservation.domain })
      }
    ];
  });
}

function intentPath(intentsDir: string, id: string): string {
  if (!/^int_[a-zA-Z0-9_-]+$/.test(id)) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Execution intent id is invalid."
    });
  }
  return join(resolvePath(intentsDir), `${id}.json`);
}

function hashCanonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortCanonical(value)))
    .digest("hex");
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortCanonical(child)])
  );
}

export interface EventLogEntry {
  schemaVersion: "stellar-agent.event.v2";
  id: string;
  at: string;
  event: "command_started" | "command_finished" | "policy_decision" | "approval_requested" | "approval_granted" | "approval_denied" | "transaction_built" | "transaction_signed" | "transaction_submitted" | "transaction_confirmed" | "transaction_failed" | "receipt_written" | "error";
  status?: string;
  command?: string;
  profile?: NetworkName;
  requestId?: string;
  message?: string;
  data?: unknown;
  previousHash?: string;
  contentHash: string;
}

export interface PaymentReceipt {
  schemaVersion: "stellar-agent.receipt.v1" | "stellar-agent.receipt.v2";
  id: string;
  createdAt: string;
  command: string;
  profile: NetworkName;
  network: {
    name: NetworkName;
    passphrase: string;
    realFunds: boolean;
  };
  payment?: {
    source: string;
    destination: string;
    asset: string;
    amount: string;
    memo?: string;
    domain?: string;
    url?: string;
  };
  operation?: {
    type: string;
    source?: string;
    account?: string;
    asset?: string;
    amount?: string;
    destination?: string;
    claimant?: string;
    claimants?: string[];
    balanceId?: string;
    limit?: string;
    predicate?: unknown;
    details?: unknown;
  };
  policyDecision: ReceiptPolicyDecision;
  transaction: {
    hash: string;
    ledger?: number;
    successful: boolean;
    feeCharged?: string;
    bodyHash?: string;
    envelopeHash?: string;
    transport?: "rpc" | "horizon";
  };
  ledger?: {
    latestLedgerBefore?: number;
    confirmedLedger?: number;
  };
  files?: {
    eventLog?: string;
  };
  redactions: {
    urlQueryParamsRedacted: boolean;
    secretKeysIncluded: false;
  };
  intentId?: string;
  idempotencyKeyHash?: string;
  outcome?: {
    status: "confirmed" | "failed" | "confirmation_unknown" | "expired" | "cancelled";
    changedOnChain: boolean | "unknown";
    safeToRetry: boolean;
  };
  attempts?: NonNullable<ExecutionIntent["submission"]>["attempts"];
  integrity?: {
    algorithm: "sha256";
    previousReceiptHash?: string;
    contentHash: string;
  };
}

export interface ReceiptPolicyDecision {
  status: "allowed" | "denied" | "requires_approval";
  matchedRules: string[];
}

export interface ReceiptInput {
  command: string;
  profile: NetworkName;
  networkPassphrase: string;
  realFunds: boolean;
  payment?: Required<Pick<PaymentRequest, "destination" | "asset" | "amount">> & {
    source: string;
    memo?: string;
    domain?: string;
    url?: string;
  };
  operation?: PaymentReceipt["operation"];
  policyDecision: ReceiptPolicyDecision;
  transaction: PaymentReceipt["transaction"];
  ledger?: PaymentReceipt["ledger"];
  eventLog?: string;
  intentId?: string;
  idempotencyKeyHash?: string;
  outcome?: NonNullable<PaymentReceipt["outcome"]>;
  attempts?: NonNullable<PaymentReceipt["attempts"]>;
}

export interface ReceiptSpendHistory {
  dailyTotal?: string;
  monthlyTotal?: string;
  knownRecipients?: string[];
  knownDomains?: string[];
  unreadable?: boolean;
}

export interface ReceiptSpendHistoryOptions {
  profile?: NetworkName;
  asset?: string;
  now?: Date;
}

export async function appendEvent(logPath: string, entry: Omit<EventLogEntry, "schemaVersion" | "id" | "at" | "previousHash" | "contentHash">): Promise<void> {
  const path = resolvePath(logPath);
  await withFileLock(path, async () => {
    await mkdir(join(path, ".."), { recursive: true });
    const previousHash = await latestEventHash(path);
    const unsigned = {
      schemaVersion: "stellar-agent.event.v2" as const,
      id: makeId("evt"),
      at: nowIso(),
      ...redactSensitive(entry),
      ...(previousHash === undefined ? {} : { previousHash })
    };
    const event: EventLogEntry = { ...unsigned, contentHash: hashCanonical(unsigned) };
    assertNoSecrets(event);
    await writeFile(path, `${JSON.stringify(event)}\n`, { flag: "a", mode: 0o600 });
  });
}

export async function writeReceipt(receiptsDir: string, input: ReceiptInput): Promise<{ path: string; receipt: PaymentReceipt }> {
  const dir = resolvePath(receiptsDir);
  return withFileLock(join(dir, ".store"), async () => {
    await mkdir(dir, { recursive: true });
    const previousReceiptHash = await latestReceiptHash(dir);
    const unsigned: Omit<PaymentReceipt, "integrity"> = {
      schemaVersion: "stellar-agent.receipt.v2",
      id: makeId("rec"),
      createdAt: nowIso(),
      command: input.command,
      profile: input.profile,
      network: {
        name: input.profile,
        passphrase: input.networkPassphrase,
        realFunds: input.realFunds
      },
      ...(input.payment ? { payment: redactSensitive(input.payment) } : {}),
      ...(input.operation ? { operation: redactSensitive(input.operation) } : {}),
      policyDecision: {
        status: input.policyDecision.status,
        matchedRules: input.policyDecision.matchedRules
      },
      transaction: input.transaction,
      ...(input.ledger ? { ledger: input.ledger } : {}),
      ...(input.eventLog ? { files: { eventLog: input.eventLog } } : {}),
      ...(input.intentId === undefined ? {} : { intentId: input.intentId }),
      ...(input.idempotencyKeyHash === undefined ? {} : { idempotencyKeyHash: input.idempotencyKeyHash }),
      ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
      ...(input.attempts === undefined ? {} : { attempts: input.attempts }),
      redactions: {
        urlQueryParamsRedacted: true,
        secretKeysIncluded: false
      }
    };
    const receipt: PaymentReceipt = {
      ...unsigned,
      integrity: {
        algorithm: "sha256",
        ...(previousReceiptHash === undefined ? {} : { previousReceiptHash }),
        contentHash: hashCanonical(unsigned)
      }
    };
    assertNoSecrets(receipt);
    const path = join(dir, `${receipt.id}.json`);
    await writeFileAtomic(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    return { path, receipt };
  });
}

export async function listReceipts(receiptsDir: string): Promise<string[]> {
  const dir = resolvePath(receiptsDir);
  try {
    const entries = await readdir(dir);
    const receiptPaths = entries.filter((entry) => entry.endsWith(".json")).map((entry) => join(dir, entry));
    const withStats = await Promise.all(receiptPaths.map(async (path) => ({ path, mtime: (await stat(path)).mtimeMs })));
    return withStats.sort((a, b) => b.mtime - a.mtime).map((entry) => entry.path);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function latestEventHash(path: string): Promise<string | undefined> {
  return (await verifyEventLogChain(path)).latestHash;
}

async function latestReceiptHash(receiptsDir: string): Promise<string | undefined> {
  return (await verifyReceiptChain(receiptsDir)).latestHash;
}

export async function findReceiptForIntent(receiptsDir: string, intentId: string, transactionHash?: string): Promise<{ path: string; receipt: PaymentReceipt } | undefined> {
  for (const path of await listReceipts(receiptsDir)) {
    const receipt = await readReceipt(path);
    if (receipt.intentId === intentId && (transactionHash === undefined || receipt.transaction.hash === transactionHash)) return { path, receipt };
  }
  return undefined;
}

export async function readReceipt(path: string): Promise<PaymentReceipt> {
  const raw = await readFile(resolvePath(path), "utf8");
  const parsed = JSON.parse(raw) as PaymentReceipt;
  verifyReceipt(parsed);
  return parsed;
}

export async function latestReceipt(receiptsDir: string): Promise<{ path: string; receipt: PaymentReceipt } | null> {
  const [path] = await listReceipts(receiptsDir);
  if (!path) return null;
  return { path, receipt: await readReceipt(path) };
}

export async function verifyEventLogChain(logPath: string): Promise<{ valid: true; entries: number; latestHash?: string }> {
  const path = resolvePath(logPath);
  let previousHash: string | undefined;
  let sawV2 = false;
  let entries = 0;
  try {
    for (const line of (await readFile(path, "utf8")).split("\n").filter(Boolean)) {
      const event = JSON.parse(line) as EventLogEntry | { schemaVersion?: string };
      if (event.schemaVersion === "stellar-agent.event.v1") {
        if (sawV2) {
          throw new StellarAgentError({
            code: "CONFIG_INVALID",
            message: "Legacy event entries are only allowed before the v2 hash chain begins."
          });
        }
        previousHash = undefined;
        entries += 1;
        continue;
      }
      if (event.schemaVersion !== "stellar-agent.event.v2") {
        throw new StellarAgentError({
          code: "CONFIG_INVALID",
          message: "Event log contains an unsupported schema."
        });
      }
      const chainedEvent = event as EventLogEntry;
      sawV2 = true;
      const { contentHash, ...unsigned } = chainedEvent;
      if (contentHash !== hashCanonical(unsigned) || chainedEvent.previousHash !== previousHash) {
        throw new StellarAgentError({
          code: "CONFIG_INVALID",
          message: "Event log hash chain verification failed."
        });
      }
      previousHash = contentHash;
      entries += 1;
    }
    return {
      valid: true,
      entries,
      ...(previousHash === undefined ? {} : { latestHash: previousHash })
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") return { valid: true, entries: 0 };
    if (error instanceof StellarAgentError) throw error;
    throw new StellarAgentError({
      code: "CONFIG_INVALID",
      message: "Event log is unreadable or corrupt."
    });
  }
}

export async function verifyReceiptChain(receiptsDir: string): Promise<{ valid: true; receipts: number; latestHash?: string }> {
  const receipts = await Promise.all((await listReceipts(receiptsDir)).map(readReceipt));
  const v2 = receipts.filter((receipt) => receipt.schemaVersion === "stellar-agent.receipt.v2");
  if (v2.length === 0) return { valid: true, receipts: receipts.length };
  const byHash = new Map(v2.map((receipt) => [receipt.integrity!.contentHash, receipt]));
  const roots = v2.filter((receipt) => receipt.integrity?.previousReceiptHash === undefined);
  if (roots.length !== 1)
    throw new StellarAgentError({
      code: "CONFIG_INVALID",
      message: "Receipt hash chain must have exactly one root."
    });
  const children = new Map<string, PaymentReceipt[]>();
  for (const receipt of v2) {
    const previous = receipt.integrity?.previousReceiptHash;
    if (!previous) continue;
    if (!byHash.has(previous))
      throw new StellarAgentError({
        code: "CONFIG_INVALID",
        message: "Receipt hash chain references a missing receipt."
      });
    children.set(previous, [...(children.get(previous) ?? []), receipt]);
  }
  let cursor = roots[0]!;
  let visited = 1;
  while ((children.get(cursor.integrity!.contentHash) ?? []).length > 0) {
    const next = children.get(cursor.integrity!.contentHash)!;
    if (next.length !== 1)
      throw new StellarAgentError({
        code: "CONFIG_INVALID",
        message: "Receipt hash chain contains a fork."
      });
    cursor = next[0]!;
    visited += 1;
  }
  if (visited !== v2.length)
    throw new StellarAgentError({
      code: "CONFIG_INVALID",
      message: "Receipt hash chain is disconnected."
    });
  return { valid: true, receipts: receipts.length, latestHash: cursor.integrity!.contentHash };
}

export async function spendHistoryFromReceipts(receiptsDir: string, options: ReceiptSpendHistoryOptions = {}): Promise<ReceiptSpendHistory> {
  try {
    const paths = await listReceipts(receiptsDir);
    const now = options.now ?? new Date();
    const dayPrefix = now.toISOString().slice(0, 10);
    const monthPrefix = now.toISOString().slice(0, 7);
    let dailyStroops = 0n;
    let monthlyStroops = 0n;
    const knownRecipients = new Set<string>();
    const knownDomains = new Set<string>();

    for (const path of paths) {
      const receipt = await readReceipt(path);
      if (!receipt.payment || receipt.transaction.successful !== true || receipt.policyDecision.status === "denied") {
        continue;
      }
      if (options.profile && receipt.profile !== options.profile) continue;
      if (options.asset && receipt.payment.asset.toUpperCase() !== options.asset.toUpperCase()) continue;

      knownRecipients.add(receipt.payment.destination);
      if (receipt.payment.domain) knownDomains.add(receipt.payment.domain);

      const stroops = parseAmount(receipt.payment.amount, receipt.payment.asset).stroops;
      if (receipt.createdAt.startsWith(dayPrefix)) dailyStroops += stroops;
      if (receipt.createdAt.startsWith(monthPrefix)) monthlyStroops += stroops;
    }

    return {
      dailyTotal: formatStroops(dailyStroops),
      monthlyTotal: formatStroops(monthlyStroops),
      knownRecipients: Array.from(knownRecipients),
      knownDomains: Array.from(knownDomains)
    };
  } catch {
    return { unreadable: true };
  }
}

export function verifyReceipt(receipt: PaymentReceipt): true {
  if (receipt.schemaVersion !== "stellar-agent.receipt.v1" && receipt.schemaVersion !== "stellar-agent.receipt.v2") {
    throw new StellarAgentError({
      code: "CONFIG_INVALID",
      message: "Receipt schema version is not supported."
    });
  }
  if (receipt.schemaVersion === "stellar-agent.receipt.v2") {
    if (!receipt.integrity || receipt.integrity.algorithm !== "sha256") {
      throw new StellarAgentError({
        code: "CONFIG_INVALID",
        message: "Receipt integrity metadata is missing."
      });
    }
    const { integrity, ...unsigned } = receipt;
    if (integrity.contentHash !== hashCanonical(unsigned)) {
      throw new StellarAgentError({
        code: "CONFIG_INVALID",
        message: "Receipt integrity hash does not match its contents."
      });
    }
  }
  if (!receipt.id || !receipt.createdAt || !receipt.transaction?.hash || (!receipt.payment && !receipt.operation)) {
    throw new StellarAgentError({
      code: "CONFIG_INVALID",
      message: "Receipt is missing required fields."
    });
  }
  assertNoSecrets(receipt);
  return true;
}

export function assertNoSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/\bS[A-Z2-7]{55}\b/.test(serialized)) {
    throw new StellarAgentError({
      code: "SECRET_KEY_BLOCKED",
      message: "Refusing to write secret material to logs or receipts.",
      hint: "Receipts and event logs must never include secret keys.",
      docs: "docs/security.md#key-handling"
    });
  }
}

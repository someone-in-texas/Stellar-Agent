import {
  NetworkName,
  PaymentRequest,
  StellarAgentError,
  makeId,
  nowIso,
  redactSensitive,
  resolvePath
} from "@stellar-agent/core";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface EventLogEntry {
  schemaVersion: "stellar-agent.event.v1";
  at: string;
  event:
    | "command_started"
    | "command_finished"
    | "policy_decision"
    | "approval_requested"
    | "approval_granted"
    | "approval_denied"
    | "transaction_built"
    | "transaction_signed"
    | "transaction_submitted"
    | "transaction_confirmed"
    | "transaction_failed"
    | "receipt_written"
    | "error";
  status?: string;
  command?: string;
  profile?: NetworkName;
  requestId?: string;
  message?: string;
  data?: unknown;
}

export interface PaymentReceipt {
  schemaVersion: "stellar-agent.receipt.v1";
  id: string;
  createdAt: string;
  command: string;
  profile: NetworkName;
  network: {
    name: NetworkName;
    passphrase: string;
    realFunds: boolean;
  };
  payment: {
    source: string;
    destination: string;
    asset: string;
    amount: string;
    memo?: string;
  };
  policyDecision: ReceiptPolicyDecision;
  transaction: {
    hash: string;
    ledger?: number;
    successful: boolean;
    feeCharged?: string;
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
  payment: Required<Pick<PaymentRequest, "destination" | "asset" | "amount">> & {
    source: string;
    memo?: string;
  };
  policyDecision: ReceiptPolicyDecision;
  transaction: PaymentReceipt["transaction"];
  ledger?: PaymentReceipt["ledger"];
  eventLog?: string;
}

export async function appendEvent(logPath: string, entry: Omit<EventLogEntry, "schemaVersion" | "at">): Promise<void> {
  const path = resolvePath(logPath);
  await mkdir(join(path, ".."), { recursive: true });
  const event: EventLogEntry = {
    schemaVersion: "stellar-agent.event.v1",
    at: nowIso(),
    ...redactSensitive(entry)
  };
  assertNoSecrets(event);
  await writeFile(path, `${JSON.stringify(event)}\n`, { flag: "a", mode: 0o600 });
}

export async function writeReceipt(receiptsDir: string, input: ReceiptInput): Promise<{ path: string; receipt: PaymentReceipt }> {
  const dir = resolvePath(receiptsDir);
  await mkdir(dir, { recursive: true });
  const receipt: PaymentReceipt = {
    schemaVersion: "stellar-agent.receipt.v1",
    id: makeId("rec"),
    createdAt: nowIso(),
    command: input.command,
    profile: input.profile,
    network: {
      name: input.profile,
      passphrase: input.networkPassphrase,
      realFunds: input.realFunds
    },
    payment: redactSensitive(input.payment),
    policyDecision: {
      status: input.policyDecision.status,
      matchedRules: input.policyDecision.matchedRules
    },
    transaction: input.transaction,
    ...(input.ledger ? { ledger: input.ledger } : {}),
    ...(input.eventLog ? { files: { eventLog: input.eventLog } } : {}),
    redactions: {
      urlQueryParamsRedacted: true,
      secretKeysIncluded: false
    }
  };
  assertNoSecrets(receipt);
  const path = join(dir, `${receipt.id}.json`);
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  return { path, receipt };
}

export async function listReceipts(receiptsDir: string): Promise<string[]> {
  const dir = resolvePath(receiptsDir);
  try {
    const entries = await readdir(dir);
    const receiptPaths = entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => join(dir, entry));
    const withStats = await Promise.all(
      receiptPaths.map(async (path) => ({ path, mtime: (await stat(path)).mtimeMs }))
    );
    return withStats.sort((a, b) => b.mtime - a.mtime).map((entry) => entry.path);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
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

export function verifyReceipt(receipt: PaymentReceipt): true {
  if (receipt.schemaVersion !== "stellar-agent.receipt.v1") {
    throw new StellarAgentError({
      code: "CONFIG_INVALID",
      message: "Receipt schema version is not supported."
    });
  }
  if (!receipt.id || !receipt.createdAt || !receipt.transaction?.hash) {
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

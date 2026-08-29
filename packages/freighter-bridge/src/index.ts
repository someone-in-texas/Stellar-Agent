import { EXIT_CODES, NetworkName, PaymentRequest, SignerCapabilities, StellarAgentError, makeId, nowIso, paymentRequestSchema, redactSensitive, resolvePath, withFileLock, writeFileAtomic } from "@stellar-agent/core";
import { createHash, randomBytes } from "node:crypto";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Keypair, Networks, TransactionBuilder, xdr } from "@stellar/stellar-sdk";

export type ApprovalStatus = "pending" | "approved" | "denied" | "signed" | "claimed" | "consumed";
export type ApprovalKind = "payment" | "transaction_xdr" | "freighter_connection";

export interface ApprovalRequest {
  schemaVersion: "stellar-agent.approval.v1";
  id: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  revision?: number;
  expiresAt?: string;
  network: NetworkName;
  requestHash: string;
  boundIntentId?: string;
  summary: string;
  payment?: PaymentRequest;
  transactionXdr?: string;
  decision?: {
    decidedAt: string;
    approved: boolean;
    reason?: string;
    signerPublicKey?: string;
    signedTransactionXdr?: string;
  };
  claim?: {
    intentId: string;
    claimedAt: string;
    consumedAt?: string;
  };
  redactions: {
    secretKeysIncluded: false;
  };
}

export interface ApprovalStore {
  approvalsDir: string;
}

export interface ApprovalBridge {
  url: string;
  uiUrl: string;
  copyUrl: string;
  authToken: string;
  close(): Promise<void>;
}

export function freighterSignerCapabilities(account: string, network: NetworkName): SignerCapabilities {
  return {
    provider: "freighter",
    accounts: [account],
    networks: [network],
    signTransaction: true,
    signAuthEntry: true,
    submitTransaction: false
  };
}

export async function createPaymentApprovalRequest(args: { approvalsDir: string; payment: PaymentRequest; summary?: string; expiresAt?: string; intentId?: string }): Promise<ApprovalRequest> {
  const payment = paymentRequestSchema.parse(args.payment);
  const id = args.intentId === undefined ? makeId("appr") : `appr_${args.intentId}`;
  const create = async () => {
    const at = nowIso();
    return writeApproval(args.approvalsDir, {
      schemaVersion: "stellar-agent.approval.v1",
      id,
      kind: "payment",
      status: "pending",
      createdAt: at,
      updatedAt: at,
      revision: 1,
      expiresAt: args.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
      network: payment.network,
      requestHash: hashApprovalPayload({ kind: "payment", payment, ...(args.intentId === undefined ? {} : { intentId: args.intentId }) }),
      ...(args.intentId === undefined ? {} : { boundIntentId: args.intentId }),
      summary: args.summary ?? summarizePayment(payment),
      payment,
      redactions: { secretKeysIncluded: false }
    });
  };
  if (args.intentId === undefined) return create();
  const path = approvalPath(args.approvalsDir, id);
  return withFileLock(path, async () => {
    try {
      const existing = parseApproval(JSON.parse(await readFile(path, "utf8")));
      const expectedHash = hashApprovalPayload({ kind: "payment", payment, intentId: args.intentId });
      if (existing.kind !== "payment" || existing.boundIntentId !== args.intentId || existing.requestHash !== expectedHash) {
        throw new StellarAgentError({ code: "APPROVAL_DENIED", message: "Existing intent-bound approval does not match the payment request." });
      }
      return existing;
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      return create();
    }
  });
}

export async function createTransactionXdrApprovalRequest(args: { approvalsDir: string; network: NetworkName; transactionXdr: string; summary: string; payment?: PaymentRequest; expiresAt?: string }): Promise<ApprovalRequest> {
  const payment = args.payment ? paymentRequestSchema.parse(args.payment) : undefined;
  return writeApproval(args.approvalsDir, {
    schemaVersion: "stellar-agent.approval.v1",
    id: makeId("appr"),
    kind: "transaction_xdr",
    status: "pending",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    revision: 1,
    expiresAt: args.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
    network: args.network,
    requestHash: hashApprovalPayload({
      kind: "transaction_xdr",
      network: args.network,
      transactionXdr: args.transactionXdr,
      ...(payment === undefined ? {} : { payment })
    }),
    summary: args.summary,
    transactionXdr: args.transactionXdr,
    ...(payment === undefined ? {} : { payment }),
    redactions: { secretKeysIncluded: false }
  });
}

export async function listApprovalRequests(approvalsDir: string): Promise<ApprovalRequest[]> {
  const dir = resolvePath(approvalsDir);
  try {
    const entries = await readdir(dir);
    const approvals = await Promise.all(entries.filter((entry) => entry.endsWith(".json")).map((entry) => readApprovalRequest(approvalsDir, entry.slice(0, -".json".length))));
    return approvals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function readApprovalRequest(approvalsDir: string, id: string): Promise<ApprovalRequest> {
  try {
    const raw = await readFile(approvalPath(approvalsDir, id), "utf8");
    return parseApproval(JSON.parse(raw));
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new StellarAgentError({
        code: "APPROVAL_DENIED",
        message: `Approval request '${id}' was not found.`,
        docs: "docs/mainnet-safety.md",
        exitCode: EXIT_CODES.approval
      });
    }
    throw error;
  }
}

export async function decideApprovalRequest(args: { approvalsDir: string; id: string; approved: boolean; reason?: string; signerPublicKey?: string; signedTransactionXdr?: string }): Promise<ApprovalRequest> {
  const path = approvalPath(args.approvalsDir, args.id);
  return withFileLock(path, async () => {
    const current = await readApprovalRequest(args.approvalsDir, args.id);
    if (current.status !== "pending") {
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: `Approval request '${args.id}' is already ${current.status}.`,
        docs: "docs/mainnet-safety.md#local-approval-bridge"
      });
    }
    if (args.signedTransactionXdr && current.kind !== "transaction_xdr") {
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: "Signed transaction XDR can only be attached to transaction_xdr approval requests.",
        docs: "docs/mainnet-safety.md#local-approval-bridge"
      });
    }
    if (args.signedTransactionXdr && !args.signerPublicKey) {
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: "Signer public key is required when recording signed transaction XDR.",
        docs: "docs/mainnet-safety.md#local-approval-bridge"
      });
    }
    if (args.signedTransactionXdr && current.transactionXdr) {
      assertSignedTransactionMatchesApproval({
        originalTransactionXdr: current.transactionXdr,
        signedTransactionXdr: args.signedTransactionXdr
      });
      assertSignerSignedTransaction({
        signedTransactionXdr: args.signedTransactionXdr,
        signerPublicKey: args.signerPublicKey!,
        network: current.network
      });
    }
    return writeApproval(args.approvalsDir, {
      ...current,
      status: args.signedTransactionXdr ? "signed" : args.approved ? "approved" : "denied",
      updatedAt: nowIso(),
      revision: (current.revision ?? 1) + 1,
      decision: {
        decidedAt: nowIso(),
        approved: args.signedTransactionXdr ? true : args.approved,
        ...(args.reason === undefined ? {} : { reason: args.reason }),
        ...(args.signerPublicKey === undefined ? {} : { signerPublicKey: args.signerPublicKey }),
        ...(args.signedTransactionXdr === undefined ? {} : { signedTransactionXdr: args.signedTransactionXdr })
      }
    });
  });
}

export function assertSignedTransactionMatchesApproval(args: { originalTransactionXdr: string; signedTransactionXdr: string }): true {
  const original = comparableEnvelope(args.originalTransactionXdr, "approval transaction XDR");
  const signed = comparableEnvelope(args.signedTransactionXdr, "signed transaction XDR");
  if (signed.signatures < 1) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Signed transaction XDR must include at least one signature.",
      docs: "docs/mainnet-safety.md#local-approval-bridge"
    });
  }
  if (original.type !== signed.type || original.transactionXdr !== signed.transactionXdr) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Signed transaction XDR does not match the approval request transaction.",
      hint: "Sign the exact XDR from the approval request and try again.",
      docs: "docs/mainnet-safety.md#local-approval-bridge"
    });
  }
  return true;
}

export function assertSignerSignedTransaction(args: { signedTransactionXdr: string; signerPublicKey: string; network: NetworkName }): true {
  const passphrase = args.network === "mainnet" ? Networks.PUBLIC : args.network === "testnet" ? Networks.TESTNET : "Standalone Network ; February 2017";
  try {
    const transaction = TransactionBuilder.fromXdr(args.signedTransactionXdr, passphrase);
    const payload = transaction.hash();
    const keypair = Keypair.fromPublicKey(args.signerPublicKey);
    const valid = transaction.signatures.some((signature) => keypair.verify(payload, signature.signature.toBytes()));
    if (!valid) throw new Error("no matching signature");
    return true;
  } catch {
    throw new StellarAgentError({
      code: "APPROVAL_DENIED",
      message: "Signed transaction does not contain a valid signature from the declared signer on the selected network.",
      docs: "docs/mainnet-safety.md#local-approval-bridge"
    });
  }
}

export function assertSignedTransactionMeetsThreshold(args: { signedTransactionXdr: string; network: NetworkName; signerWeights: Array<{ publicKey: string; weight: number }>; requiredWeight: number }): true {
  const passphrase = args.network === "mainnet" ? Networks.PUBLIC : args.network === "testnet" ? Networks.TESTNET : "Standalone Network ; February 2017";
  const transaction = TransactionBuilder.fromXdr(args.signedTransactionXdr, passphrase);
  if ("innerTransaction" in transaction) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Fee-bump approval threshold verification requires separate inner and outer signer checks and is not supported by this flow."
    });
  }
  const hash = transaction.hash();
  const verified = new Set<string>();
  let weight = 0;
  for (const signer of args.signerWeights) {
    if (!Number.isInteger(signer.weight) || signer.weight <= 0 || verified.has(signer.publicKey)) continue;
    const keypair = Keypair.fromPublicKey(signer.publicKey);
    if (transaction.signatures.some((signature) => keypair.verify(hash, signature.signature.toBytes()))) {
      verified.add(signer.publicKey);
      weight += signer.weight;
    }
  }
  if (weight < args.requiredWeight) {
    throw new StellarAgentError({
      code: "APPROVAL_DENIED",
      message: "Signed transaction does not satisfy the source account threshold.",
      details: { verifiedWeight: weight, requiredWeight: args.requiredWeight }
    });
  }
  return true;
}

export async function assertPaymentApproval(args: { approvalsDir: string; approvalId: string; payment: PaymentRequest; intentId: string }): Promise<ApprovalRequest> {
  return claimPaymentApproval(args);
}

export async function claimPaymentApproval(args: { approvalsDir: string; approvalId: string; payment: PaymentRequest; intentId: string }): Promise<ApprovalRequest> {
  const path = approvalPath(args.approvalsDir, args.approvalId);
  return withFileLock(path, async () => {
    const approval = await readApprovalRequest(args.approvalsDir, args.approvalId);
    if (approval.boundIntentId !== undefined && approval.boundIntentId !== args.intentId) {
      throw new StellarAgentError({ code: "APPROVAL_REQUIRED", message: "Approval is bound to a different execution intent.", details: { approvalId: args.approvalId, intentId: args.intentId } });
    }
    const expectedHash = hashApprovalPayload({
      kind: "payment",
      payment: paymentRequestSchema.parse(args.payment),
      ...(approval.boundIntentId === undefined ? {} : { intentId: args.intentId })
    });
    const expired = approval.expiresAt !== undefined && Date.parse(approval.expiresAt) <= Date.now();
    const reusableClaim = approval.status === "claimed" && approval.claim?.intentId === args.intentId;
    if (approval.kind !== "payment" || approval.requestHash !== expectedHash || expired || (approval.status !== "approved" && !reusableClaim)) {
      throw new StellarAgentError({
        code: "APPROVAL_REQUIRED",
        message: "Payment requires an unexpired, unconsumed matching approval request.",
        hint: "Create and approve a new request, then bind it to this execution intent.",
        docs: "docs/mainnet-safety.md#local-approval-bridge",
        details: {
          approvalId: args.approvalId,
          intentId: args.intentId,
          status: approval.status,
          expired
        }
      });
    }
    if (reusableClaim) return approval;
    return writeApproval(args.approvalsDir, {
      ...approval,
      status: "claimed",
      updatedAt: nowIso(),
      revision: (approval.revision ?? 1) + 1,
      claim: { intentId: args.intentId, claimedAt: nowIso() }
    });
  });
}

export async function claimSignedTransactionApproval(args: { approvalsDir: string; approvalId: string; intentId: string }): Promise<ApprovalRequest> {
  const path = approvalPath(args.approvalsDir, args.approvalId);
  return withFileLock(path, async () => {
    const approval = await readApprovalRequest(args.approvalsDir, args.approvalId);
    const expired = approval.expiresAt !== undefined && Date.parse(approval.expiresAt) <= Date.now();
    const reusableClaim = approval.status === "claimed" && approval.claim?.intentId === args.intentId;
    if (approval.kind !== "transaction_xdr" || !approval.decision?.signedTransactionXdr || expired || (approval.status !== "signed" && !reusableClaim)) {
      throw new StellarAgentError({
        code: "APPROVAL_REQUIRED",
        message: "Transaction requires an unexpired, unconsumed signed approval request.",
        docs: "docs/mainnet-safety.md#local-approval-bridge",
        details: {
          approvalId: args.approvalId,
          intentId: args.intentId,
          status: approval.status,
          expired
        }
      });
    }
    if (reusableClaim) return approval;
    return writeApproval(args.approvalsDir, {
      ...approval,
      status: "claimed",
      updatedAt: nowIso(),
      revision: (approval.revision ?? 1) + 1,
      claim: { intentId: args.intentId, claimedAt: nowIso() }
    });
  });
}

export async function consumeApprovalRequest(args: { approvalsDir: string; approvalId: string; intentId: string }): Promise<ApprovalRequest> {
  const path = approvalPath(args.approvalsDir, args.approvalId);
  return withFileLock(path, async () => {
    const approval = await readApprovalRequest(args.approvalsDir, args.approvalId);
    if (approval.status === "consumed" && approval.claim?.intentId === args.intentId) return approval;
    if (approval.status !== "claimed" || approval.claim?.intentId !== args.intentId) {
      throw new StellarAgentError({
        code: "APPROVAL_DENIED",
        message: "Approval cannot be consumed by a different or unbound execution intent.",
        details: { approvalId: args.approvalId, intentId: args.intentId, status: approval.status }
      });
    }
    return writeApproval(args.approvalsDir, {
      ...approval,
      status: "consumed",
      updatedAt: nowIso(),
      revision: (approval.revision ?? 1) + 1,
      claim: { ...approval.claim, consumedAt: nowIso() }
    });
  });
}

export async function startApprovalBridge(args: { approvalsDir: string; host?: string; port?: number; authToken?: string; maxBodyBytes?: number; allowRemoteAccess?: boolean }): Promise<ApprovalBridge> {
  const host = args.host ?? "127.0.0.1";
  if (!isLoopbackHost(host) && !args.allowRemoteAccess) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Approval bridge host must be loopback unless remote access is explicitly allowed.",
      hint: "Use the default 127.0.0.1 host for local approval, or pass an explicit remote-access acknowledgement.",
      docs: "docs/mainnet-safety.md#local-approval-bridge"
    });
  }
  const authToken = args.authToken ?? randomBytes(32).toString("base64url");
  const maxBodyBytes = args.maxBodyBytes ?? 1024 * 1024;
  const server = createServer((request, response) => {
    void handleRequest(args.approvalsDir, request, response, { authToken, maxBodyBytes });
  });
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(args.port ?? 0, host, () => resolveReady());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : args.port;
  const url = `http://${host}:${port}`;
  const uiUrl = `${url}/#token=${encodeURIComponent(authToken)}`;
  return {
    url,
    uiUrl,
    copyUrl: uiUrl,
    authToken,
    close: () => closeServer(server)
  };
}

export function hashApprovalPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(payload)))
    .digest("hex");
}

function summarizePayment(payment: PaymentRequest): string {
  return `Approve ${payment.amount} ${payment.asset} payment to ${payment.destination} on ${payment.network}`;
}

async function handleRequest(approvalsDir: string, request: IncomingMessage, response: ServerResponse, options: { authToken: string; maxBodyBytes: number }): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  try {
    if (request.method === "GET" && url.pathname === "/health") return json(response, { ok: true });
    if (request.method === "GET" && url.pathname === "/") return html(response, approvalHtml());
    if (url.pathname.startsWith("/api/")) assertAuthorizedBridgeRequest(request, options.authToken);
    if (request.method === "GET" && url.pathname === "/api/requests") {
      return json(response, { requests: await listApprovalRequests(approvalsDir) });
    }
    if (request.method === "POST" && url.pathname === "/api/requests") {
      const body = await readJson(request, options.maxBodyBytes);
      const approval = body.transactionXdr
        ? await createTransactionXdrApprovalRequest({
            approvalsDir,
            network: body.network,
            transactionXdr: body.transactionXdr,
            summary: body.summary ?? "Approve transaction",
            ...(body.payment === undefined ? {} : { payment: body.payment })
          })
        : await createPaymentApprovalRequest({
            approvalsDir,
            payment: body.payment,
            summary: body.summary
          });
      return json(response, approval, 201);
    }
    const match = /^\/api\/requests\/([^/]+)(?:\/decision)?$/.exec(url.pathname);
    if (match?.[1] && request.method === "GET") return json(response, await readApprovalRequest(approvalsDir, match[1]));
    if (match?.[1] && request.method === "POST" && url.pathname.endsWith("/decision")) {
      const body = await readJson(request, options.maxBodyBytes);
      return json(
        response,
        await decideApprovalRequest({
          approvalsDir,
          id: match[1],
          approved: Boolean(body.approved),
          ...(body.reason === undefined ? {} : { reason: String(body.reason) }),
          ...(body.signerPublicKey === undefined ? {} : { signerPublicKey: String(body.signerPublicKey) }),
          ...(body.signedTransactionXdr === undefined ? {} : { signedTransactionXdr: String(body.signedTransactionXdr) })
        })
      );
    }
    return json(response, { ok: false, error: "not_found" }, 404);
  } catch (error) {
    return json(response, { ok: false, error: redactSensitive(error) }, 400);
  }
}

function assertAuthorizedBridgeRequest(request: IncomingMessage, authToken: string): void {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  if (token !== authToken) {
    throw new StellarAgentError({
      code: "APPROVAL_DENIED",
      message: "Approval bridge request is missing a valid session token.",
      docs: "docs/mainnet-safety.md#local-approval-bridge"
    });
  }

  const origin = request.headers.origin;
  if (origin) {
    const host = request.headers.host;
    if (!host || new URL(origin).host !== host) {
      throw new StellarAgentError({
        code: "APPROVAL_DENIED",
        message: "Approval bridge request origin is not allowed.",
        docs: "docs/mainnet-safety.md#local-approval-bridge"
      });
    }
  }
}

async function writeApproval(approvalsDir: string, approval: ApprovalRequest): Promise<ApprovalRequest> {
  const parsed = parseApproval(redactSensitive(approval));
  await writeFileAtomic(approvalPath(approvalsDir, parsed.id), `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  return parsed;
}

function parseApproval(value: any): ApprovalRequest {
  if (!value || value.schemaVersion !== "stellar-agent.approval.v1" || typeof value.id !== "string") {
    throw new StellarAgentError({ code: "INVALID_INPUT", message: "Approval request is invalid." });
  }
  return value as ApprovalRequest;
}

function approvalPath(approvalsDir: string, id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new StellarAgentError({ code: "INVALID_INPUT", message: "Approval id is invalid." });
  }
  return join(resolvePath(approvalsDir), `${id}.json`);
}

async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBodyBytes) {
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: "Approval bridge request body is too large.",
        docs: "docs/mainnet-safety.md#local-approval-bridge"
      });
    }
    chunks.push(buffer);
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, payload: unknown, status = 200): void {
  const body = JSON.stringify(redactSensitive(payload));
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
}

function sortJson(value: any): any {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortJson(child)])
  );
}

function comparableEnvelope(rawXdr: string, label: string): { type: string; transactionXdr: string; signatures: number } {
  let envelope: xdr.TransactionEnvelope;
  try {
    envelope = xdr.TransactionEnvelope.fromXdr(rawXdr, "base64");
  } catch {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: `${label} is not a valid Stellar transaction envelope XDR.`,
      docs: "docs/mainnet-safety.md#local-approval-bridge"
    });
  }

  const type = envelope.type;
  if (type === "envelopeTypeTx") {
    const value = envelope.v1;
    return {
      type,
      transactionXdr: value.tx.toXdr("base64"),
      signatures: value.signatures.length
    };
  }
  if (type === "envelopeTypeTxV0") {
    const value = envelope.v0;
    return {
      type,
      transactionXdr: value.tx.toXdr("base64"),
      signatures: value.signatures.length
    };
  }
  if (type === "envelopeTypeTxFeeBump") {
    const value = envelope.feeBump;
    return {
      type,
      transactionXdr: value.tx.toXdr("base64"),
      signatures: value.signatures.length
    };
  }

  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: `Unsupported ${label} envelope type: ${type}.`,
    docs: "docs/mainnet-safety.md#local-approval-bridge"
  });
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}

function approvalHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stellar Agent Approval</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f6f7f9; color: #16181d; }
    main { max-width: 920px; margin: 0 auto; padding: 32px 20px; }
    h1 { font-size: 24px; margin: 0 0 20px; }
    .request { background: #fff; border: 1px solid #d8dde6; border-radius: 8px; padding: 16px; margin: 12px 0; }
    .status { font-weight: 700; text-transform: uppercase; font-size: 12px; }
    button { border: 1px solid #b8c0cc; background: #fff; border-radius: 6px; padding: 8px 12px; margin-right: 8px; cursor: pointer; }
    button.approve { background: #1f7a4d; border-color: #1f7a4d; color: #fff; }
    button.deny { background: #8a1f28; border-color: #8a1f28; color: #fff; }
    button.sign { background: #1d4f91; border-color: #1d4f91; color: #fff; }
    .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .muted { color: #5c6675; font-size: 13px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; background: #f0f2f5; padding: 12px; border-radius: 6px; }
  </style>
</head>
<body>
  <main>
    <h1>Stellar Agent Approval</h1>
    <div class="toolbar">
      <button onclick="connectFreighter()">Connect Freighter</button>
      <span id="freighter" class="muted">Freighter not connected.</span>
    </div>
    <div id="requests"></div>
  </main>
  <script>
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const authToken = params.get('token') || '';
    function apiFetch(url, options) {
      if (!authToken) {
        return Promise.reject(new Error('Missing approval bridge token. Open the URL printed by stellar-agent approval serve.'));
      }
      const init = options || {};
      init.headers = Object.assign({}, init.headers || {}, { authorization: 'Bearer ' + authToken });
      return fetch(url, init);
    }
    let freighterAddress = '';
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, function (char) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
      });
    }
    function freighterApi() {
      return window.freighterApi || window.stellarFreighterApi || window.stellarApi || window.freighter;
    }
    async function connectFreighter() {
      const api = freighterApi();
      if (!api) {
        document.getElementById('freighter').textContent = 'Freighter API is unavailable. Install Freighter and refresh.';
        return;
      }
      try {
        if (api.setAllowed) await api.setAllowed();
        const result = api.getAddress ? await api.getAddress() : undefined;
        freighterAddress = result && (result.address || result.publicKey || result);
        document.getElementById('freighter').textContent = freighterAddress ? 'Connected: ' + freighterAddress : 'Freighter connected.';
      } catch (error) {
        document.getElementById('freighter').textContent = 'Freighter connection failed: ' + error.message;
      }
    }
    async function decide(id, approved) {
      await apiFetch('/api/requests/' + id + '/decision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approved })
      });
      await load();
    }
    async function signTransaction(id) {
      const api = freighterApi();
      if (!api || !api.signTransaction) {
        document.getElementById('freighter').textContent = 'Freighter signTransaction API is unavailable.';
        return;
      }
      const response = await apiFetch('/api/requests/' + id);
      const request = await response.json();
      try {
        const result = await api.signTransaction(request.transactionXdr, {
          network: request.network,
          networkPassphrase: request.network === 'testnet' ? 'Test SDF Network ; September 2015' : undefined,
          address: freighterAddress || undefined
        });
        if (result && result.error) throw new Error(result.error);
        const signedTransactionXdr = result.signedTxXdr || result.signedTransactionXdr;
        const signerPublicKey = result.signerAddress || result.address || freighterAddress;
        await apiFetch('/api/requests/' + id + '/decision', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ approved: true, signerPublicKey, signedTransactionXdr })
        });
        await load();
      } catch (error) {
        document.getElementById('freighter').textContent = 'Signing failed: ' + error.message;
      }
    }
    async function load() {
      const response = await apiFetch('/api/requests');
      const data = await response.json();
      document.getElementById('requests').innerHTML = data.requests.map((request) => {
        const actions = request.status === 'pending'
          ? '<button class="approve" onclick="decide(\\'' + request.id + '\\', true)">Approve</button><button class="deny" onclick="decide(\\'' + request.id + '\\', false)">Deny</button>' + (request.kind === 'transaction_xdr' ? '<button class="sign" onclick="signTransaction(\\'' + request.id + '\\')">Sign With Freighter</button>' : '')
          : '';
        return '<section class="request"><div class="status">' + escapeHtml(request.kind + ' / ' + request.status) + '</div><h2>' + escapeHtml(request.summary) + '</h2><pre>' + escapeHtml(JSON.stringify(request, null, 2)) + '</pre>' + actions + '</section>';
      }).join('');
    }
    load();
  </script>
</body>
</html>`;
}

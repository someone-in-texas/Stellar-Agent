import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Account, Asset, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  assertSignedTransactionMatchesApproval,
  assertPaymentApproval,
  createPaymentApprovalRequest,
  createTransactionXdrApprovalRequest,
  decideApprovalRequest,
  listApprovalRequests,
  startApprovalBridge
} from "../src/index.js";

const payment = {
  source: "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  amount: "1",
  asset: "XLM",
  network: "testnet" as const
};

describe("freighter bridge approvals", () => {
  it("creates, lists, and approves payment requests", async () => {
    const approvalsDir = await mkdtemp(join(tmpdir(), "stellar-agent-approvals-"));
    const approval = await createPaymentApprovalRequest({ approvalsDir, payment });
    expect(approval).toMatchObject({ kind: "payment", status: "pending", payment });
    await expect(listApprovalRequests(approvalsDir)).resolves.toHaveLength(1);

    await expect(assertPaymentApproval({ approvalsDir, approvalId: approval.id, payment })).rejects.toMatchObject({
      code: "APPROVAL_REQUIRED"
    });
    const approved = await decideApprovalRequest({ approvalsDir, id: approval.id, approved: true });
    expect(approved.status).toBe("approved");
    await expect(assertPaymentApproval({ approvalsDir, approvalId: approval.id, payment })).resolves.toMatchObject({
      id: approval.id,
      status: "approved"
    });
  });

  it("records signed transaction XDR decisions for Freighter signing requests", async () => {
    const approvalsDir = await mkdtemp(join(tmpdir(), "stellar-agent-xdr-approvals-"));
    const { signerPublicKey, unsignedXdr, signedXdr } = signedPaymentFixture();
    const approval = await createTransactionXdrApprovalRequest({
      approvalsDir,
      network: "testnet",
      transactionXdr: unsignedXdr,
      summary: "Sign test transaction"
    });
    await expect(
      decideApprovalRequest({
        approvalsDir,
        id: approval.id,
        approved: true,
        signerPublicKey,
        signedTransactionXdr: signedXdr
      })
    ).resolves.toMatchObject({
      id: approval.id,
      kind: "transaction_xdr",
      status: "signed",
      decision: {
        approved: true,
        signerPublicKey,
        signedTransactionXdr: signedXdr
      }
    });
  });

  it("rejects signed transaction XDR that does not match the approval request", async () => {
    const approvalsDir = await mkdtemp(join(tmpdir(), "stellar-agent-xdr-mismatch-"));
    const original = signedPaymentFixture();
    const replacement = signedPaymentFixture({ amount: "2" });
    const approval = await createTransactionXdrApprovalRequest({
      approvalsDir,
      network: "testnet",
      transactionXdr: original.unsignedXdr,
      summary: "Sign original transaction"
    });

    await expect(
      decideApprovalRequest({
        approvalsDir,
        id: approval.id,
        approved: true,
        signerPublicKey: replacement.signerPublicKey,
        signedTransactionXdr: replacement.signedXdr
      })
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "Signed transaction XDR does not match the approval request transaction."
    });
  });

  it("rejects unsigned XDR when a signed transaction decision is recorded", () => {
    const { unsignedXdr } = signedPaymentFixture();
    expect(() =>
      assertSignedTransactionMatchesApproval({
        originalTransactionXdr: unsignedXdr,
        signedTransactionXdr: unsignedXdr
      })
    ).toThrow("must include at least one signature");
  });

  it("serves approval requests over HTTP", async () => {
    const approvalsDir = await mkdtemp(join(tmpdir(), "stellar-agent-approval-bridge-"));
    const bridge = await startApprovalBridge({ approvalsDir });
    try {
      const createResponse = await fetch(`${bridge.url}/api/requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payment })
      });
      expect(createResponse.status).toBe(201);
      const created: any = await createResponse.json();
      const listResponse = await fetch(`${bridge.url}/api/requests`);
      await expect(listResponse.json()).resolves.toMatchObject({ requests: [{ id: created.id, status: "pending" }] });
      const decisionResponse = await fetch(`${bridge.url}/api/requests/${created.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: false })
      });
      await expect(decisionResponse.json()).resolves.toMatchObject({ id: created.id, status: "denied" });

      const htmlResponse = await fetch(bridge.url);
      const html = await htmlResponse.text();
      expect(html).toContain("signTransaction");
      expect(html).toContain("Sign With Freighter");
    } finally {
      await bridge.close();
    }
  });
});

function signedPaymentFixture(options: { amount?: string } = {}): {
  signerPublicKey: string;
  unsignedXdr: string;
  signedXdr: string;
} {
  const signer = Keypair.random();
  const destination = Keypair.random().publicKey();
  const account = new Account(signer.publicKey(), "1");
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount: options.amount ?? "1"
      })
    )
    .setTimeout(60)
    .build();
  const unsignedXdr = transaction.toXDR();
  transaction.sign(signer);
  return {
    signerPublicKey: signer.publicKey(),
    unsignedXdr,
    signedXdr: transaction.toXDR()
  };
}

import { paymentRequestSchema } from "@stellar-agent/core";
import {
  createPaymentApprovalRequest,
  decideApprovalRequest,
  listApprovalRequests,
  readApprovalRequest,
  type ApprovalRequest
} from "@stellar-agent/freighter-bridge";

export interface ApprovalFlowExampleArgs {
  approvalsDir: string;
  source: string;
  destination: string;
}

export interface ApprovalFlowExampleResult {
  created: ApprovalRequest;
  listed: ApprovalRequest[];
  approved: ApprovalRequest;
}

export async function runApprovalRequestExample(args: ApprovalFlowExampleArgs): Promise<ApprovalFlowExampleResult> {
  const payment = paymentRequestSchema.parse({
    source: args.source,
    destination: args.destination,
    amount: "1",
    asset: "XLM",
    network: "testnet"
  });

  const created = await createPaymentApprovalRequest({
    approvalsDir: args.approvalsDir,
    payment,
    summary: "SDK example approval request"
  });

  const listed = await listApprovalRequests(args.approvalsDir);
  await readApprovalRequest(args.approvalsDir, created.id);

  const approved = await decideApprovalRequest({
    approvalsDir: args.approvalsDir,
    id: created.id,
    approved: true
  });

  return { created, listed, approved };
}

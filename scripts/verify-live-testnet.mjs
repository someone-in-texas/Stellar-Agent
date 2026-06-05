import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Keypair, Transaction } = require("../packages/stellar/node_modules/@stellar/stellar-sdk");
const { parse: parseYaml, stringify: stringifyYaml } = require("../packages/policy/node_modules/yaml");

if (!process.env.LIVE_STELLAR_TESTNET) {
  console.error("Set LIVE_STELLAR_TESTNET=1 to run the live Testnet verifier.");
  process.exit(1);
}

const root = await mkdtemp(join(tmpdir(), "stellar-agent-live-verify-"));
const configPath = join(root, "config.yaml");
const stellarConfigDir = join(root, "stellar-cli-config");
await mkdir(stellarConfigDir, { recursive: true });

const report = {
  schemaVersion: "stellar-agent.liveVerification.v1",
  root,
  configPath,
  startedAt: new Date().toISOString(),
  steps: []
};

try {
  const init = runCli(["testnet", "init"]);
  step("testnet.init", init.data);

  const issuerWallet = runCli(["wallet", "create-testnet", "issuer"]);
  step("wallet.create-testnet.issuer", issuerWallet.data);
  const fundedWallet = runCli(["wallet", "create-testnet", "funded-agent", "--fund"]);
  if (!fundedWallet.data.funding?.funded) {
    throw new Error(`Funded wallet creation did not return successful Friendbot metadata: ${JSON.stringify(fundedWallet.data)}`);
  }
  step("wallet.create-testnet.funded", {
    publicKey: fundedWallet.data.wallet?.publicKey,
    funding: fundedWallet.data.funding
  });
  const issuerFunding = runCli(["testnet", "fund", "--account", "issuer"]);
  step("testnet.fund.issuer", issuerFunding.data);
  const auditorFunding = runCli(["testnet", "fund", "--account", "auditor"]);
  step("testnet.fund.auditor", auditorFunding.data);

  const agent = runCli(["wallet", "address", "--account", "agent"]).data;
  const merchant = runCli(["wallet", "address", "--account", "merchant"]).data;
  const auditor = runCli(["wallet", "address", "--account", "auditor"]).data;
  const issuer = runCli(["wallet", "address", "--account", "issuer"]).data;
  step("wallet.addresses", { agent, merchant, auditor, issuer });

  const batchPath = join(root, "batch-payments.json");
  await writeFile(
    batchPath,
    JSON.stringify([
      { destination: merchant.publicKey, amount: "0.0000001", asset: "XLM" },
      { destination: auditor.publicKey, amount: "0.0000001", asset: "XLM" }
    ])
  );
  const batchPayment = runCli(["pay", "batch", "--from", "agent", "--file", batchPath, "--memo", "live-batch"]);
  step("payment.batch", {
    transaction: transactionSummary(batchPayment.data.transaction),
    operationCount: batchPayment.data.transaction.operationCount,
    receiptPath: batchPayment.data.receiptPath
  });

  const payment = runCli([
    "pay",
    "send",
    "--from",
    "agent",
    "--to",
    merchant.publicKey,
    "--amount",
    "0.0000001",
    "--asset",
    "XLM",
    "--memo",
    "live-verify"
  ]);
  step("payment.xlm", transactionSummary(payment.data));
  const paymentHash = payment.data.transaction.hash;
  const paymentTxLookup = runCli(["ledger", "tx", paymentHash]);
  if (paymentTxLookup.data.hash !== paymentHash) {
    throw new Error(`Ledger transaction lookup returned the wrong hash: ${paymentTxLookup.data.hash}`);
  }
  step("ledger.tx", { hash: paymentTxLookup.data.hash, ledger: paymentTxLookup.data.ledger });
  const merchantPayments = runCli(["ledger", "payments", "--address", merchant.publicKey, "--limit", "10"]);
  if (!merchantPayments.data.records?.some((record) => record.transaction_hash === paymentHash)) {
    throw new Error(`Payment hash was not found in merchant payment history: ${paymentHash}`);
  }
  step("ledger.payments", { address: merchant.publicKey, matchedTransactionHash: paymentHash });
  const paymentEffects = runCli(["ledger", "effects", "--tx", paymentHash, "--limit", "10"]);
  if (!paymentEffects.data.records?.length) {
    throw new Error(`Payment effects were not returned for transaction: ${paymentHash}`);
  }
  step("ledger.effects", { transaction: paymentHash, records: paymentEffects.data.records.length });
  const paymentReceipt = runCli(["receipts", "show", payment.data.receiptPath]);
  if (paymentReceipt.data.transaction.hash !== paymentHash) {
    throw new Error(`Receipt transaction hash did not match payment hash: ${paymentReceipt.data.transaction.hash}`);
  }
  const receiptVerification = runCli(["receipts", "verify", payment.data.receiptPath, "--ledger"]);
  step("receipt.verify", {
    path: receiptVerification.data.path,
    valid: receiptVerification.data.valid,
    ledger: receiptVerification.data.ledger
  });

  const trustAsset = `${uniqueCode("TL")}:${issuer.publicKey}`;
  const trustAdd = runCli(["wallet", "trustline", "add", "--account", "merchant", "--asset", trustAsset]);
  const trustAddReceipt = verifyOperationReceipt(trustAdd.data.receiptPath, "trustline.add", trustAdd.data.transaction.hash);
  step("trustline.add", { asset: trustAsset, transaction: transactionSummary(trustAdd.data), receipt: trustAddReceipt });
  const trustRemove = runCli(["wallet", "trustline", "remove", "--account", "merchant", "--asset", trustAsset]);
  step("trustline.remove", { asset: trustAsset, transaction: transactionSummary(trustRemove.data) });

  const issuedPaymentAsset = `${uniqueCode("IP")}:${issuer.publicKey}`;
  const issuedTrustAdd = runCli(["wallet", "trustline", "add", "--account", "merchant", "--asset", issuedPaymentAsset]);
  step("trustline.add-issued-payment-asset", {
    asset: issuedPaymentAsset,
    transaction: transactionSummary(issuedTrustAdd.data.transaction)
  });
  const listedTrustlines = runCli(["wallet", "trustline", "list", "--account", "merchant"]).data.trustlines;
  const listedIssuedTrustline = listedTrustlines.find((trustline) => trustline.asset === issuedPaymentAsset);
  if (!listedIssuedTrustline) {
    throw new Error(`Issued asset trustline was not listed after creation: ${JSON.stringify(listedTrustlines)}`);
  }
  step("trustline.list", { asset: issuedPaymentAsset, trustline: listedIssuedTrustline });
  await allowPolicyAsset(issuedPaymentAsset);
  const issuedPayment = runCli([
    "pay",
    "send",
    "--from",
    "issuer",
    "--to",
    merchant.publicKey,
    "--amount",
    "0.0000001",
    "--asset",
    issuedPaymentAsset,
    "--memo",
    "issued-verify"
  ]);
  const merchantIssuedBalances = runCli(["wallet", "balance", "--account", "merchant"]).data.balances;
  const issuedBalance = merchantIssuedBalances.find((balance) => balance.asset === issuedPaymentAsset);
  if (!issuedBalance || issuedBalance.balance !== "0.0000001") {
    throw new Error(`Issued asset balance was not observed after payment: ${JSON.stringify(issuedBalance)}`);
  }
  step("payment.issued-asset", {
    asset: issuedPaymentAsset,
    transaction: transactionSummary(issuedPayment.data),
    balance: issuedBalance
  });

  const issuedAssetScenario = runCli([
    "testnet",
    "scenario",
    "issued-asset-payment",
    "--issuer",
    "issuer",
    "--recipient",
    "merchant",
    "--asset-code",
    uniqueCode("SA"),
    "--amount",
    "0.0000001",
    "--no-fund"
  ]);
  if (issuedAssetScenario.data.recipientBalance?.balance !== "0.0000001") {
    throw new Error(`Issued-asset scenario balance was not observed: ${JSON.stringify(issuedAssetScenario.data)}`);
  }
  const issuedScenarioTrustlineReceipt = verifyOperationReceipt(
    issuedAssetScenario.data.trustline?.receiptPath,
    "trustline.add",
    issuedAssetScenario.data.trustline?.hash
  );
  const issuedScenarioPaymentReceipt = runCli(["receipts", "verify", issuedAssetScenario.data.payment.receiptPath]).data;
  if (!issuedScenarioPaymentReceipt.valid) {
    throw new Error(`Issued-asset scenario payment receipt did not verify: ${issuedAssetScenario.data.payment.receiptPath}`);
  }
  step("scenario.issued-asset-payment", {
    asset: issuedAssetScenario.data.asset,
    trustline: transactionSummary(issuedAssetScenario.data.trustline),
    payment: transactionSummary(issuedAssetScenario.data.payment),
    recipientBalance: issuedAssetScenario.data.recipientBalance,
    receipts: {
      trustline: issuedScenarioTrustlineReceipt,
      payment: { path: issuedScenarioPaymentReceipt.path, valid: issuedScenarioPaymentReceipt.valid }
    }
  });

  const blendDeployments = runCli(["defi", "blend", "deployments", "--network", "testnet"]);
  if (!blendDeployments.data.pools?.some((pool) => pool.name === "TestnetV2")) {
    throw new Error(`Blend TestnetV2 pool was not listed: ${JSON.stringify(blendDeployments.data.pools)}`);
  }
  step("defi.blend.deployments", {
    pools: blendDeployments.data.pools,
    usdc: blendDeployments.data.assets?.find((asset) => asset.symbol === "USDC")
  });
  const blendTrustline = runCli(["defi", "blend", "trustline", "add", "--account", "agent", "--asset", "USDC"]);
  const blendTrustlineReceipt = verifyOperationReceipt(
    blendTrustline.data.receiptPath,
    "defi.blend.trustline.add",
    blendTrustline.data.transaction.hash
  );
  step("defi.blend.trustline.add", {
    asset: blendTrustline.data.asset,
    transaction: transactionSummary(blendTrustline.data),
    receipt: blendTrustlineReceipt
  });
  const blendSupply = runCli([
    "defi",
    "blend",
    "supply",
    "--pool",
    "TestnetV2",
    "--source",
    "agent",
    "--asset",
    "XLM",
    "--amount",
    "0.1",
    "--collateral"
  ]);
  const blendSupplyReceipt = verifyOperationReceipt(
    blendSupply.data.receiptPath,
    "defi.blend.submit",
    blendSupply.data.transaction.hash
  );
  step("defi.blend.supply", {
    transaction: transactionSummary(blendSupply.data),
    action: blendSupply.data.preflight.actions[0],
    receipt: blendSupplyReceipt
  });
  const blendBatch = runCli([
    "defi",
    "blend",
    "batch",
    "--pool",
    "TestnetV2",
    "--source",
    "agent",
    "--request",
    "supply_collateral:XLM:0.01",
    "--request",
    "withdraw_collateral:XLM:0.005"
  ]);
  const blendBatchReceipt = verifyOperationReceipt(
    blendBatch.data.receiptPath,
    "defi.blend.submit",
    blendBatch.data.transaction.hash
  );
  if (blendBatch.data.preflight.actions.length !== 2) {
    throw new Error(`Blend batch did not preserve both preflight actions: ${JSON.stringify(blendBatch.data.preflight.actions)}`);
  }
  step("defi.blend.batch", {
    transaction: transactionSummary(blendBatch.data),
    actions: blendBatch.data.preflight.actions,
    simulationEvents: blendBatch.data.simulation.events?.length,
    receipt: blendBatchReceipt
  });

  const issuedClaimableCreate = runCli([
    "claimable",
    "create",
    "--from",
    "issuer",
    "--to",
    merchant.publicKey,
    "--amount",
    "0.0000001",
    "--asset",
    issuedPaymentAsset
  ]);
  const issuedBalanceId = issuedClaimableCreate.data.claimableBalances?.find(
    (balance) => balance.asset === issuedPaymentAsset && balance.amount === "0.0000001"
  )?.id;
  if (!issuedBalanceId) throw new Error("Issued-asset claimable balance id was not returned after creation.");
  step("claimable.create-issued-asset", {
    asset: issuedPaymentAsset,
    balanceId: issuedBalanceId,
    transaction: transactionSummary(issuedClaimableCreate.data)
  });
  const issuedClaimableClaim = runCli(["claimable", "claim", "--account", "merchant", "--balance-id", issuedBalanceId]);
  const merchantIssuedBalancesAfterClaim = runCli(["wallet", "balance", "--account", "merchant"]).data.balances;
  const issuedBalanceAfterClaim = merchantIssuedBalancesAfterClaim.find((balance) => balance.asset === issuedPaymentAsset);
  if (!issuedBalanceAfterClaim || issuedBalanceAfterClaim.balance !== "0.0000002") {
    throw new Error(`Issued asset balance was not observed after claim: ${JSON.stringify(issuedBalanceAfterClaim)}`);
  }
  step("claimable.claim-issued-asset", {
    asset: issuedPaymentAsset,
    transaction: transactionSummary(issuedClaimableClaim.data),
    balance: issuedBalanceAfterClaim
  });

  const claimableCreate = runCli([
    "claimable",
    "create",
    "--from",
    "agent",
    "--to",
    merchant.publicKey,
    "--amount",
    "0.0000001",
    "--asset",
    "XLM"
  ]);
  const balanceId = claimableCreate.data.claimableBalances?.find((balance) => balance.amount === "0.0000001")?.id;
  if (!balanceId) throw new Error("Claimable balance id was not returned after creation.");
  const claimableCreateReceipt = verifyOperationReceipt(
    claimableCreate.data.receiptPath,
    "claimable.create",
    claimableCreate.data.hash
  );
  step("claimable.create", { balanceId, transaction: transactionSummary(claimableCreate.data), receipt: claimableCreateReceipt });
  const claimableClaim = runCli(["claimable", "claim", "--account", "merchant", "--balance-id", balanceId]);
  const claimableClaimReceipt = verifyOperationReceipt(
    claimableClaim.data.receiptPath,
    "claimable.claim",
    claimableClaim.data.hash
  );
  step("claimable.claim", { ...transactionSummary(claimableClaim.data), receipt: claimableClaimReceipt });

  const windowStart = new Date(Date.now() - 60_000).toISOString();
  const windowEnd = new Date(Date.now() + 3_600_000).toISOString();
  const timeWindowClaimableCreate = runCli([
    "claimable",
    "create",
    "--from",
    "agent",
    "--to",
    merchant.publicKey,
    "--amount",
    "0.0000002",
    "--asset",
    "XLM",
    "--claimable-after",
    windowStart,
    "--claimable-before",
    windowEnd
  ]);
  const timeWindowBalanceId = timeWindowClaimableCreate.data.claimableBalances?.find(
    (balance) => balance.amount === "0.0000002" && JSON.stringify(balance.claimants).includes("abs_before")
  )?.id;
  if (!timeWindowBalanceId) {
    throw new Error(`Time-window claimable balance id was not returned after creation: ${JSON.stringify(timeWindowClaimableCreate.data)}`);
  }
  if (timeWindowClaimableCreate.data.predicate?.type !== "time_window") {
    throw new Error(`Time-window claimable predicate summary was not returned: ${JSON.stringify(timeWindowClaimableCreate.data.predicate)}`);
  }
  step("claimable.create-time-window", {
    balanceId: timeWindowBalanceId,
    predicate: timeWindowClaimableCreate.data.predicate,
    transaction: transactionSummary(timeWindowClaimableCreate.data)
  });
  const timeWindowClaimableClaim = runCli([
    "claimable",
    "claim",
    "--account",
    "merchant",
    "--balance-id",
    timeWindowBalanceId
  ]);
  step("claimable.claim-time-window", transactionSummary(timeWindowClaimableClaim.data));

  const multiClaimantCreate = runCli([
    "claimable",
    "create",
    "--from",
    "agent",
    "--to",
    merchant.publicKey,
    "--claimant",
    auditor.publicKey,
    "--amount",
    "0.0000003",
    "--asset",
    "XLM"
  ]);
  const auditorClaimableBalances = multiClaimantCreate.data.claimableBalancesByClaimant?.[auditor.publicKey] ?? [];
  const multiClaimantBalance = auditorClaimableBalances.find((balance) => {
    const destinations = balance.claimants?.map((claimant) => claimant.destination) ?? [];
    return balance.amount === "0.0000003" && destinations.includes(merchant.publicKey) && destinations.includes(auditor.publicKey);
  });
  if (!multiClaimantBalance?.id) {
    throw new Error(`Multi-claimant balance was not visible for auditor: ${JSON.stringify(multiClaimantCreate.data)}`);
  }
  step("claimable.create-multi-claimant", {
    balanceId: multiClaimantBalance.id,
    claimants: multiClaimantCreate.data.claimants,
    transaction: transactionSummary(multiClaimantCreate.data)
  });
  const multiClaimantClaim = runCli(["claimable", "claim", "--account", "auditor", "--balance-id", multiClaimantBalance.id]);
  step("claimable.claim-multi-claimant", transactionSummary(multiClaimantClaim.data));

  const approval = runCli([
    "approval",
    "create-payment",
    "--from",
    "agent",
    "--to",
    merchant.publicKey,
    "--amount",
    "6",
    "--asset",
    "XLM"
  ]).data;
  step("approval.create-payment", { id: approval.id, status: approval.status, requestHash: approval.requestHash });
  const approvalDecision = runCli(["approval", "decide", approval.id, "--approve", "--reason", "live-testnet-verification"]).data;
  step("approval.decide", { id: approvalDecision.id, status: approvalDecision.status });
  const approvedPayment = runCli([
    "pay",
    "send",
    "--from",
    "agent",
    "--to",
    merchant.publicKey,
    "--amount",
    "6",
    "--asset",
    "XLM",
    "--approval-id",
    approval.id
  ]);
  step("payment.approval-gated", transactionSummary(approvedPayment.data));

  const signatureRequest = runCli([
    "tx",
    "request-payment-signature",
    "--from",
    "agent",
    "--to",
    merchant.publicKey,
    "--amount",
    "0.0000001",
    "--memo",
    "signed-xdr",
    "--summary",
    "Live verifier signed payment"
  ]).data;
  const transactionApproval = signatureRequest.approval;
  step("tx.request-payment-signature", {
    id: transactionApproval.id,
    status: transactionApproval.status,
    source: signatureRequest.built.source,
    destination: signatureRequest.built.destination
  });
  const signedPaymentXdr = await signTransactionXdr(signatureRequest.built.xdr, "agent");
  const signedApproval = runCli([
    "approval",
    "decide",
    transactionApproval.id,
    "--signer-public-key",
    agent.publicKey,
    "--signed-transaction-xdr",
    signedPaymentXdr
  ]).data;
  step("approval.record-signed-transaction", { id: signedApproval.id, status: signedApproval.status });
  const signedXdrSubmit = runCli(["tx", "submit-approval", transactionApproval.id]);
  step("tx.submit-approval", transactionSummary(signedXdrSubmit.data));

  const paidApiDemo = await startPaidApiDemoChild(merchant.publicKey);
  try {
    const x402 = runCli(["pay", "x402", paidApiDemo.x402Url, "--allow-localhost-demo"]);
    step("x402.local-demo", {
      firstStatus: x402.data.firstStatus,
      finalStatus: x402.data.finalStatus,
      transaction: transactionSummary(x402.data.transaction),
      receiptPath: x402.data.receiptPath
    });

    const mpp = runCli(["pay", "mpp", paidApiDemo.mppUrl, "--allow-localhost-demo"]);
    step("mpp.local-demo", {
      firstStatus: mpp.data.firstStatus,
      finalStatus: mpp.data.finalStatus,
      transaction: transactionSummary(mpp.data.transaction),
      receiptPath: mpp.data.receiptPath
    });

    const mppSession = runCli([
      "pay",
      "mpp-session",
      paidApiDemo.mppSessionUrl,
      "--allow-localhost-demo",
      "--requests",
      "2"
    ]);
    step("mpp.session-demo", {
      firstStatus: mppSession.data.firstStatus,
      finalStatus: mppSession.data.finalStatus,
      requestCount: mppSession.data.requestCount,
      successfulRequests: mppSession.data.successfulRequests,
      transaction: transactionSummary(mppSession.data.transaction),
      receiptPath: mppSession.data.receiptPath
    });
  } finally {
    paidApiDemo.close();
  }

  const doctor = runCli(["contract", "doctor"]);
  step("contract.doctor", doctor.data);
  if (doctor.data.available) {
    const contractAsset = `${uniqueCode("SC")}:${issuer.publicKey}`;
    const deployed = runCli([
      "contract",
      "asset-deploy",
      "--source",
      "agent",
      "--asset",
      contractAsset,
      "--stellar-config-dir",
      stellarConfigDir,
      "--stellar-no-cache"
    ]);
    const contractId = deployed.data.stdout.trim();
    const assetDeployTransactionHash = deployed.data.transactionHash ?? extractStellarCliTransactionHash(deployed.data.stderr);
    if (!assetDeployTransactionHash) {
      throw new Error(`Contract asset deploy did not report a transaction hash for ${contractId}.`);
    }
    const assetDeployReceipt = verifyOperationReceipt(deployed.data.receiptPath, "contract.asset-deploy", assetDeployTransactionHash);
    step("contract.asset-deploy", {
      asset: contractAsset,
      contractId,
      transactionHash: assetDeployTransactionHash,
      receipt: assetDeployReceipt
    });
    const assetContractId = runCli([
      "contract",
      "asset-id",
      "--asset",
      contractAsset,
      "--stellar-config-dir",
      stellarConfigDir,
      "--stellar-no-cache"
    ]);
    if (assetContractId.data.stdout.trim() !== contractId) {
      throw new Error(`Asset contract id lookup did not match deployed id: ${assetContractId.data.stdout.trim()} !== ${contractId}`);
    }
    step("contract.asset-id", {
      asset: contractAsset,
      contractId: assetContractId.data.stdout.trim()
    });
    const contractRead = runCli([
      "contract",
      "read",
      "--id",
      contractId,
      "--stellar-config-dir",
      stellarConfigDir,
      "--stellar-no-cache"
    ]);
    if (!contractRead.data.stdout.includes("LedgerKeyContractInstance")) {
      throw new Error(`Contract read returned unexpected output for ${contractId}: ${contractRead.data.stdout}`);
    }
    step("contract.read", {
      contractId,
      stdoutPreview: contractRead.data.stdout.trim().slice(0, 500)
    });
    const contractExtend = runCli([
      "contract",
      "extend",
      "--source",
      "agent",
      "--id",
      contractId,
      "--ledgers-to-extend",
      "535679",
      "--stellar-config-dir",
      stellarConfigDir,
      "--stellar-no-cache"
    ]);
    if (!contractExtend.data.stdout.includes("New ttl ledger")) {
      throw new Error(`Contract extend returned unexpected output for ${contractId}: ${contractExtend.data.stdout}`);
    }
    const contractExtendTransactionHash = contractExtend.data.transactionHash ?? extractStellarCliTransactionHash(contractExtend.data.stderr);
    if (!contractExtendTransactionHash) {
      throw new Error(`Contract extend did not report a transaction hash for ${contractId}.`);
    }
    const contractExtendReceipt = verifyOperationReceipt(contractExtend.data.receiptPath, "contract.extend", contractExtendTransactionHash);
    step("contract.extend", {
      contractId,
      stdout: contractExtend.data.stdout.trim(),
      transactionHash: contractExtendTransactionHash,
      receipt: contractExtendReceipt
    });
    const contractInfo = runCli([
      "contract",
      "info",
      "--kind",
      "interface",
      "--id",
      contractId,
      "--stellar-config-dir",
      stellarConfigDir,
      "--stellar-no-cache"
    ]);
    if (!contractInfo.data.stdout.trim()) {
      throw new Error(`Contract info returned empty stdout for ${contractId}.`);
    }
    step("contract.info", {
      contractId,
      kind: "interface",
      stdoutPreview: contractInfo.data.stdout.trim().slice(0, 500)
    });
    const invoked = runCli([
      "contract",
      "invoke",
      "--id",
      contractId,
      "--source",
      "agent",
      "--fn",
      "symbol",
      "--stellar-config-dir",
      stellarConfigDir,
      "--stellar-no-cache"
    ]);
    step("contract.invoke", {
      contractId,
      functionName: "symbol",
      stdout: invoked.data.stdout.trim()
    });
    const scenarioContractAsset = `${uniqueCode("CS")}:${issuer.publicKey}`;
    const contractScenario = runCli([
      "testnet",
      "scenario",
      "contract-asset-smoke",
      "--source",
      "agent",
      "--asset",
      scenarioContractAsset,
      "--stellar-config-dir",
      stellarConfigDir,
      "--stellar-no-cache"
    ]);
    if (!contractScenario.data.deploy?.contractId) {
      throw new Error(`Contract asset smoke scenario did not return a contract id: ${JSON.stringify(contractScenario.data)}`);
    }
    if (!contractScenario.data.deploy?.transactionHash || !contractScenario.data.deploy?.receiptPath) {
      throw new Error(`Contract asset smoke scenario did not return deploy receipt metadata: ${JSON.stringify(contractScenario.data.deploy)}`);
    }
    if (!contractScenario.data.extend?.transactionHash || !contractScenario.data.extend?.receiptPath) {
      throw new Error(`Contract asset smoke scenario did not return extend receipt metadata: ${JSON.stringify(contractScenario.data.extend)}`);
    }
    const scenarioDeployReceipt = verifyOperationReceipt(
      contractScenario.data.deploy.receiptPath,
      "contract.asset-deploy",
      contractScenario.data.deploy.transactionHash
    );
    const scenarioExtendReceipt = verifyOperationReceipt(
      contractScenario.data.extend.receiptPath,
      "contract.extend",
      contractScenario.data.extend.transactionHash
    );
    step("scenario.contract-asset-smoke", {
      asset: scenarioContractAsset,
      contractId: contractScenario.data.deploy.contractId,
      deploy: {
        transactionHash: contractScenario.data.deploy.transactionHash,
        receipt: scenarioDeployReceipt
      },
      extend: {
        transactionHash: contractScenario.data.extend.transactionHash,
        receipt: scenarioExtendReceipt
      },
      invokeStdout: contractScenario.data.invoke?.stdout?.trim()
    });
  } else {
    step("contract.skipped", { reason: "stellar CLI unavailable", doctor: doctor.data });
  }

  const ledgerExport = runCli(["ledger", "export", "--output", join(root, "ledger-report.json")]);
  if (!ledgerExport.data.report?.receipts?.length) {
    throw new Error("Ledger export did not include any receipts.");
  }
  step("ledger.export", { path: ledgerExport.data.path, receipts: ledgerExport.data.report.receipts.length });
  const testnetExport = runCli(["testnet", "export-report", "--output", join(root, "testnet-report.json")]);
  if (!testnetExport.data.report?.wallets?.some((wallet) => wallet.name === "agent" && wallet.exists)) {
    throw new Error("Testnet export did not include the agent wallet.");
  }
  step("testnet.export-report", { path: testnetExport.data.path, wallets: testnetExport.data.report.wallets.length });

  report.finishedAt = new Date().toISOString();
  report.ok = true;
  const reportPath = join(root, "live-verification-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, reportPath, report }, null, 2));
} catch (error) {
  report.finishedAt = new Date().toISOString();
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  const reportPath = join(root, "live-verification-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.error(JSON.stringify({ ok: false, reportPath, report }, null, 2));
  process.exit(1);
}

function runCli(args) {
  const fullArgs = ["packages/cli/dist/index.js", "--config", configPath, "--json", ...args];
  const result = spawnSync(process.execPath, fullArgs, {
    encoding: "utf8",
    timeout: 180_000,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: stellarConfigDir,
      STELLAR_NO_CACHE: "true"
    }
  });
  const stdout = result.stdout.trim();
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): node ${fullArgs.join(" ")}\n${result.stderr}\n${stdout}`);
  }
  const parsed = JSON.parse(stdout);
  if (!parsed.ok) {
    throw new Error(`Command returned error: node ${fullArgs.join(" ")}\n${stdout}`);
  }
  return parsed;
}

async function signTransactionXdr(xdr, sourceName) {
  const wallet = JSON.parse(await readFile(join(root, "wallets", `testnet-${sourceName}.json`), "utf8"));
  const tx = new Transaction(xdr, "Test SDF Network ; September 2015");
  tx.sign(Keypair.fromSecret(wallet.secretKey));
  return tx.toXDR();
}

async function allowPolicyAsset(asset) {
  const policyPath = join(root, "policies", "default-testnet.yaml");
  const policy = parseYaml(await readFile(policyPath, "utf8"));
  policy.assets ??= {};
  policy.assets.allow = Array.from(new Set([...(policy.assets.allow ?? []), asset]));
  await writeFile(policyPath, stringifyYaml(policy), { mode: 0o600 });
  step("policy.allow-issued-asset", { asset, policyPath });
}

function startPaidApiDemoChild(recipient) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["apps/paid-api-demo/server.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        STELLAR_AGENT_DEMO_RECIPIENT: recipient
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let x402Url;
    let mppUrl;
    let mppSessionUrl;
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out waiting for paid API demo startup. ${stderr}`));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      for (const line of chunk.split(/\r?\n/)) {
        const x402Match = /x402 paid API demo listening at (.+)$/.exec(line);
        const mppMatch = /MPP paid API demo listening at (.+)$/.exec(line);
        const mppSessionMatch = /MPP session demo listening at (.+)$/.exec(line);
        if (x402Match?.[1]) x402Url = x402Match[1];
        if (mppMatch?.[1]) mppUrl = mppMatch[1];
        if (mppSessionMatch?.[1]) mppSessionUrl = mppSessionMatch[1];
      }
      if (x402Url && mppUrl && mppSessionUrl) {
        clearTimeout(timer);
        resolve({
          x402Url,
          mppUrl,
          mppSessionUrl,
          close: () => child.kill("SIGTERM")
        });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("exit", (code) => {
      if (!x402Url || !mppUrl || !mppSessionUrl) {
        clearTimeout(timer);
        reject(new Error(`Paid API demo exited before startup with code ${code}. ${stderr}`));
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function step(name, data) {
  report.steps.push({
    name,
    at: new Date().toISOString(),
    data
  });
}

function uniqueCode(prefix) {
  return `${prefix}${Date.now().toString(36).slice(-8).toUpperCase()}`.slice(0, 12);
}

function transactionSummary(value) {
  if (!value) return undefined;
  const transaction = value.transaction ?? value;
  return {
    hash: transaction.hash,
    ledger: transaction.ledger,
    successful: transaction.successful,
    feeCharged: transaction.feeCharged,
    receiptPath: value.receiptPath
  };
}

function verifyOperationReceipt(path, operationType, transactionHash) {
  if (!path) throw new Error(`Missing receipt path for ${operationType}.`);
  const receipt = runCli(["receipts", "show", path]).data;
  if (receipt.operation?.type !== operationType) {
    throw new Error(`Receipt ${path} operation type mismatch: ${receipt.operation?.type} !== ${operationType}`);
  }
  if (receipt.transaction?.hash !== transactionHash) {
    throw new Error(`Receipt ${path} transaction hash mismatch: ${receipt.transaction?.hash} !== ${transactionHash}`);
  }
  const verification = runCli(["receipts", "verify", path]).data;
  if (!verification.valid) throw new Error(`Receipt ${path} did not verify.`);
  return { path, valid: verification.valid };
}

function extractStellarCliTransactionHash(stderr) {
  const match = /Signing transaction:\s*([a-f0-9]{64})/i.exec(stderr);
  return match?.[1];
}

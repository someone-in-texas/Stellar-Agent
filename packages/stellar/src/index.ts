import {
  EXIT_CODES,
  NetworkProfile,
  StellarAgentError,
  TESTNET_PROFILE,
  TestnetWallet,
  formatStroops,
  parseAmount,
  parseAsset,
  redactWallet
} from "@stellar-agent/core";
import {
  Account,
  Asset,
  BASE_FEE,
  Claimant,
  Horizon,
  Keypair,
  LiquidityPoolAsset,
  LiquidityPoolFeeV18,
  Memo,
  Operation,
  TransactionBuilder,
  getLiquidityPoolId,
  xdr
} from "@stellar/stellar-sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FriendbotResult {
  funded: boolean;
  hash?: string;
  alreadyFunded?: boolean;
}

export interface BalanceLine {
  asset: string;
  balance: string;
}

export interface SubmittedPayment {
  hash: string;
  ledger?: number;
  successful: boolean;
  feeCharged?: string;
  feeBid?: string;
  feeStrategy?: FeeStrategy;
}

export interface SubmittedOperation {
  hash: string;
  ledger?: number;
  successful: boolean;
  feeCharged?: string;
  feeBid?: string;
  feeStrategy?: FeeStrategy;
}

export interface SubmittedTransaction {
  hash: string;
  ledger?: number;
  successful: boolean;
  feeCharged?: string;
}

export type FeeStrategy = "base" | "low" | "medium" | "high" | "p95";

export interface FeeStatsSummary {
  source: "horizon" | "base_fee_fallback";
  strategy: FeeStrategy;
  perOperationFee: string;
  transactionFee: string;
  operationCount: number;
  cached: boolean;
  ledgerCapacityUsage?: string;
}

export interface BuiltPaymentTransactionXdr {
  xdr: string;
  source: string;
  destination: string;
  amount: string;
  asset: string;
  networkPassphrase: string;
  fee: FeeStatsSummary;
}

export interface BatchPaymentItem {
  destination: string;
  amount: string;
  asset?: string;
}

export interface SubmittedPaymentBatch extends SubmittedOperation {
  operationCount: number;
  payments: Array<{
    destination: string;
    amount: string;
    asset: string;
  }>;
}

export interface ClaimableBalanceRecord {
  id: string;
  asset: string;
  amount: string;
  sponsor?: string;
  lastModifiedLedger?: number;
  claimants: Array<{
    destination: string;
    predicate?: unknown;
  }>;
}

export interface LiquidityPoolReserve {
  asset: string;
  amount: string;
}

export interface LiquidityPoolSummary {
  id: string;
  pagingToken?: string;
  feeBp: number;
  type: string;
  totalTrustlines: string;
  totalShares: string;
  reserves: LiquidityPoolReserve[];
}

export interface LiquidityPoolPosition {
  account: string;
  poolId: string;
  shares: string;
  limit?: string;
  shareOfPool?: number;
  estimatedReserves?: LiquidityPoolReserve[];
  pool?: LiquidityPoolSummary;
}

export interface LiquidityPoolPreflight {
  action: "deposit" | "withdraw";
  pool: LiquidityPoolSummary;
  account?: string;
  assets: string[];
  currentPrice?: string;
  nominalExposure: {
    value: string;
    semantics: "sum_of_max_reserve_amounts_not_mark_to_market" | "not_applicable_to_withdrawal";
  };
  trustlines?: {
    reserveAssetsSatisfied: boolean;
    poolShareSatisfied: boolean;
    missing: string[];
  };
  deposit?: {
    maxAmountA: string;
    maxAmountB: string;
    minPrice: string;
    maxPrice: string;
    estimatedShares?: string;
  };
  withdraw?: {
    shares: string;
    minAmountA: string;
    minAmountB: string;
    estimatedReserves?: LiquidityPoolReserve[];
  };
  risk: {
    notes: string[];
  };
}

export interface ClaimableTimestamp {
  epochSeconds: string;
  iso: string;
}

export interface ClaimableBalancePredicateOptions {
  claimableAfter?: string | number | Date;
  claimableBefore?: string | number | Date;
}

export interface ClaimableBalancePredicateSummary {
  type: "unconditional" | "not_before_absolute_time" | "before_absolute_time" | "time_window";
  claimableAfter?: ClaimableTimestamp;
  claimableBefore?: ClaimableTimestamp;
}

export interface HorizonCollectionResult<T = unknown> {
  records: T[];
  next?: string;
  previous?: string;
}

export interface StellarCliStatus {
  available: boolean;
  binary: string;
  version?: string;
  error?: string;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const sessionCache = new Map<string, CacheEntry<unknown>>();

export function clearStellarSessionCache(): void {
  sessionCache.clear();
}

export function stellarSessionCacheSnapshot(now = Date.now()): Array<{
  key: string;
  expiresAt: string;
  ttlMs: number;
}> {
  return Array.from(sessionCache.entries()).map(([key, entry]) => ({
    key,
    expiresAt: new Date(entry.expiresAt).toISOString(),
    ttlMs: Math.max(0, entry.expiresAt - now)
  }));
}

export function resolveNetworkProfile(profileName: string, profiles: Record<string, NetworkProfile>): NetworkProfile {
  const profile = profiles[profileName];
  if (!profile) {
    throw new StellarAgentError({
      code: "PROFILE_NOT_FOUND",
      message: `Profile '${profileName}' was not found.`,
      hint: "Run stellar-agent profile list to see configured profiles."
    });
  }
  return profile;
}

export function createTestnetWallet(name: string): TestnetWallet {
  const pair = Keypair.random();
  return {
    schemaVersion: "stellar-agent.wallet.v1",
    name,
    network: "testnet",
    publicKey: pair.publicKey(),
    secretKey: pair.secret(),
    createdAt: new Date().toISOString(),
    source: "generated-testnet"
  };
}

export function publicWalletView(wallet: TestnetWallet): ReturnType<typeof redactWallet> {
  return redactWallet(wallet);
}

export async function fundWithFriendbot(
  address: string,
  profile: NetworkProfile = TESTNET_PROFILE,
  fetchImpl: typeof fetch = fetch
): Promise<FriendbotResult> {
  if (!profile.friendbotUrl) {
    throw new StellarAgentError({
      code: "FRIENDBOT_UNAVAILABLE",
      message: "Friendbot is not configured for this profile.",
      docs: "docs/troubleshooting.md#friendbot-unavailable"
    });
  }
  const url = new URL(profile.friendbotUrl);
  url.searchParams.set("addr", address);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
      const body = await response.text();
      if (response.ok) {
        const parsed = safeJson(body);
        return {
          funded: true,
          hash: parsed?.hash ?? parsed?._links?.transaction?.href?.split("/").pop()
        };
      }
      if (/already|exist|funded/i.test(body)) {
        return { funded: true, alreadyFunded: true };
      }
      lastError = body;
    } catch (error) {
      lastError = error;
    }
  }

  throw new StellarAgentError({
    code: "FRIENDBOT_UNAVAILABLE",
    message: "Could not fund the Testnet account with Friendbot.",
    hint: "Check your internet connection or try again later.",
    docs: "docs/troubleshooting.md#friendbot-unavailable",
    details: String(lastError)
  });
}

export async function getBalances(
  address: string,
  profile: NetworkProfile = TESTNET_PROFILE
): Promise<BalanceLine[]> {
  if (!profile.horizonUrl) {
    throw new StellarAgentError({
      code: "HORIZON_UNAVAILABLE",
      message: "Horizon is not configured for this profile.",
      docs: "docs/troubleshooting.md#rpc-unavailable"
    });
  }

  const server = new Horizon.Server(profile.horizonUrl);
  try {
    const account = await server.loadAccount(address);
    return account.balances.map((balance: any) => ({
      asset: balance.asset_type === "native" ? "XLM" : `${balance.asset_code}:${balance.asset_issuer}`,
      balance: balance.balance
    }));
  } catch (error) {
    throw new StellarAgentError({
      code: "HORIZON_UNAVAILABLE",
      message: "Could not load account balances from Horizon.",
      hint: "Confirm the account exists and Horizon is reachable.",
      docs: "docs/troubleshooting.md#rpc-unavailable",
      details: String(error)
    });
  }
}

export async function sendNativePayment(args: {
  source: TestnetWallet;
  destination: string;
  amount: string;
  memo?: string;
  profile?: NetworkProfile;
}): Promise<SubmittedPayment> {
  return sendPayment({ ...args, asset: "XLM" });
}

export async function sendPayment(args: {
  source: TestnetWallet;
  destination: string;
  amount: string;
  asset?: string;
  memo?: string;
  profile?: NetworkProfile;
  feeStrategy?: FeeStrategy;
  noCache?: boolean;
}): Promise<SubmittedPayment> {
  const profile = args.profile ?? TESTNET_PROFILE;
  const amount = parseAmount(args.amount).value;
  const asset = stellarSdkAsset(args.asset ?? "XLM");

  try {
    return await submitOperation({
      source: args.source,
      profile,
      ...(args.memo === undefined ? {} : { memo: args.memo }),
      ...(args.feeStrategy === undefined ? {} : { feeStrategy: args.feeStrategy }),
      ...(args.noCache === undefined ? {} : { noCache: args.noCache }),
      operation:
      Operation.payment({
        destination: args.destination,
        asset,
        amount
      })
    });
  } catch (error) {
    throw new StellarAgentError({
      code: "TRANSACTION_SUBMIT_FAILED",
      message: "Stellar payment could not be submitted or confirmed.",
      hint: "Check wallet funding, destination address, and Horizon availability.",
      docs: "docs/troubleshooting.md#transaction-timeout",
      details: String(error)
    });
  }
}

export async function changeTrustline(args: {
  source: TestnetWallet;
  asset: string;
  limit?: string;
  profile?: NetworkProfile;
  feeStrategy?: FeeStrategy;
  noCache?: boolean;
}): Promise<SubmittedOperation & { asset: string; limit: string }> {
  const asset = stellarSdkAsset(args.asset);
  if (asset.isNative()) {
    throw new StellarAgentError({
      code: "INVALID_ASSET",
      message: "Native XLM does not use trustlines.",
      docs: "docs/quickstart-testnet.md#trustlines"
    });
  }
  const limit = normalizeTrustlineLimit(args.limit ?? "922337203685.4775807");
  const submitted = await submitOperation({
    source: args.source,
    profile: args.profile ?? TESTNET_PROFILE,
    ...(args.feeStrategy === undefined ? {} : { feeStrategy: args.feeStrategy }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache }),
    operation: Operation.changeTrust({ asset, limit })
  });
  return { ...submitted, asset: args.asset.toUpperCase(), limit };
}

export async function removeTrustline(args: {
  source: TestnetWallet;
  asset: string;
  profile?: NetworkProfile;
}): Promise<SubmittedOperation & { asset: string; limit: "0" }> {
  const submitted = await changeTrustline({
    source: args.source,
    asset: args.asset,
    limit: "0",
    ...(args.profile === undefined ? {} : { profile: args.profile })
  });
  return { ...submitted, limit: "0" };
}

export async function createClaimableBalance(args: {
  source: TestnetWallet;
  amount: string;
  asset?: string;
  claimant: string;
  claimants?: string[];
  claimableAfter?: string | number | Date;
  claimableBefore?: string | number | Date;
  profile?: NetworkProfile;
  feeStrategy?: FeeStrategy;
  noCache?: boolean;
}): Promise<
  SubmittedOperation & {
    asset: string;
    amount: string;
    claimant: string;
    claimants: string[];
    predicate: ClaimableBalancePredicateSummary;
    claimableBalances: ClaimableBalanceRecord[];
    claimableBalancesByClaimant: Record<string, ClaimableBalanceRecord[]>;
  }
> {
  const profile = args.profile ?? TESTNET_PROFILE;
  const asset = stellarSdkAsset(args.asset ?? "XLM");
  const amount = parseAmount(args.amount, args.asset ?? "XLM").value;
  const claimants = resolveClaimableBalanceClaimants(args.claimant, args.claimants);
  const claimantPredicate = buildClaimableBalancePredicate({
    ...(args.claimableAfter === undefined ? {} : { claimableAfter: args.claimableAfter }),
    ...(args.claimableBefore === undefined ? {} : { claimableBefore: args.claimableBefore })
  });
  const submitted = await submitOperation({
    source: args.source,
    profile,
    ...(args.feeStrategy === undefined ? {} : { feeStrategy: args.feeStrategy }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache }),
    operation: Operation.createClaimableBalance({
      asset,
      amount,
      claimants: claimants.map((claimant) => new Claimant(claimant, claimantPredicate.predicate))
    })
  });
  const claimableBalanceEntries = await Promise.all(
    claimants.map(async (claimant) => [claimant, await listClaimableBalances(claimant, profile)] as const)
  );
  const claimableBalancesByClaimant = Object.fromEntries(claimableBalanceEntries);
  return {
    ...submitted,
    asset: args.asset ?? "XLM",
    amount,
    claimant: args.claimant,
    claimants,
    predicate: claimantPredicate.summary,
    claimableBalances: claimableBalancesByClaimant[args.claimant] ?? [],
    claimableBalancesByClaimant
  };
}

export function buildClaimableBalancePredicate(options: ClaimableBalancePredicateOptions = {}): {
  predicate: xdr.ClaimPredicate;
  summary: ClaimableBalancePredicateSummary;
} {
  const claimableAfter =
    options.claimableAfter === undefined ? undefined : parseClaimableTimestamp(options.claimableAfter, "claimableAfter");
  const claimableBefore =
    options.claimableBefore === undefined ? undefined : parseClaimableTimestamp(options.claimableBefore, "claimableBefore");

  if (claimableAfter && claimableBefore && BigInt(claimableAfter.epochSeconds) >= BigInt(claimableBefore.epochSeconds)) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "claimableAfter must be earlier than claimableBefore.",
      docs: "docs/claimable-balances.md#time-bound-claiming"
    });
  }

  if (claimableAfter && claimableBefore) {
    return {
      predicate: Claimant.predicateAnd(
        Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(claimableAfter.epochSeconds)),
        Claimant.predicateBeforeAbsoluteTime(claimableBefore.epochSeconds)
      ),
      summary: { type: "time_window", claimableAfter, claimableBefore }
    };
  }

  if (claimableAfter) {
    return {
      predicate: Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(claimableAfter.epochSeconds)),
      summary: { type: "not_before_absolute_time", claimableAfter }
    };
  }

  if (claimableBefore) {
    return {
      predicate: Claimant.predicateBeforeAbsoluteTime(claimableBefore.epochSeconds),
      summary: { type: "before_absolute_time", claimableBefore }
    };
  }

  return {
    predicate: Claimant.predicateUnconditional(),
    summary: { type: "unconditional" }
  };
}

export function resolveClaimableBalanceClaimants(claimant: string, claimants: string[] = []): string[] {
  return uniqueClaimants([claimant, ...claimants]);
}

export async function claimClaimableBalance(args: {
  source: TestnetWallet;
  balanceId: string;
  profile?: NetworkProfile;
  feeStrategy?: FeeStrategy;
  noCache?: boolean;
}): Promise<SubmittedOperation & { balanceId: string }> {
  const submitted = await submitOperation({
    source: args.source,
    profile: args.profile ?? TESTNET_PROFILE,
    ...(args.feeStrategy === undefined ? {} : { feeStrategy: args.feeStrategy }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache }),
    operation: Operation.claimClaimableBalance({ balanceId: args.balanceId })
  });
  return { ...submitted, balanceId: args.balanceId };
}

export async function listLiquidityPools(args: {
  profile?: NetworkProfile;
  assetA?: string;
  assetB?: string;
  account?: string;
  limit?: number;
} = {}): Promise<HorizonCollectionResult<LiquidityPoolSummary>> {
  const profile = args.profile ?? TESTNET_PROFILE;
  if (!profile.horizonUrl) {
    throw new StellarAgentError({ code: "HORIZON_UNAVAILABLE", message: "Horizon is not configured." });
  }
  const url = new URL(`${profile.horizonUrl.replace(/\/$/, "")}/liquidity_pools`);
  if (args.assetA && args.assetB) {
    url.searchParams.set("reserves", `${stellarSdkAsset(args.assetA).toString()},${stellarSdkAsset(args.assetB).toString()}`);
  }
  if (args.account) url.searchParams.set("account", args.account);
  url.searchParams.set("order", "desc");
  url.searchParams.set("limit", String(args.limit ?? 10));
  const page: any = await horizonGet(url, "Could not list liquidity pools from Horizon.");
  return collectionResult(horizonRecords(page).map(normalizeLiquidityPoolRecord), page);
}

export async function inspectLiquidityPool(args: {
  poolId: string;
  profile?: NetworkProfile;
}): Promise<LiquidityPoolSummary> {
  validateLiquidityPoolId(args.poolId);
  const profile = args.profile ?? TESTNET_PROFILE;
  if (!profile.horizonUrl) {
    throw new StellarAgentError({ code: "HORIZON_UNAVAILABLE", message: "Horizon is not configured." });
  }
  try {
    return normalizeLiquidityPoolRecord(
      await horizonGet(
        new URL(`${profile.horizonUrl.replace(/\/$/, "")}/liquidity_pools/${args.poolId}`),
        "Could not inspect liquidity pool from Horizon."
      )
    );
  } catch (error) {
    if (error instanceof StellarAgentError) throw error;
    throw new StellarAgentError({
      code: "LEDGER_LOOKUP_FAILED",
      message: "Could not inspect liquidity pool from Horizon.",
      docs: "docs/market-liquidity.md#core-pool-inspection",
      details: String(error)
    });
  }
}

export async function liquidityPoolTrades(args: {
  poolId: string;
  profile?: NetworkProfile;
  limit?: number;
}): Promise<HorizonCollectionResult<unknown>> {
  validateLiquidityPoolId(args.poolId);
  const profile = args.profile ?? TESTNET_PROFILE;
  if (!profile.horizonUrl) {
    throw new StellarAgentError({ code: "HORIZON_UNAVAILABLE", message: "Horizon is not configured." });
  }
  const url = new URL(`${profile.horizonUrl.replace(/\/$/, "")}/liquidity_pools/${args.poolId}/trades`);
  url.searchParams.set("order", "desc");
  url.searchParams.set("limit", String(args.limit ?? 10));
  const page: any = await horizonGet(url, "Could not fetch liquidity pool trades from Horizon.");
  return collectionResult(horizonRecords(page), page);
}

export async function inspectLiquidityPoolPosition(args: {
  account: string;
  poolId?: string;
  profile?: NetworkProfile;
}): Promise<{ account: string; positions: LiquidityPoolPosition[] }> {
  if (args.poolId) validateLiquidityPoolId(args.poolId);
  const profile = args.profile ?? TESTNET_PROFILE;
  if (!profile.horizonUrl) {
    throw new StellarAgentError({ code: "HORIZON_UNAVAILABLE", message: "Horizon is not configured." });
  }
  const account: any = await horizonGet(
    new URL(`${profile.horizonUrl.replace(/\/$/, "")}/accounts/${args.account}`),
    "Could not load account liquidity pool positions from Horizon."
  );
  const poolShareBalances = account.balances.filter((balance: any) => balance.asset_type === "liquidity_pool_shares");
  const positions = await Promise.all(
    poolShareBalances
      .filter((balance: any) => !args.poolId || balance.liquidity_pool_id === args.poolId)
      .map(async (balance: any) => {
        const pool = await inspectLiquidityPool({ poolId: balance.liquidity_pool_id, profile });
        const shareOfPool = liquidityPoolShareRatio(balance.balance, pool.totalShares);
        return {
          account: args.account,
          poolId: balance.liquidity_pool_id,
          shares: balance.balance,
          ...(balance.limit === undefined ? {} : { limit: balance.limit }),
          ...(shareOfPool === undefined ? {} : { shareOfPool }),
          ...(shareOfPool === undefined ? {} : { estimatedReserves: estimatePoolReserves(pool, shareOfPool) }),
          pool
        };
      })
  );
  return { account: args.account, positions };
}

export async function preflightLiquidityPoolDeposit(args: {
  poolId: string;
  maxAmountA: string;
  maxAmountB: string;
  minPrice: string;
  maxPrice: string;
  account?: string;
  profile?: NetworkProfile;
}): Promise<LiquidityPoolPreflight> {
  validateLiquidityPoolId(args.poolId);
  validatePoolPriceBounds(args.minPrice, args.maxPrice);
  const profile = args.profile ?? TESTNET_PROFILE;
  const pool = await inspectLiquidityPool({ poolId: args.poolId, profile });
  const reserves = requireTwoPoolReserves(pool);
  const maxAmountA = parseAmount(args.maxAmountA, reserves[0].asset).value;
  const maxAmountB = parseAmount(args.maxAmountB, reserves[1].asset).value;
  const currentPrice = poolPrice(pool);
  const estimatedShares = estimateDepositShares(pool, maxAmountA, maxAmountB);
  return {
    action: "deposit",
    pool,
    ...(args.account === undefined ? {} : { account: args.account }),
    assets: reserves.map((reserve) => reserve.asset),
    ...(currentPrice === undefined ? {} : { currentPrice }),
    nominalExposure: {
      value: nominalDepositExposure(maxAmountA, maxAmountB),
      semantics: "sum_of_max_reserve_amounts_not_mark_to_market"
    },
    ...(args.account === undefined ? {} : { trustlines: await liquidityPoolTrustlineStatus(args.account, pool, profile) }),
    deposit: {
      maxAmountA,
      maxAmountB,
      minPrice: args.minPrice,
      maxPrice: args.maxPrice,
      ...(estimatedShares === undefined ? {} : { estimatedShares })
    },
    risk: liquidityPoolRiskNotes(pool)
  };
}

export async function preflightLiquidityPoolWithdraw(args: {
  poolId: string;
  shares: string;
  minAmountA: string;
  minAmountB: string;
  account?: string;
  profile?: NetworkProfile;
}): Promise<LiquidityPoolPreflight> {
  validateLiquidityPoolId(args.poolId);
  const profile = args.profile ?? TESTNET_PROFILE;
  const pool = await inspectLiquidityPool({ poolId: args.poolId, profile });
  const reserves = requireTwoPoolReserves(pool);
  const shares = parseAmount(args.shares, "pool_shares").value;
  const shareOfPool = liquidityPoolShareRatio(shares, pool.totalShares);
  return {
    action: "withdraw",
    pool,
    ...(args.account === undefined ? {} : { account: args.account }),
    assets: reserves.map((reserve) => reserve.asset),
    nominalExposure: {
      value: "0.0000000",
      semantics: "not_applicable_to_withdrawal"
    },
    ...(args.account === undefined ? {} : { trustlines: await liquidityPoolTrustlineStatus(args.account, pool, profile) }),
    withdraw: {
      shares,
      minAmountA: normalizeAmountAllowZero(args.minAmountA),
      minAmountB: normalizeAmountAllowZero(args.minAmountB),
      ...(shareOfPool === undefined ? {} : { estimatedReserves: estimatePoolReserves(pool, shareOfPool) })
    },
    risk: liquidityPoolRiskNotes(pool)
  };
}

export async function changeLiquidityPoolTrustline(args: {
  source: TestnetWallet;
  poolId?: string;
  assetA?: string;
  assetB?: string;
  limit?: string;
  profile?: NetworkProfile;
  feeStrategy?: FeeStrategy;
  noCache?: boolean;
}): Promise<SubmittedOperation & { poolId: string; limit: string }> {
  const poolAsset = await resolveLiquidityPoolAssetForTrustline(args);
  const limit = normalizeTrustlineLimit(args.limit ?? "922337203685.4775807");
  const submitted = await submitOperation({
    source: args.source,
    profile: args.profile ?? TESTNET_PROFILE,
    ...(args.feeStrategy === undefined ? {} : { feeStrategy: args.feeStrategy }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache }),
    operation: Operation.changeTrust({ asset: poolAsset.asset as any, limit })
  });
  return { ...submitted, poolId: poolAsset.poolId, limit };
}

export async function submitLiquidityPoolDeposit(args: {
  source: TestnetWallet;
  poolId: string;
  maxAmountA: string;
  maxAmountB: string;
  minPrice: string;
  maxPrice: string;
  profile?: NetworkProfile;
  feeStrategy?: FeeStrategy;
  noCache?: boolean;
}): Promise<SubmittedOperation & { preflight: LiquidityPoolPreflight }> {
  validatePoolPriceBounds(args.minPrice, args.maxPrice);
  const profile = args.profile ?? TESTNET_PROFILE;
  const preflight = await preflightLiquidityPoolDeposit({
    poolId: args.poolId,
    maxAmountA: args.maxAmountA,
    maxAmountB: args.maxAmountB,
    minPrice: args.minPrice,
    maxPrice: args.maxPrice,
    account: args.source.publicKey,
    profile
  });
  const submitted = await submitOperation({
    source: args.source,
    profile,
    ...(args.feeStrategy === undefined ? {} : { feeStrategy: args.feeStrategy }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache }),
    operation: Operation.liquidityPoolDeposit({
      liquidityPoolId: args.poolId,
      maxAmountA: preflight.deposit!.maxAmountA,
      maxAmountB: preflight.deposit!.maxAmountB,
      minPrice: args.minPrice,
      maxPrice: args.maxPrice
    })
  });
  return { ...submitted, preflight };
}

export async function submitLiquidityPoolWithdraw(args: {
  source: TestnetWallet;
  poolId: string;
  shares: string;
  minAmountA: string;
  minAmountB: string;
  profile?: NetworkProfile;
  feeStrategy?: FeeStrategy;
  noCache?: boolean;
}): Promise<SubmittedOperation & { preflight: LiquidityPoolPreflight }> {
  const profile = args.profile ?? TESTNET_PROFILE;
  const preflight = await preflightLiquidityPoolWithdraw({
    poolId: args.poolId,
    shares: args.shares,
    minAmountA: args.minAmountA,
    minAmountB: args.minAmountB,
    account: args.source.publicKey,
    profile
  });
  const submitted = await submitOperation({
    source: args.source,
    profile,
    ...(args.feeStrategy === undefined ? {} : { feeStrategy: args.feeStrategy }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache }),
    operation: Operation.liquidityPoolWithdraw({
      liquidityPoolId: args.poolId,
      amount: preflight.withdraw!.shares,
      minAmountA: preflight.withdraw!.minAmountA,
      minAmountB: preflight.withdraw!.minAmountB
    })
  });
  return { ...submitted, preflight };
}

export async function buildPaymentTransactionXdr(args: {
  sourcePublicKey: string;
  destination: string;
  amount: string;
  asset?: string;
  memo?: string;
  profile?: NetworkProfile;
  sourceSequence?: string;
  allowRealFunds?: boolean;
  feeStrategy?: FeeStrategy;
  noCache?: boolean;
}): Promise<BuiltPaymentTransactionXdr> {
  const profile = args.profile ?? TESTNET_PROFILE;
  if (profile.realFunds && !args.allowRealFunds) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Mainnet payment-XDR building requires explicit real-funds approval.",
      docs: "docs/mainnet-safety.md"
    });
  }
  if (!profile.horizonUrl && !args.sourceSequence) {
    throw new StellarAgentError({
      code: "HORIZON_UNAVAILABLE",
      message: "Horizon is not configured for this profile."
    });
  }
  const amount = parseAmount(args.amount, args.asset ?? "XLM").value;
  const asset = stellarSdkAsset(args.asset ?? "XLM");
  const sourceAccount = args.sourceSequence
    ? new Account(args.sourcePublicKey, args.sourceSequence)
    : await new Horizon.Server(profile.horizonUrl!).loadAccount(args.sourcePublicKey);
  const fee = await estimateTransactionFee({
    profile,
    operationCount: 1,
    strategy: args.feeStrategy ?? "medium",
    ...(args.noCache === undefined ? {} : { noCache: args.noCache })
  });
  let builder = new TransactionBuilder(sourceAccount, {
    fee: fee.perOperationFee,
    networkPassphrase: profile.networkPassphrase
  }).addOperation(
    Operation.payment({
      destination: args.destination,
      asset,
      amount
    })
  );
  if (args.memo) builder = builder.addMemo(Memo.text(args.memo));
  const transaction = builder.setTimeout(60).build();
  return {
    xdr: transaction.toXDR(),
    source: args.sourcePublicKey,
    destination: args.destination,
    amount,
    asset: args.asset ?? "XLM",
    networkPassphrase: profile.networkPassphrase,
    fee
  };
}

export async function sendPaymentBatch(args: {
  source: TestnetWallet;
  payments: BatchPaymentItem[];
  memo?: string;
  profile?: NetworkProfile;
  feeStrategy?: FeeStrategy;
  noCache?: boolean;
}): Promise<SubmittedPaymentBatch> {
  const payments = normalizeBatchPayments(args.payments);
  const operations = payments.map((payment) =>
    Operation.payment({
      destination: payment.destination,
      asset: stellarSdkAsset(payment.asset),
      amount: payment.amount
    })
  );
  const submitted = await submitOperation({
    source: args.source,
    profile: args.profile ?? TESTNET_PROFILE,
    operations,
    ...(args.memo === undefined ? {} : { memo: args.memo }),
    ...(args.feeStrategy === undefined ? {} : { feeStrategy: args.feeStrategy }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache })
  });
  return {
    ...submitted,
    operationCount: payments.length,
    payments
  };
}

export async function submitTransactionXdr(args: {
  xdr: string;
  profile?: NetworkProfile;
  allowRealFunds?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<SubmittedTransaction> {
  const profile = args.profile ?? TESTNET_PROFILE;
  if (profile.realFunds && !args.allowRealFunds) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Mainnet signed-XDR submission requires explicit real-funds approval.",
      hint: "Use a signed transaction from a human-controlled Mainnet wallet.",
      docs: "docs/mainnet-safety.md"
    });
  }
  if (!profile.horizonUrl) {
    throw new StellarAgentError({
      code: "HORIZON_UNAVAILABLE",
      message: "Horizon is not configured for this profile."
    });
  }
  const xdr = args.xdr.trim();
  if (!xdr) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Signed transaction XDR is required.",
      docs: "docs/mainnet-safety.md#signed-xdr-submission"
    });
  }
  if (profile.realFunds) assertSignedTransactionXdr(xdr);

  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(`${profile.horizonUrl.replace(/\/$/, "")}/transactions`, {
    method: "POST",
    body: new URLSearchParams({ tx: xdr }),
    signal: AbortSignal.timeout(30_000)
  });
  const body = await response.text();
  const parsed = safeJson(body);
  if (!response.ok) {
    throw new StellarAgentError({
      code: "TRANSACTION_SUBMIT_FAILED",
      message: "Signed transaction XDR could not be submitted to Horizon.",
      hint: "Confirm the transaction is signed for the selected network and has not already been submitted.",
      docs: "docs/troubleshooting.md#transaction-timeout",
      details: parsed ?? body
    });
  }
  if (!parsed?.hash) {
    throw new StellarAgentError({
      code: "TRANSACTION_SUBMIT_FAILED",
      message: "Horizon accepted the signed transaction response but did not return a transaction hash.",
      docs: "docs/troubleshooting.md#transaction-timeout",
      details: parsed ?? body
    });
  }
  if (parsed.successful === false) {
    throw new StellarAgentError({
      code: "TRANSACTION_SUBMIT_FAILED",
      message: "Signed transaction was submitted but Horizon marked it unsuccessful.",
      hint: "Inspect the transaction result codes and retry only if the transaction hash is known.",
      docs: "docs/troubleshooting.md#transaction-timeout",
      details: parsed
    });
  }
  if (parsed.ledger === undefined || parsed.successful === undefined) {
    return confirmSubmittedTransaction({
      hash: parsed.hash,
      profile,
      fetchImpl
    });
  }
  return {
    hash: parsed?.hash,
    ledger: parsed?.ledger,
    successful: parsed?.successful ?? true,
    feeCharged: parsed?.fee_charged?.toString()
  };
}

async function confirmSubmittedTransaction(args: {
  hash: string;
  profile: NetworkProfile;
  fetchImpl: typeof fetch;
}): Promise<SubmittedTransaction> {
  const horizonUrl = args.profile.horizonUrl?.replace(/\/$/, "");
  if (!horizonUrl) {
    throw new StellarAgentError({
      code: "HORIZON_UNAVAILABLE",
      message: "Horizon is not configured for transaction confirmation.",
      docs: "docs/troubleshooting.md#rpc-or-horizon-unavailable"
    });
  }
  const deadline = Date.now() + 60_000;
  let lastStatus: number | undefined;
  while (Date.now() < deadline) {
    const response = await args.fetchImpl(`${horizonUrl}/transactions/${args.hash}`, {
      signal: AbortSignal.timeout(15_000)
    });
    lastStatus = response.status;
    if (response.status === 404) {
      await sleep(2_000);
      continue;
    }
    const body = await response.text();
    const parsed = safeJson(body);
    if (!response.ok) {
      throw new StellarAgentError({
        code: "LEDGER_LOOKUP_FAILED",
        message: "Could not confirm submitted transaction on Horizon.",
        docs: "docs/troubleshooting.md#transaction-timeout",
        details: parsed ?? body
      });
    }
    if (parsed?.successful === false) {
      throw new StellarAgentError({
        code: "TRANSACTION_SUBMIT_FAILED",
        message: "Submitted transaction was confirmed unsuccessful.",
        hint: "Inspect the transaction result codes before retrying.",
        docs: "docs/troubleshooting.md#transaction-timeout",
        details: parsed
      });
    }
    return {
      hash: parsed?.hash ?? args.hash,
      ledger: parsed?.ledger,
      successful: parsed?.successful ?? true,
      feeCharged: parsed?.fee_charged?.toString()
    };
  }
  throw new StellarAgentError({
    code: "TRANSACTION_TIMEOUT",
    message: "Submitted transaction was not confirmed before the timeout.",
    hint: `Check the transaction hash ${args.hash} on the selected Horizon endpoint before retrying.`,
    docs: "docs/troubleshooting.md#transaction-timeout",
    details: { hash: args.hash, lastStatus }
  });
}

function assertSignedTransactionXdr(rawXdr: string): void {
  let envelope: xdr.TransactionEnvelope;
  try {
    envelope = xdr.TransactionEnvelope.fromXDR(rawXdr, "base64");
  } catch {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Signed transaction XDR is not a valid Stellar transaction envelope.",
      docs: "docs/mainnet-safety.md#signed-xdr-submission"
    });
  }
  const type = envelope.switch().name;
  const signatures =
    type === "envelopeTypeTx"
      ? envelope.v1().signatures().length
      : type === "envelopeTypeTxV0"
        ? envelope.v0().signatures().length
        : type === "envelopeTypeTxFeeBump"
          ? envelope.feeBump().signatures().length
          : 0;
  if (signatures < 1) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Mainnet signed-XDR submission requires at least one transaction signature.",
      docs: "docs/mainnet-safety.md#signed-xdr-submission"
    });
  }
}

export async function listClaimableBalances(
  claimant: string,
  profile: NetworkProfile = TESTNET_PROFILE
): Promise<ClaimableBalanceRecord[]> {
  if (!profile.horizonUrl) {
    throw new StellarAgentError({ code: "HORIZON_UNAVAILABLE", message: "Horizon is not configured." });
  }
  const url = new URL(`${profile.horizonUrl.replace(/\/$/, "")}/claimable_balances`);
  url.searchParams.set("claimant", claimant);
  url.searchParams.set("order", "desc");
  url.searchParams.set("limit", "10");
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new StellarAgentError({
      code: "LEDGER_LOOKUP_FAILED",
      message: "Could not fetch claimable balances.",
      docs: "docs/troubleshooting.md#transaction-timeout"
    });
  }
  const parsed: any = await response.json();
  return (parsed?._embedded?.records ?? []).map((record: any) => ({
    id: record.id,
    asset: record.asset,
    amount: record.amount,
    sponsor: record.sponsor,
    lastModifiedLedger: record.last_modified_ledger,
    claimants: (record.claimants ?? []).map((claimantRecord: any) => ({
      destination: claimantRecord.destination,
      predicate: claimantRecord.predicate
    }))
  }));
}

export async function invokeContractWithStellarCli(args: {
  contractId: string;
  source: string;
  network?: string;
  rpcUrl?: string | null;
  networkPassphrase?: string;
  functionName: string;
  contractArgs?: Record<string, string>;
  stellarBinary?: string;
  stellarConfigDir?: string;
  noCache?: boolean;
}): Promise<StellarCliResult> {
  const command = [
    "contract",
    "invoke",
    "--id",
    args.contractId,
    "--source-account",
    args.source,
    "--network",
    args.network ?? "testnet"
  ];
  addRpcArgs(command, args);
  command.push("--", args.functionName);
  for (const [key, value] of Object.entries(args.contractArgs ?? {})) {
    command.push(`--${key}`, value);
  }
  return runStellarCli({
    command,
    action: "contract invocation",
    ...(args.stellarBinary === undefined ? {} : { binary: args.stellarBinary }),
    ...(args.stellarConfigDir === undefined ? {} : { configDir: args.stellarConfigDir }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache })
  });
}

export interface StellarCliResult {
  command: string[];
  stdout: string;
  stderr: string;
}

export function parseStellarCliTransactionHash(output: string): string | undefined {
  const signingMatch = /Signing transaction:\s*([a-f0-9]{64})/i.exec(output);
  if (signingMatch?.[1]) return signingMatch[1];
  const hashMatch = /\btransaction(?:\s+hash)?\b[^\n\r:]*:\s*([a-f0-9]{64})/i.exec(output);
  return hashMatch?.[1];
}

export async function deployContractWithStellarCli(args: {
  source: string;
  wasm?: string;
  wasmHash?: string;
  alias?: string;
  network?: string;
  rpcUrl?: string | null;
  networkPassphrase?: string;
  constructorArgs?: Record<string, string>;
  stellarBinary?: string;
  stellarConfigDir?: string;
  noCache?: boolean;
}): Promise<StellarCliResult> {
  const command = ["contract", "deploy", "--source-account", args.source, "--network", args.network ?? "testnet"];
  if (args.wasm) command.push("--wasm", args.wasm);
  if (args.wasmHash) command.push("--wasm-hash", args.wasmHash);
  if (args.alias) command.push("--alias", args.alias);
  addRpcArgs(command, args);
  const constructorArgs = Object.entries(args.constructorArgs ?? {});
  if (constructorArgs.length > 0) {
    command.push("--");
    for (const [key, value] of constructorArgs) {
      command.push(`--${key}`, value);
    }
  }
  return runStellarCli({
    command,
    action: "contract deployment",
    ...(args.stellarBinary === undefined ? {} : { binary: args.stellarBinary }),
    ...(args.stellarConfigDir === undefined ? {} : { configDir: args.stellarConfigDir }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache })
  });
}

export async function uploadContractWasmWithStellarCli(args: {
  source: string;
  wasm: string;
  network?: string;
  rpcUrl?: string | null;
  networkPassphrase?: string;
  stellarBinary?: string;
  stellarConfigDir?: string;
  noCache?: boolean;
}): Promise<StellarCliResult> {
  const command = [
    "contract",
    "upload",
    "--source-account",
    args.source,
    "--network",
    args.network ?? "testnet",
    "--wasm",
    args.wasm
  ];
  addRpcArgs(command, args);
  return runStellarCli({
    command,
    action: "contract Wasm upload",
    ...(args.stellarBinary === undefined ? {} : { binary: args.stellarBinary }),
    ...(args.stellarConfigDir === undefined ? {} : { configDir: args.stellarConfigDir }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache })
  });
}

export async function deployAssetContractWithStellarCli(args: {
  source: string;
  asset: string;
  alias?: string;
  network?: string;
  rpcUrl?: string | null;
  networkPassphrase?: string;
  stellarBinary?: string;
  stellarConfigDir?: string;
  noCache?: boolean;
}): Promise<StellarCliResult> {
  const command = [
    "contract",
    "asset",
    "deploy",
    "--source-account",
    args.source,
    "--network",
    args.network ?? "testnet",
    "--asset",
    args.asset
  ];
  if (args.alias) command.push("--alias", args.alias);
  addRpcArgs(command, args);
  return runStellarCli({
    command,
    action: "asset contract deployment",
    ...(args.stellarBinary === undefined ? {} : { binary: args.stellarBinary }),
    ...(args.stellarConfigDir === undefined ? {} : { configDir: args.stellarConfigDir }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache })
  });
}

export async function assetContractIdWithStellarCli(args: {
  asset: string;
  network?: string;
  rpcUrl?: string | null;
  networkPassphrase?: string;
  stellarBinary?: string;
  stellarConfigDir?: string;
  noCache?: boolean;
}): Promise<StellarCliResult> {
  const command = ["contract", "id", "asset", "--asset", args.asset, "--network", args.network ?? "testnet"];
  addRpcArgs(command, args);
  return runStellarCli({
    command,
    action: "asset contract id lookup",
    ...(args.stellarBinary === undefined ? {} : { binary: args.stellarBinary }),
    ...(args.stellarConfigDir === undefined ? {} : { configDir: args.stellarConfigDir }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache })
  });
}

export async function contractInfoWithStellarCli(args: {
  kind: "interface" | "meta" | "env-meta" | "build" | "hash";
  contractId?: string;
  wasm?: string;
  wasmHash?: string;
  network?: string;
  rpcUrl?: string | null;
  networkPassphrase?: string;
  stellarBinary?: string;
  stellarConfigDir?: string;
  noCache?: boolean;
}): Promise<StellarCliResult> {
  const command = ["contract", "info", args.kind];
  if (args.contractId) command.push("--contract-id", args.contractId);
  if (args.wasm) command.push("--wasm", args.wasm);
  if (args.wasmHash) command.push("--wasm-hash", args.wasmHash);
  if (args.network) command.push("--network", args.network);
  addRpcArgs(command, args);
  return runStellarCli({
    command,
    action: "contract info lookup",
    ...(args.stellarBinary === undefined ? {} : { binary: args.stellarBinary }),
    ...(args.stellarConfigDir === undefined ? {} : { configDir: args.stellarConfigDir }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache })
  });
}

export async function readContractWithStellarCli(args: {
  contractId?: string;
  key?: string;
  keyXdr?: string;
  wasm?: string;
  wasmHash?: string;
  durability?: "persistent" | "temporary";
  output?: "string" | "json" | "xdr";
  network?: string;
  rpcUrl?: string | null;
  networkPassphrase?: string;
  stellarBinary?: string;
  stellarConfigDir?: string;
  noCache?: boolean;
}): Promise<StellarCliResult> {
  validateContractFootprintArgs(args, "read");
  const command = ["contract", "read", "--network", args.network ?? "testnet"];
  addFootprintArgs(command, args);
  if (args.output) command.push("--output", args.output);
  addRpcArgs(command, args);
  return runStellarCli({
    command,
    action: "contract storage read",
    ...(args.stellarBinary === undefined ? {} : { binary: args.stellarBinary }),
    ...(args.stellarConfigDir === undefined ? {} : { configDir: args.stellarConfigDir }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache })
  });
}

export async function fetchContractWasmWithStellarCli(args: {
  contractId?: string;
  wasmHash?: string;
  outFile?: string;
  network?: string;
  rpcUrl?: string | null;
  networkPassphrase?: string;
  stellarBinary?: string;
  stellarConfigDir?: string;
  noCache?: boolean;
}): Promise<StellarCliResult> {
  validateContractFetchArgs(args);
  const command = ["contract", "fetch", "--network", args.network ?? "testnet"];
  if (args.contractId) command.push("--id", args.contractId);
  if (args.wasmHash) command.push("--wasm-hash", args.wasmHash);
  if (args.outFile) command.push("--out-file", args.outFile);
  addRpcArgs(command, args);
  return runStellarCli({
    command,
    action: "contract Wasm fetch",
    ...(args.stellarBinary === undefined ? {} : { binary: args.stellarBinary }),
    ...(args.stellarConfigDir === undefined ? {} : { configDir: args.stellarConfigDir }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache })
  });
}

export async function extendContractWithStellarCli(args: {
  source: string;
  ledgersToExtend: number;
  contractId?: string;
  key?: string;
  keyXdr?: string;
  wasm?: string;
  wasmHash?: string;
  durability?: "persistent" | "temporary";
  ttlLedgerOnly?: boolean;
  network?: string;
  rpcUrl?: string | null;
  networkPassphrase?: string;
  stellarBinary?: string;
  stellarConfigDir?: string;
  noCache?: boolean;
}): Promise<StellarCliResult> {
  validateLedgersToExtend(args.ledgersToExtend);
  validateContractFootprintArgs(args, "extend");
  const command = [
    "contract",
    "extend",
    "--source-account",
    args.source,
    "--network",
    args.network ?? "testnet",
    "--ledgers-to-extend",
    String(args.ledgersToExtend)
  ];
  addFootprintArgs(command, args);
  if (args.ttlLedgerOnly) command.push("--ttl-ledger-only");
  addRpcArgs(command, args);
  return runStellarCli({
    command,
    action: "contract TTL extension",
    ...(args.stellarBinary === undefined ? {} : { binary: args.stellarBinary }),
    ...(args.stellarConfigDir === undefined ? {} : { configDir: args.stellarConfigDir }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache })
  });
}

export async function restoreContractWithStellarCli(args: {
  source: string;
  contractId?: string;
  key?: string;
  keyXdr?: string;
  wasm?: string;
  wasmHash?: string;
  durability?: "persistent" | "temporary";
  network?: string;
  rpcUrl?: string | null;
  networkPassphrase?: string;
  stellarBinary?: string;
  stellarConfigDir?: string;
  noCache?: boolean;
}): Promise<StellarCliResult> {
  validateContractFootprintArgs(args, "restore");
  const command = ["contract", "restore", "--source-account", args.source, "--network", args.network ?? "testnet"];
  addFootprintArgs(command, args);
  addRpcArgs(command, args);
  return runStellarCli({
    command,
    action: "contract restore",
    ...(args.stellarBinary === undefined ? {} : { binary: args.stellarBinary }),
    ...(args.stellarConfigDir === undefined ? {} : { configDir: args.stellarConfigDir }),
    ...(args.noCache === undefined ? {} : { noCache: args.noCache })
  });
}

function addFootprintArgs(
  command: string[],
  args: {
    contractId?: string;
    key?: string;
    keyXdr?: string;
    wasm?: string;
    wasmHash?: string;
    durability?: "persistent" | "temporary";
  }
): void {
  if (args.contractId) command.push("--id", args.contractId);
  if (args.key) command.push("--key", args.key);
  if (args.keyXdr) command.push("--key-xdr", args.keyXdr);
  if (args.wasm) command.push("--wasm", args.wasm);
  if (args.wasmHash) command.push("--wasm-hash", args.wasmHash);
  if (args.durability) command.push("--durability", args.durability);
}

function addRpcArgs(command: string[], args: { rpcUrl?: string | null; networkPassphrase?: string }): void {
  if (args.rpcUrl) command.push("--rpc-url", args.rpcUrl);
  if (args.networkPassphrase) command.push("--network-passphrase", args.networkPassphrase);
}

function validateLedgersToExtend(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Ledgers to extend must be a positive integer.",
      docs: "docs/smart-contracts.md#extend-and-restore"
    });
  }
}

function validateContractFetchArgs(args: { contractId?: string; wasmHash?: string }): void {
  if (Boolean(args.contractId) === Boolean(args.wasmHash)) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Provide exactly one of --id or --wasm-hash for contract fetch.",
      docs: "docs/smart-contracts.md#fetch"
    });
  }
}

function validateContractFootprintArgs(
  args: {
    contractId?: string;
    key?: string;
    keyXdr?: string;
    wasm?: string;
    wasmHash?: string;
  },
  action: "extend" | "restore" | "read"
): void {
  const hasContractTarget = Boolean(args.contractId);
  const hasStorageKey = Boolean(args.key || args.keyXdr);
  const hasWasmTarget = Boolean(args.wasm || args.wasmHash);

  if (!hasContractTarget && !hasWasmTarget) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: `Provide --id, --wasm, or --wasm-hash for contract ${action}.`,
      docs: "docs/smart-contracts.md#extend-and-restore"
    });
  }
  if (args.key && args.keyXdr) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Provide only one of --key or --key-xdr.",
      docs: "docs/smart-contracts.md#extend-and-restore"
    });
  }
  if (args.wasm && args.wasmHash) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Provide only one of --wasm or --wasm-hash.",
      docs: "docs/smart-contracts.md#extend-and-restore"
    });
  }
  if (hasStorageKey && !hasContractTarget) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Provide --id when using --key or --key-xdr.",
      docs: "docs/smart-contracts.md#extend-and-restore"
    });
  }
  if (hasContractTarget && hasWasmTarget) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Choose either a contract/storage target or a Wasm target, not both.",
      docs: "docs/smart-contracts.md#extend-and-restore"
    });
  }
}

async function runStellarCli(args: {
  binary?: string;
  command: string[];
  action: string;
  configDir?: string;
  noCache?: boolean;
}): Promise<StellarCliResult> {
  const binary = args.binary ?? "stellar";
  const command = [...args.command];
  const runtimeArgs = [
    ...(args.configDir ? ["--config-dir", args.configDir] : []),
    ...(args.noCache ? ["--no-cache"] : [])
  ];
  if (runtimeArgs.length > 0) {
    const separator = command.indexOf("--");
    command.splice(separator < 0 ? command.length : separator, 0, ...runtimeArgs);
  }
  try {
    const { stdout, stderr } = await execFileAsync(binary, command, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024
    });
    return { command: [binary, ...command], stdout, stderr };
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new StellarAgentError({
        code: "STELLAR_CLI_UNAVAILABLE",
        message: "The Stellar CLI binary was not found.",
        hint: "Install it from https://developers.stellar.org/docs/tools/cli/install-cli or pass --stellar-binary.",
        docs: "docs/smart-contracts.md#stellar-cli",
        exitCode: EXIT_CODES.usage
      });
    }
    throw new StellarAgentError({
      code: "TRANSACTION_SUBMIT_FAILED",
      message: `Stellar CLI ${args.action} failed.`,
      hint: "Run the same stellar command with --help to inspect supported arguments.",
      docs: "docs/smart-contracts.md",
      details: { stderr: error?.stderr, stdout: error?.stdout, message: error?.message }
    });
  }
}

export async function checkStellarCli(binary = "stellar"): Promise<StellarCliStatus> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, ["--version"], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
    return {
      available: true,
      binary,
      version: (stdout || stderr).trim()
    };
  } catch (error: any) {
    return {
      available: false,
      binary,
      error: error?.code === "ENOENT" ? "not_found" : String(error?.message ?? error)
    };
  }
}

async function submitOperation(args: {
  source: TestnetWallet;
  operation?: any;
  operations?: any[];
  memo?: string;
  profile: NetworkProfile;
  feeStrategy?: FeeStrategy;
  noCache?: boolean;
}): Promise<SubmittedOperation> {
  const profile = args.profile;
  if (profile.realFunds) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Mainnet auto-signing is blocked.",
      hint: "Use an explicit human approval flow for Mainnet payments.",
      docs: "docs/mainnet-safety.md"
    });
  }
  if (!profile.horizonUrl) {
    throw new StellarAgentError({
      code: "HORIZON_UNAVAILABLE",
      message: "Horizon is not configured for this profile."
    });
  }
  const keypair = Keypair.fromSecret(args.source.secretKey);
  const server = new Horizon.Server(profile.horizonUrl);
  try {
    const operations = args.operations ?? (args.operation ? [args.operation] : []);
    if (operations.length < 1 || operations.length > 100) {
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: "A Stellar transaction must contain between 1 and 100 operations.",
        docs: "docs/troubleshooting.md#batch-transaction-failed",
        exitCode: EXIT_CODES.usage
      });
    }
    const sourceAccount = await server.loadAccount(args.source.publicKey);
    const fee = await estimateTransactionFee({
      profile,
      operationCount: operations.length,
      strategy: args.feeStrategy ?? "medium",
      ...(args.noCache === undefined ? {} : { noCache: args.noCache })
    });
    let builder = new TransactionBuilder(sourceAccount, {
      fee: fee.perOperationFee,
      networkPassphrase: profile.networkPassphrase
    });
    for (const operation of operations) {
      builder = builder.addOperation(operation);
    }
    if (args.memo) builder = builder.addMemo(Memo.text(args.memo));
    const tx = builder.setTimeout(60).build();
    tx.sign(keypair);
    const result: any = await server.submitTransaction(tx);
    if (result.successful === false) {
      throw new StellarAgentError({
        code: "TRANSACTION_SUBMIT_FAILED",
        message: "Stellar transaction was submitted but Horizon marked it unsuccessful.",
        hint: "Inspect the transaction result codes and retry only if the transaction hash is known.",
        docs: "docs/troubleshooting.md#transaction-timeout",
        details: result
      });
    }
    return {
      hash: result.hash,
      ledger: result.ledger,
      successful: result.successful ?? true,
      feeCharged: result.fee_charged?.toString(),
      feeBid: fee.transactionFee,
      feeStrategy: fee.strategy
    };
  } catch (error: any) {
    if (error instanceof StellarAgentError) throw error;
    if (isHorizonNotFound(error)) {
      throw new StellarAgentError({
        code: "ACCOUNT_NOT_FOUND",
        message: "The source account was not found on the selected Stellar network.",
        hint: "Fund the account on Testnet before submitting transactions.",
        docs: "docs/quickstart-testnet.md"
      });
    }
    throw new StellarAgentError({
      code: "TRANSACTION_SUBMIT_FAILED",
      message: "Stellar transaction could not be submitted or confirmed.",
      hint: "Check wallet funding, trustlines, balance predicates, destination address, and Horizon availability.",
      docs: "docs/troubleshooting.md#transaction-timeout",
      details: normalizeHorizonError(error)
    });
  }
}

function stellarSdkAsset(input: string): Asset {
  const parsed = parseAsset(input);
  return parsed.kind === "native" ? Asset.native() : new Asset(parsed.code, parsed.issuer);
}

function normalizeLiquidityPoolRecord(record: any): LiquidityPoolSummary {
  return {
    id: record.id,
    ...(record.paging_token === undefined ? {} : { pagingToken: record.paging_token }),
    feeBp: Number(record.fee_bp),
    type: record.type,
    totalTrustlines: String(record.total_trustlines ?? "0"),
    totalShares: String(record.total_shares ?? "0"),
    reserves: (record.reserves ?? []).map((reserve: any) => ({
      asset: reserve.asset === "native" ? "XLM" : String(reserve.asset),
      amount: String(reserve.amount)
    }))
  };
}

function collectionResult<T>(records: T[], page: any): HorizonCollectionResult<T> {
  return {
    records,
    ...(page?._links?.next?.href === undefined ? {} : { next: page._links.next.href }),
    ...(page?._links?.prev?.href === undefined ? {} : { previous: page._links.prev.href })
  };
}

function horizonRecords(page: any): any[] {
  return page?._embedded?.records ?? page?.records ?? [];
}

async function horizonGet(url: URL, message: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = await response.text();
  const parsed = safeJson(body);
  if (!response.ok) {
    throw new StellarAgentError({
      code: "LEDGER_LOOKUP_FAILED",
      message,
      docs: "docs/troubleshooting.md#transaction-timeout",
      details: parsed ?? body
    });
  }
  return parsed ?? {};
}

function requireTwoPoolReserves(pool: LiquidityPoolSummary): [LiquidityPoolReserve, LiquidityPoolReserve] {
  validateLiquidityPoolId(pool.id);
  if (pool.reserves.length !== 2 || !pool.reserves[0] || !pool.reserves[1]) {
    throw new StellarAgentError({
      code: "LEDGER_LOOKUP_FAILED",
      message: "Liquidity pool record did not include exactly two reserves.",
      docs: "docs/market-liquidity.md#core-pool-inspection"
    });
  }
  validateDistinctLiquidityPoolAssets(pool.reserves[0].asset, pool.reserves[1].asset);
  return [pool.reserves[0], pool.reserves[1]];
}

function liquidityPoolShareRatio(shares: string, totalShares: string): number | undefined {
  const sharesValue = Number(shares);
  const totalValue = Number(totalShares);
  if (!Number.isFinite(sharesValue) || !Number.isFinite(totalValue) || totalValue <= 0) return undefined;
  return sharesValue / totalValue;
}

function estimatePoolReserves(pool: LiquidityPoolSummary, shareOfPool: number): LiquidityPoolReserve[] {
  return pool.reserves.map((reserve) => ({
    asset: reserve.asset,
    amount: formatEstimatedAmount(Number(reserve.amount) * shareOfPool)
  }));
}

function estimateDepositShares(
  pool: LiquidityPoolSummary,
  maxAmountA: string,
  maxAmountB: string
): string | undefined {
  const [reserveA, reserveB] = requireTwoPoolReserves(pool);
  const reserveAValue = Number(reserveA.amount);
  const reserveBValue = Number(reserveB.amount);
  const maxAValue = Number(maxAmountA);
  const maxBValue = Number(maxAmountB);
  const totalShares = Number(pool.totalShares);
  if (
    !Number.isFinite(reserveAValue) ||
    !Number.isFinite(reserveBValue) ||
    !Number.isFinite(maxAValue) ||
    !Number.isFinite(maxBValue) ||
    !Number.isFinite(totalShares) ||
    reserveAValue <= 0 ||
    reserveBValue <= 0 ||
    totalShares <= 0
  ) {
    return undefined;
  }
  return formatEstimatedAmount(Math.min(maxAValue / reserveAValue, maxBValue / reserveBValue) * totalShares);
}

function poolPrice(pool: LiquidityPoolSummary): string | undefined {
  const [reserveA, reserveB] = requireTwoPoolReserves(pool);
  const reserveAValue = Number(reserveA.amount);
  const reserveBValue = Number(reserveB.amount);
  if (!Number.isFinite(reserveAValue) || !Number.isFinite(reserveBValue) || reserveAValue <= 0) return undefined;
  return formatEstimatedAmount(reserveBValue / reserveAValue);
}

async function liquidityPoolTrustlineStatus(
  accountId: string,
  pool: LiquidityPoolSummary,
  profile: NetworkProfile
): Promise<NonNullable<LiquidityPoolPreflight["trustlines"]>> {
  if (!profile.horizonUrl) {
    throw new StellarAgentError({ code: "HORIZON_UNAVAILABLE", message: "Horizon is not configured." });
  }
  const account: any = await horizonGet(
    new URL(`${profile.horizonUrl.replace(/\/$/, "")}/accounts/${accountId}`),
    "Could not load account trustlines from Horizon."
  );
  const reserveAssets = requireTwoPoolReserves(pool).map((reserve) => reserve.asset);
  const reserveAssetsSatisfied = reserveAssets.every((asset) => asset === "XLM" || hasAssetBalanceOrTrustline(account, asset));
  const poolShareSatisfied = account.balances.some(
    (balance: any) => balance.asset_type === "liquidity_pool_shares" && balance.liquidity_pool_id === pool.id
  );
  return {
    reserveAssetsSatisfied,
    poolShareSatisfied,
    missing: [
      ...reserveAssets.filter((asset) => asset !== "XLM" && !hasAssetBalanceOrTrustline(account, asset)),
      ...(poolShareSatisfied ? [] : [`pool_shares:${pool.id}`])
    ]
  };
}

function hasAssetBalanceOrTrustline(account: any, asset: string): boolean {
  return account.balances.some((balance: any) => balanceLineAssetString(balance).toUpperCase() === asset.toUpperCase());
}

function balanceLineAssetString(balance: any): string {
  if (balance.asset_type === "native") return "XLM";
  if (balance.asset_code && balance.asset_issuer) return `${balance.asset_code}:${balance.asset_issuer}`;
  if (balance.asset_type === "liquidity_pool_shares") return `pool_shares:${balance.liquidity_pool_id}`;
  return String(balance.asset_type ?? "unknown");
}

function liquidityPoolRiskNotes(pool: LiquidityPoolSummary): LiquidityPoolPreflight["risk"] {
  return {
    notes: [
      "Liquidity pool fees are not guaranteed profit.",
      "Pool share value can underperform simply holding the reserve assets.",
      "Quotes, estimates, and Horizon snapshots can change before transaction submission.",
      `Core pool fee is ${pool.feeBp} bps.`
    ]
  };
}

async function resolveLiquidityPoolAssetForTrustline(args: {
  poolId?: string;
  assetA?: string;
  assetB?: string;
  profile?: NetworkProfile;
}): Promise<{ poolId: string; asset: LiquidityPoolAsset }> {
  if (args.poolId) {
    const pool = await inspectLiquidityPool({
      poolId: args.poolId,
      ...(args.profile === undefined ? {} : { profile: args.profile })
    });
    const [reserveA, reserveB] = requireTwoPoolReserves(pool);
    const asset = new LiquidityPoolAsset(stellarSdkAsset(reserveA.asset), stellarSdkAsset(reserveB.asset), LiquidityPoolFeeV18);
    return { poolId: pool.id, asset };
  }
  if (!args.assetA || !args.assetB) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Provide --pool or both --asset-a and --asset-b for a pool-share trustline.",
      docs: "docs/market-liquidity.md#pool-share-trustlines"
    });
  }
  const [assetA, assetB] = sortedLiquidityPoolAssets(args.assetA, args.assetB);
  const asset = new LiquidityPoolAsset(assetA, assetB, LiquidityPoolFeeV18);
  return { poolId: getLiquidityPoolId("constant_product", { assetA, assetB, fee: LiquidityPoolFeeV18 }).toString("hex"), asset };
}

function sortedLiquidityPoolAssets(assetA: string, assetB: string): [Asset, Asset] {
  validateDistinctLiquidityPoolAssets(assetA, assetB);
  const left = stellarSdkAsset(assetA);
  const right = stellarSdkAsset(assetB);
  return Asset.compare(left, right) <= 0 ? [left, right] : [right, left];
}

function normalizeAmountAllowZero(input: string): string {
  const trimmed = input.trim();
  if (/^0(?:\.0{0,7})?$/.test(trimmed)) return "0.0000000";
  return parseAmount(trimmed).value;
}

function formatEstimatedAmount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0.0000000";
  return value.toFixed(7);
}

function normalizeTrustlineLimit(input: string): string {
  if (input === "0") return "0";
  const parsed = parseAmount(input);
  if (parsed.stroops > 9_223_372_036_854_775_807n) {
    throw new StellarAgentError({
      code: "INVALID_AMOUNT",
      message: "Trustline limit exceeds Stellar's maximum signed 64-bit stroop amount.",
      exitCode: EXIT_CODES.usage
    });
  }
  return formatStroops(parsed.stroops);
}

function validateLiquidityPoolId(poolId: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(poolId)) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Liquidity pool id must be a 64-character hexadecimal string.",
      docs: "docs/market-liquidity.md#core-pool-inspection",
      exitCode: EXIT_CODES.usage
    });
  }
}

function validatePoolPriceBounds(minPrice: string, maxPrice: string): void {
  const min = parsePositiveDecimal(minPrice, "minPrice");
  const max = parsePositiveDecimal(maxPrice, "maxPrice");
  if (min > max) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Liquidity deposit minPrice must be less than or equal to maxPrice.",
      docs: "docs/market-liquidity.md#lp-preflight",
      exitCode: EXIT_CODES.usage
    });
  }
}

function parsePositiveDecimal(input: string, field: string): number {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(input.trim())) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: `${field} must be a decimal number.`,
      docs: "docs/market-liquidity.md#lp-preflight",
      exitCode: EXIT_CODES.usage
    });
  }
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: `${field} must be greater than zero.`,
      docs: "docs/market-liquidity.md#lp-preflight",
      exitCode: EXIT_CODES.usage
    });
  }
  return value;
}

function validateDistinctLiquidityPoolAssets(assetA: string, assetB: string): void {
  const left = stellarSdkAsset(assetA);
  const right = stellarSdkAsset(assetB);
  if (Asset.compare(left, right) === 0) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Liquidity pool reserve assets must be distinct.",
      docs: "docs/market-liquidity.md#core-pool-inspection",
      exitCode: EXIT_CODES.usage
    });
  }
}

function nominalDepositExposure(maxAmountA: string, maxAmountB: string): string {
  return formatStroops(parseAmount(maxAmountA).stroops + parseAmount(maxAmountB).stroops);
}

function uniqueClaimants(claimants: string[]): string[] {
  const unique = [...new Set(claimants.map((claimant) => claimant.trim()))].filter(Boolean);
  if (unique.length === 0) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "At least one claimable balance claimant is required.",
      docs: "docs/claimable-balances.md"
    });
  }
  return unique;
}

const MAX_DATE_EPOCH_SECONDS = 8_640_000_000_000n;

function parseClaimableTimestamp(input: string | number | Date, field: string): ClaimableTimestamp {
  const invalid = () =>
    new StellarAgentError({
      code: "INVALID_INPUT",
      message: `${field} must be a Unix timestamp in seconds or an ISO-8601 date/time.`,
      docs: "docs/claimable-balances.md#time-bound-claiming"
    });

  let epochSeconds: bigint;
  if (input instanceof Date) {
    const millis = input.getTime();
    if (!Number.isFinite(millis)) throw invalid();
    epochSeconds = BigInt(Math.floor(millis / 1000));
  } else if (typeof input === "number") {
    if (!Number.isFinite(input) || !Number.isInteger(input) || input < 0) throw invalid();
    epochSeconds = BigInt(input);
  } else {
    const value = input.trim();
    if (!value) throw invalid();
    if (/^\d+$/.test(value)) {
      epochSeconds = BigInt(value);
    } else {
      const millis = Date.parse(value);
      if (!Number.isFinite(millis)) throw invalid();
      epochSeconds = BigInt(Math.floor(millis / 1000));
    }
  }

  if (epochSeconds < 0n || epochSeconds > MAX_DATE_EPOCH_SECONDS) throw invalid();
  return {
    epochSeconds: epochSeconds.toString(),
    iso: new Date(Number(epochSeconds) * 1000).toISOString()
  };
}

export async function estimateTransactionFee(args: {
  profile?: NetworkProfile;
  operationCount?: number;
  strategy?: FeeStrategy;
  noCache?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<FeeStatsSummary> {
  const profile = args.profile ?? TESTNET_PROFILE;
  const operationCount = args.operationCount ?? 1;
  if (!Number.isInteger(operationCount) || operationCount < 1 || operationCount > 100) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Fee estimation requires an operation count between 1 and 100.",
      docs: "docs/troubleshooting.md#batch-transaction-failed",
      exitCode: EXIT_CODES.usage
    });
  }
  const strategy = args.strategy ?? "medium";
  const stats = await horizonFeeStats(profile, {
    ...(args.noCache === undefined ? {} : { noCache: args.noCache }),
    ...(args.fetchImpl === undefined ? {} : { fetchImpl: args.fetchImpl })
  });
  const perOperationFee = selectFeeForStrategy(stats, strategy);
  return {
    source: stats.source,
    strategy,
    perOperationFee,
    transactionFee: (BigInt(perOperationFee) * BigInt(operationCount)).toString(),
    operationCount,
    cached: stats.cached,
    ...(stats.ledgerCapacityUsage === undefined ? {} : { ledgerCapacityUsage: stats.ledgerCapacityUsage })
  };
}

function normalizeBatchPayments(payments: BatchPaymentItem[]): Array<{
  destination: string;
  amount: string;
  asset: string;
}> {
  if (!Array.isArray(payments) || payments.length < 1 || payments.length > 100) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Batch payments must include between 1 and 100 payment operations.",
      hint: "Use pay send for a single payment or provide a JSON array to pay batch.",
      docs: "docs/troubleshooting.md#batch-transaction-failed",
      exitCode: EXIT_CODES.usage
    });
  }
  return payments.map((payment, index) => {
    if (!payment || typeof payment !== "object") {
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: `Batch payment ${index + 1} must be an object.`,
        docs: "docs/troubleshooting.md#batch-transaction-failed",
        exitCode: EXIT_CODES.usage
      });
    }
    const asset = payment.asset ?? "XLM";
    parseAsset(asset);
    return {
      destination: payment.destination,
      amount: parseAmount(payment.amount, asset).value,
      asset
    };
  });
}

async function horizonFeeStats(
  profile: NetworkProfile,
  options: { noCache?: boolean; fetchImpl?: typeof fetch } = {}
): Promise<{
  source: "horizon" | "base_fee_fallback";
  cached: boolean;
  lastLedgerBaseFee: string;
  ledgerCapacityUsage?: string;
  feeCharged?: Record<string, string>;
}> {
  if (!profile.horizonUrl) {
    return { source: "base_fee_fallback", cached: false, lastLedgerBaseFee: BASE_FEE };
  }
  const key = `feeStats:${profile.horizonUrl}`;
  const now = Date.now();
  if (!options.noCache) {
    const cached = sessionCache.get(key) as CacheEntry<Awaited<ReturnType<typeof horizonFeeStats>>> | undefined;
    if (cached && cached.expiresAt > now) {
      return { ...cached.value, cached: true };
    }
  }
  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(`${profile.horizonUrl.replace(/\/$/, "")}/fee_stats`, {
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`fee_stats returned ${response.status}`);
    const parsed: any = await response.json();
    const feeCharged = normalizeFeeCharged(parsed.fee_charged);
    const value = {
      source: "horizon" as const,
      cached: false,
      lastLedgerBaseFee: String(parsed.last_ledger_base_fee ?? BASE_FEE),
      ...(parsed.ledger_capacity_usage === undefined
        ? {}
        : { ledgerCapacityUsage: String(parsed.ledger_capacity_usage) }),
      ...(feeCharged === undefined ? {} : { feeCharged })
    };
    sessionCache.set(key, { value, expiresAt: now + 30_000 });
    return value;
  } catch {
    return { source: "base_fee_fallback", cached: false, lastLedgerBaseFee: BASE_FEE };
  }
}

function normalizeFeeCharged(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && /^\d+$/.test(String(value))) output[key] = String(value);
  }
  return output;
}

function selectFeeForStrategy(
  stats: Awaited<ReturnType<typeof horizonFeeStats>>,
  strategy: FeeStrategy
): string {
  if (strategy === "base") return maxFeeString(BASE_FEE, stats.lastLedgerBaseFee);
  const charged = stats.feeCharged ?? {};
  const candidate =
    strategy === "low"
      ? charged.p50 ?? charged.mode ?? charged.min
      : strategy === "medium"
        ? charged.p80 ?? charged.p70 ?? charged.p60 ?? charged.p50
        : strategy === "high"
          ? charged.p90 ?? charged.p95 ?? charged.max
          : charged.p95 ?? charged.p90 ?? charged.max;
  return maxFeeString(BASE_FEE, stats.lastLedgerBaseFee, candidate ?? BASE_FEE);
}

function maxFeeString(...values: string[]): string {
  return values.reduce((max, value) => {
    if (!/^\d+$/.test(value)) return max;
    return BigInt(value) > BigInt(max) ? value : max;
  }, BASE_FEE);
}


export async function lookupTransaction(hash: string, profile: NetworkProfile): Promise<unknown> {
  if (!profile.horizonUrl) {
    throw new StellarAgentError({ code: "HORIZON_UNAVAILABLE", message: "Horizon is not configured." });
  }
  const response = await fetch(`${profile.horizonUrl.replace(/\/$/, "")}/transactions/${hash}`, {
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new StellarAgentError({
      code: "LEDGER_LOOKUP_FAILED",
      message: "Could not look up transaction.",
      docs: "docs/troubleshooting.md#transaction-timeout"
    });
  }
  return response.json();
}

export async function accountPayments(args: {
  address: string;
  profile: NetworkProfile;
  limit?: number;
}): Promise<HorizonCollectionResult> {
  return horizonCollection({
    profile: args.profile,
    path: `/accounts/${args.address}/payments`,
    ...(args.limit === undefined ? {} : { limit: args.limit })
  });
}

export async function accountEffects(args: {
  address: string;
  profile: NetworkProfile;
  limit?: number;
}): Promise<HorizonCollectionResult> {
  return horizonCollection({
    profile: args.profile,
    path: `/accounts/${args.address}/effects`,
    ...(args.limit === undefined ? {} : { limit: args.limit })
  });
}

export async function transactionEffects(args: {
  hash: string;
  profile: NetworkProfile;
  limit?: number;
}): Promise<HorizonCollectionResult> {
  return horizonCollection({
    profile: args.profile,
    path: `/transactions/${args.hash}/effects`,
    ...(args.limit === undefined ? {} : { limit: args.limit })
  });
}

export async function latestLedger(profile: NetworkProfile): Promise<unknown> {
  if (!profile.horizonUrl) {
    throw new StellarAgentError({ code: "HORIZON_UNAVAILABLE", message: "Horizon is not configured." });
  }
  const response = await fetch(`${profile.horizonUrl.replace(/\/$/, "")}/ledgers?order=desc&limit=1`, {
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new StellarAgentError({
      code: "LEDGER_LOOKUP_FAILED",
      message: "Could not fetch latest ledger.",
      docs: "docs/troubleshooting.md#rpc-unavailable"
    });
  }
  return response.json();
}

async function horizonCollection(args: {
  profile: NetworkProfile;
  path: string;
  limit?: number;
}): Promise<HorizonCollectionResult> {
  if (!args.profile.horizonUrl) {
    throw new StellarAgentError({ code: "HORIZON_UNAVAILABLE", message: "Horizon is not configured." });
  }
  const url = new URL(`${args.profile.horizonUrl.replace(/\/$/, "")}${args.path}`);
  url.searchParams.set("order", "desc");
  url.searchParams.set("limit", String(args.limit ?? 10));
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new StellarAgentError({
      code: "LEDGER_LOOKUP_FAILED",
      message: "Could not fetch ledger collection from Horizon.",
      docs: "docs/troubleshooting.md#transaction-timeout",
      details: { path: args.path, status: response.status }
    });
  }
  const parsed: any = await response.json();
  return {
    records: parsed?._embedded?.records ?? [],
    next: parsed?._links?.next?.href,
    previous: parsed?._links?.prev?.href
  };
}

function safeJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHorizonNotFound(error: any): boolean {
  return (
    error?.response?.status === 404 ||
    error?.response?.statusCode === 404 ||
    error?.status === 404 ||
    error?.statusCode === 404 ||
    error?.message === "Not Found"
  );
}

function normalizeHorizonError(error: any): unknown {
  return error?.response?.data ?? error?.response?.body ?? error?.message ?? String(error);
}

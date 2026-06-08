import { TESTNET_PROFILE } from "@stellar-agent/core";
import { preflightLiquidityPoolDeposit, type LiquidityPoolPreflight } from "@stellar-agent/stellar";

export interface MarketLpPreflightExampleArgs {
  poolId: string;
  account?: string;
}

export async function buildMarketLpDepositPreflight(args: MarketLpPreflightExampleArgs): Promise<LiquidityPoolPreflight> {
  return preflightLiquidityPoolDeposit({
    poolId: args.poolId,
    ...(args.account === undefined ? {} : { account: args.account }),
    maxAmountA: "0.01",
    maxAmountB: "0.01",
    minPrice: "0.9",
    maxPrice: "1.1",
    profile: TESTNET_PROFILE
  });
}

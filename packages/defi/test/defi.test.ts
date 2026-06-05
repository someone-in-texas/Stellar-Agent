import { describe, expect, it } from "vitest";
import {
  blendDeployment,
  blendHealthFactor,
  fetchBlendDeployment,
  parseBlendRequest,
  resolveBlendAsset,
  resolveBlendPool
} from "../src/index.js";

describe("Blend deployment helpers", () => {
  it("resolves canonical Testnet pools and classic trustline assets", () => {
    const deployment = blendDeployment("testnet");
    expect(resolveBlendPool(deployment, "TestnetV2")).toMatchObject({
      contractId: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
      version: "v2"
    });
    expect(resolveBlendAsset(deployment, "USDC")).toMatchObject({
      contractId: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
      classicAsset: "USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"
    });
  });

  it("refreshes deployments from Blend contracts and UI environment maps", async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("testnet.contracts.json")) {
        return new Response(
          JSON.stringify({
            ids: {
              XLM: "CXLM",
              USDC: "CUSDC",
              BLND: "CBLND",
              poolFactoryV2: "CFACTORY",
              backstopV2: "CBACKSTOP",
              TestnetV2: "CPOOL"
            },
            hashes: { lendingPoolV2: "hash" }
          })
        );
      }
      return new Response(
        [
          "NEXT_PUBLIC_USDC_ISSUER=GUSDC",
          "NEXT_PUBLIC_BLND_ISSUER=GBLND",
          "NEXT_PUBLIC_BLOCKED_POOLS='CPOOL2'"
        ].join("\n")
      );
    };

    const deployment = await fetchBlendDeployment("testnet", fetchImpl as typeof fetch);
    expect(deployment.pools).toEqual([{ name: "TestnetV2", contractId: "CPOOL", version: "v2" }]);
    expect(deployment.assets.find((asset) => asset.symbol === "USDC")?.classicAsset).toBe("USDC:GUSDC");
    expect(deployment.blockedPools).toEqual(["CPOOL2"]);
  });
});

describe("Blend preflight helpers", () => {
  it("parses typed Blend request syntax", () => {
    expect(parseBlendRequest("supply-collateral:USDC:1.5")).toEqual({
      type: "supply_collateral",
      asset: "USDC",
      amount: "1.5"
    });
  });

  it("computes health factor from effective collateral and liabilities", () => {
    expect(blendHealthFactor({ totalEffectiveCollateral: 3, totalEffectiveLiabilities: 2 })).toBe(1.5);
    expect(blendHealthFactor({ totalEffectiveCollateral: 3, totalEffectiveLiabilities: 0 })).toBeNull();
  });
});

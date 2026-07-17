import { describe, expect, it } from "vitest";
import {
  aquariusDeployment,
  blendDeployment,
  blendHealthFactor,
  fetchAquariusPools,
  fetchBlendDeployment,
  inspectAquariusPool,
  preflightAquariusLp,
  preflightAquariusSwap,
  parseBlendRequest,
  resolveAquariusAsset,
  resolveBlendAsset,
  resolveBlendPool,
  quoteAquariusSwap
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

describe("Aquarius helpers", () => {
  it("loads Testnet deployment constants", () => {
    const deployment = aquariusDeployment("testnet");
    expect(deployment.routerContractId).toBe("CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD");
    expect(deployment.apiBaseUrl).toContain("amm-api-testnet");
    expect(deployment.assets).toEqual(expect.arrayContaining([expect.objectContaining({ symbol: "AQUA" })]));
  });

  it("does not ship a static Mainnet AQUA alias", () => {
    const deployment = aquariusDeployment("mainnet");
    expect(deployment.assets).not.toEqual(expect.arrayContaining([expect.objectContaining({ symbol: "AQUA" })]));
    expect(() => resolveAquariusAsset(deployment, "AQUA")).toThrow("Aquarius asset 'AQUA' was not found");
  });

  it("maps Aquarius API pools into stable summaries", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          count: 1,
          results: [
            {
              index: "pool-hash",
              address: "CPOOL",
              tokens_addresses: ["CXLM", "CAQUA"],
              tokens_str: ["native", "AQUA:GISSUER"],
              pool_type: "constant_product",
              fee: "0.0030",
              tx_count: 4,
              total_volume: 12
            }
          ]
        })
      );
    const pools = await fetchAquariusPools({ network: "testnet", fetchImpl: fetchImpl as typeof fetch });
    expect(pools.pools[0]).toMatchObject({
      index: "pool-hash",
      address: "CPOOL",
      assetLabels: ["native", "AQUA:GISSUER"],
      assetContractIds: ["CXLM", "CAQUA"],
      poolType: "constant_product",
      fee: "0.0030"
    });
  });

  it("trims Aquarius pool output to the requested limit", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          count: 2,
          results: [
            {
              index: "pool-a",
              address: "CPOOLA",
              tokens_addresses: ["CXLM", "CAQUA"],
              tokens_str: ["native", "AQUA:GISSUER"]
            },
            {
              index: "pool-b",
              address: "CPOOLB",
              tokens_addresses: ["CXLM", "CUSDC"],
              tokens_str: ["native", "USDC:GISSUER"]
            }
          ]
        })
      );

    const pools = await fetchAquariusPools({ network: "testnet", limit: 1, fetchImpl: fetchImpl as typeof fetch });

    expect(pools.count).toBe(2);
    expect(pools.pools).toHaveLength(1);
    expect(pools.pools[0]?.address).toBe("CPOOLA");
    expect((pools.raw as any).results).toHaveLength(1);
  });

  it("resolves Aquarius pool terms against returned pool metadata", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              index: "pool-hash",
              address: "CPOOL",
              tokens_addresses: ["CXLM", "CAQUA"],
              tokens_str: ["native", "AQUA:GISSUER"],
              pool_type: "constant_product",
              fee: "0.0030"
            }
          ]
        })
      );
    const inspected = await inspectAquariusPool({ network: "testnet", pool: "XLM", fetchImpl: fetchImpl as typeof fetch });
    expect(inspected.pool.address).toBe("CPOOL");
  });

  it("does not fall back to an unrelated Aquarius pool", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              index: "pool-hash",
              address: "CPOOL",
              tokens_addresses: ["CUSDC", "CAQUA"],
              tokens_str: ["USDC:GISSUER", "AQUA:GISSUER"],
              pool_type: "constant_product",
              fee: "0.0030"
            }
          ]
        })
      );

    await expect(inspectAquariusPool({ network: "testnet", pool: "XLM", fetchImpl: fetchImpl as typeof fetch })).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });
  });

  it("preflights Aquarius LP deposits without signing or submitting", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              index: "pool-hash",
              address: "CPOOL",
              tokens_addresses: ["CXLM", "CAQUA"],
              tokens_str: ["native", "AQUA:GISSUER"],
              pool_type: "constant_product",
              fee: "0.0030"
            }
          ]
        })
      );
    const preflight = await preflightAquariusLp({
      network: "testnet",
      pool: "CPOOL",
      account: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      action: "deposit",
      desiredAmounts: ["0.1", "25"],
      minShares: "0.0000001",
      fetchImpl: fetchImpl as typeof fetch
    });
    expect(preflight).toMatchObject({
      action: "deposit",
      submitted: false,
      signing: false,
      slippageBoundsProvided: true,
      nominalExposure: "25.1",
      assets: ["native", "XLM", "CXLM", "AQUA:GISSUER", "AQUA", "CAQUA"],
      assetGroups: [
        ["native", "XLM", "CXLM"],
        ["AQUA:GISSUER", "AQUA", "CAQUA"]
      ]
    });
  });

  it("requires LP amount vectors to match the pool assets", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              index: "pool-hash",
              address: "CPOOL",
              tokens_addresses: ["CXLM", "CAQUA"],
              tokens_str: ["native", "AQUA:GISSUER"]
            }
          ]
        })
      );
    const common = {
      network: "testnet" as const,
      pool: "CPOOL",
      account: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      fetchImpl: fetchImpl as typeof fetch
    };

    await expect(
      preflightAquariusLp({ ...common, action: "deposit", desiredAmounts: ["1", "2", "3"], minShares: "1" })
    ).rejects.toThrow("exactly 2 --amount values");
    await expect(
      preflightAquariusLp({ ...common, action: "withdraw", shareAmount: "1", minAmounts: ["0"] })
    ).rejects.toThrow("exactly 2 --min-amount values");
  });

  it("computes Aquarius nominal exposure without floating-point precision loss", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              index: "pool-hash",
              address: "CPOOL",
              tokens_addresses: ["CXLM", "CAQUA"],
              tokens_str: ["native", "AQUA:GISSUER"]
            }
          ]
        })
      );
    const preflight = await preflightAquariusLp({
      network: "testnet",
      pool: "CPOOL",
      account: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      action: "deposit",
      desiredAmounts: ["9007199254740993.1", "0.2"],
      minShares: "1",
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(preflight.nominalExposure).toBe("9007199254740993.3");
  });

  it("quotes and preflights Aquarius swaps from API routes", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          success: true,
          amount: 57842595,
          amount_with_fee: 57842595,
          swap_chain_xdr: "AAAA",
          pools: ["CPOOL"],
          tokens: ["native", "AQUA:GISSUER"],
          tokens_addresses: [
            "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
            "CDNVQW44C3HALYNVQ4SOBXY5EWYTGVYXX6JPESOLQDABJI5FC5LTRRUE"
          ]
        })
      );
    const quote = await quoteAquariusSwap({
      network: "testnet",
      inputAsset: "XLM",
      outputAsset: "AQUA",
      amount: "0.01",
      mode: "strict_send",
      fetchImpl: fetchImpl as typeof fetch
    });
    expect(quote).toMatchObject({ success: true, amount: "57842595", pools: ["CPOOL"] });

    const preflight = await preflightAquariusSwap({
      network: "testnet",
      inputAsset: "XLM",
      outputAsset: "AQUA",
      amount: "0.01",
      mode: "strict_send",
      slippageBps: 100,
      fetchImpl: fetchImpl as typeof fetch
    });
    expect(preflight).toMatchObject({
      submitted: false,
      signing: false,
      slippageBoundsProvided: true,
      policyAction: "swap",
      assets: expect.arrayContaining(["XLM", "AQUA", "native", "AQUA:GISSUER"]),
      assetGroups: expect.arrayContaining([
        expect.arrayContaining(["XLM", "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"]),
        expect.arrayContaining(["AQUA", "CDNVQW44C3HALYNVQ4SOBXY5EWYTGVYXX6JPESOLQDABJI5FC5LTRRUE"])
      ])
    });
  });
});

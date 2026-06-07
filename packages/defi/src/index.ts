import { NetworkProfile, StellarAgentError } from "@stellar-agent/core";

export type BlendNetworkName = "testnet" | "mainnet";
export type BlendPoolVersion = "v1" | "v2";
export type AquariusNetworkName = "testnet" | "mainnet";
export type AquariusActionType = "deposit" | "withdraw" | "swap";
export type AquariusLpActionType = "deposit" | "withdraw";
export type AquariusSwapMode = "strict_send" | "strict_receive";
export type BlendActionType =
  | "supply"
  | "withdraw"
  | "supply_collateral"
  | "withdraw_collateral"
  | "borrow"
  | "repay";

export interface BlendAssetDeployment {
  symbol: string;
  contractId: string;
  issuer?: string;
  classicAsset?: string;
}

export interface BlendPoolDeployment {
  name: string;
  contractId: string;
  version: BlendPoolVersion;
  blocked?: boolean;
}

export interface BlendDeployment {
  network: BlendNetworkName;
  source: {
    contractsUrl: string;
    envUrl: string;
  };
  ids: Record<string, string>;
  hashes: Record<string, string>;
  assets: BlendAssetDeployment[];
  pools: BlendPoolDeployment[];
  contracts: {
    backstop?: string;
    backstopV2?: string;
    poolFactory?: string;
    poolFactoryV2?: string;
    emitter?: string;
  };
  blockedPools: string[];
}

export interface BlendAction {
  type: BlendActionType;
  asset: string;
  amount: string;
}

export interface BlendPreflightInput {
  profile: NetworkProfile;
  poolId: string;
  userId: string;
  actions: BlendAction[];
  poolVersion?: BlendPoolVersion;
}

export interface SubmittedBlendTransaction {
  hash: string;
  ledger?: number;
  successful: boolean;
  feeCharged?: string;
  status: string;
  preflight: BlendPreflight;
  simulation: {
    successful: true;
    minResourceFee?: string;
    transactionData?: string;
    events: unknown[];
  };
  decodedEvents: unknown[];
}

export interface BlendPreflight {
  pool: {
    id: string;
    version: BlendPoolVersion;
  };
  user: string;
  actions: Array<
    BlendAction & {
      assetId: string;
      amountRaw: string;
      requestType: number;
      expectedTokens?: {
        bTokens?: string;
        dTokens?: string;
      };
      value?: number;
    }
  >;
  before?: BlendPositionEstimate;
  after?: BlendPositionEstimate;
  fees: {
    simulated: false;
    transactionFee: null;
    resourceFee: null;
  };
  decodedEvents: [];
}

export interface BlendPositionEstimate {
  totalBorrowed: number;
  totalSupplied: number;
  totalEffectiveLiabilities: number;
  totalEffectiveCollateral: number;
  borrowCap: number;
  borrowLimit: number;
  healthFactor: number | null;
  netApy: number;
  supplyApy: number;
  borrowApy: number;
}

export interface AquariusDeployment {
  network: AquariusNetworkName;
  routerContractId: string;
  apiBaseUrl: string;
  sorobanRpcUrl: string;
  horizonUrl: string;
  docs: string[];
  assets: AquariusAssetDeployment[];
  notes: string[];
}

export interface AquariusAssetDeployment {
  symbol: string;
  contractId: string;
  issuer?: string;
  classicAsset?: string;
}

export interface AquariusPoolSummary {
  index: string;
  address: string;
  tokens: string[];
  tokenAddresses: string[];
  poolType: string;
  fee: string;
  amplification?: string | null;
  txCount?: number | null;
  totalVolume?: number | string | null;
}

export interface AquariusLpPreflight {
  network: AquariusNetworkName;
  action: AquariusLpActionType;
  pool: AquariusPoolSummary;
  account: string;
  desiredAmounts?: string[];
  minShares?: string;
  shareAmount?: string;
  minAmounts?: string[];
  assets: string[];
  nominalExposure: string;
  slippageBoundsProvided: boolean;
  simulated: false;
  submitted: false;
  signing: false;
  riskNotes: string[];
}

export interface AquariusSwapPreflight {
  network: AquariusNetworkName;
  mode: AquariusSwapMode;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  slippageBps?: number;
  quote: AquariusSwapQuote;
  policyAction: "swap";
  slippageBoundsProvided: boolean;
  simulated: false;
  submitted: false;
  signing: false;
  riskNotes: string[];
}

export interface AquariusSwapQuote {
  success: boolean;
  amount: string;
  amountWithFee?: string;
  swapChainXdr?: string;
  pools: string[];
  tokens: string[];
  tokenAddresses: string[];
  raw: unknown;
}

export interface AquariusAccountPosition {
  network: AquariusNetworkName;
  account: string;
  pool?: AquariusPoolSummary;
  balances: unknown[];
  matchedBalances: unknown[];
  submitted: false;
  signing: false;
  notes: string[];
}

export interface AquariusRewardsInspection {
  network: AquariusNetworkName;
  account: string;
  pool: AquariusPoolSummary;
  claimSupported: true;
  claimSubmitted: false;
  signing: false;
  notes: string[];
}

const BLEND_UTILS_BASE = "https://raw.githubusercontent.com/blend-capital/blend-utils/main";
const BLEND_UI_BASE = "https://raw.githubusercontent.com/blend-capital/blend-ui/main";

const AQUARIUS_DEPLOYMENTS: Record<AquariusNetworkName, AquariusDeployment> = {
  testnet: {
    network: "testnet",
    routerContractId: "CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD",
    apiBaseUrl: "https://amm-api-testnet.aqua.network/api/external/v1",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org:443",
    horizonUrl: "https://horizon-testnet.stellar.org",
    docs: [
      "https://docs.aqua.network/developers/code-examples/prerequisites-and-basics",
      "https://docs.aqua.network/developers/code-examples/get-pools-info",
      "https://docs.aqua.network/developers/aquarius-soroban-functions"
    ],
    assets: [
      { symbol: "XLM", contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" },
      {
        symbol: "AQUA",
        contractId: "CDNVQW44C3HALYNVQ4SOBXY5EWYTGVYXX6JPESOLQDABJI5FC5LTRRUE",
        issuer: "GAHPYWLK6YRN7CVYZOO4H3VDRZ7PVF5UJGLZCSPAEIKJE2XSWF5LAGER",
        classicAsset: "AQUA:GAHPYWLK6YRN7CVYZOO4H3VDRZ7PVF5UJGLZCSPAEIKJE2XSWF5LAGER"
      },
      {
        symbol: "USDC",
        contractId: "CAZRY5GSFBFXD7H6GAFBA5YGYQTDXU4QKWKMYFWBAZFUCURN3WKX6LF5",
        issuer: "GAHPYWLK6YRN7CVYZOO4H3VDRZ7PVF5UJGLZCSPAEIKJE2XSWF5LAGER",
        classicAsset: "USDC:GAHPYWLK6YRN7CVYZOO4H3VDRZ7PVF5UJGLZCSPAEIKJE2XSWF5LAGER"
      }
    ],
    notes: ["Aquarius Testnet router address was updated in February 2026 per Aquarius documentation."]
  },
  mainnet: {
    network: "mainnet",
    routerContractId: "CBQDHNBFBZYE4MKPWBSJOPIYLW4SFSXAXUTSXJN76GNKYVYPCKWC6QUK",
    apiBaseUrl: "https://amm-api.aqua.network/api/external/v1",
    sorobanRpcUrl: "https://mainnet.sorobanrpc.com",
    horizonUrl: "https://horizon.stellar.org",
    docs: [
      "https://docs.aqua.network/developers/code-examples/prerequisites-and-basics",
      "https://docs.aqua.network/developers/code-examples/get-pools-info",
      "https://docs.aqua.network/developers/aquarius-soroban-functions"
    ],
    assets: [
      { symbol: "XLM", contractId: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA" },
      {
        symbol: "AQUA",
        contractId: "CD54JJVY7BM5HCJ37YH2QYDAKL3CMS2UY4WQ66NCKH3QOX2K6WHK4G2Z",
        issuer: "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA",
        classicAsset: "AQUA:GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA"
      }
    ],
    notes: ["Mainnet Aquarius mutation is not supported by stellar-agent local auto-signing."]
  }
};

const STATIC_DEPLOYMENTS: Record<BlendNetworkName, BlendDeployment> = {
  testnet: {
    network: "testnet",
    source: {
      contractsUrl: `${BLEND_UTILS_BASE}/testnet.contracts.json`,
      envUrl: `${BLEND_UI_BASE}/.env.testnet`
    },
    ids: {
      XLM: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      BLND: "CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF",
      USDC: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
      wETH: "CAZAQB3D7KSLSNOSQKYD2V4JP5V2Y3B4RDJZRLBFCCIXDCTE3WHSY3UE",
      wBTC: "CAP5AMC2OHNVREO66DFIN6DHJMPOBAJ2KCDDIMFBR7WWJH5RZBFM3UEI",
      cometFactory: "CDX2TKELFKHP2MWISDCXWWZ73CL7F57GHYRJAWJWNOTLNJNNM7XLT4JY",
      comet: "CA5UTUUPHYL5K22UBRUVC37EARZUGYOSGK3IKIXG2JLCC5ZZLI4BDWDM",
      oraclemock: "CAZOKR2Y5E2OSWSIBRVZMJ47RUTQPIGVWSAQ2UISGAVC46XKPGDG5PKI",
      emitter: "CC3WJVJINN4E3LPMNTWKK7LQZLYDQMZHZA7EZGXATPHHBPKNZRIO3KZ6",
      poolFactoryV2: "CDV6RX4CGPCOKGTBFS52V3LMWQGZN3LCQTXF5RVPOOCG4XVMHXQ4NTF6",
      backstopV2: "CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA",
      TestnetV2: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF"
    },
    hashes: {
      comet: "8abc28913035c07411ed5d134e6bfeab4723d97ddd4d1a22a0605d35c94d1a36",
      cometFactory: "bf7adb09076853eb3aa569278754111d86e161e35e7dc6a984ecde2b9d6700ae",
      oraclemock: "66c0b87b5eb481be594175d59e66ec9a9ac8945be0fec4e09f6c28bf7a1708be",
      poolFactoryV2: "31328050548831f63d2b72e37bcfd0bb7371b7907135755dbe09ed434d755ca9",
      backstopV2: "c1f4502a757e25c611f5a159bc1ab0eef64085adac6c68123dca66e87faffbc2",
      lendingPoolV2: "a41fc53d6753b6c04eb15b021c55052366a4c8e0e21bc72700f461264ec1350e",
      emitter: "438a5528cff17ede6fe515f095c43c5f15727af17d006971485e52462e7e7b89"
    },
    assets: [
      { symbol: "XLM", contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" },
      {
        symbol: "USDC",
        contractId: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
        issuer: "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
        classicAsset: "USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"
      },
      {
        symbol: "BLND",
        contractId: "CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF",
        issuer: "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
        classicAsset: "BLND:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"
      }
    ],
    pools: [
      {
        name: "TestnetV2",
        contractId: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
        version: "v2"
      }
    ],
    contracts: {
      backstopV2: "CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA",
      poolFactoryV2: "CDV6RX4CGPCOKGTBFS52V3LMWQGZN3LCQTXF5RVPOOCG4XVMHXQ4NTF6",
      emitter: "CC3WJVJINN4E3LPMNTWKK7LQZLYDQMZHZA7EZGXATPHHBPKNZRIO3KZ6"
    },
    blockedPools: []
  },
  mainnet: {
    network: "mainnet",
    source: {
      contractsUrl: `${BLEND_UTILS_BASE}/mainnet.contracts.json`,
      envUrl: `${BLEND_UI_BASE}/.env.production`
    },
    ids: {
      bootstrapper: "CBUTN4KJSULJAUZYTYIGSMYAOO7PBJSAQ5OP6UTGYHOXA6UQYBAEOBB3",
      emitter: "CCOQM6S7ICIUWA225O5PSJWUBEMXGFSSW2PQFO6FP4DQEKMS5DASRGRR",
      poolFactory: "CCZD6ESMOGMPWH2KRO4O7RGTAPGTUPFWFQBELQSS7ZUK63V3TZWETGAG",
      backstop: "CAO3AGAMZVRMHITL36EJ2VZQWKYRPWMQAPDQD5YEOF3GIF7T44U4JAL3",
      BLND: "CD25MNVTZDL4Y3XBCPCJXGXATV5WUHHOWMYFF4YBEGU5FCPGMYTVG5JY",
      USDC: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
      XLM: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
      cometFactory: "CA2LVIPU6HJHHPPD6EDDYJTV2QEUBPGOAVJ4VIYNTMFUCRM4LFK3TJKF",
      comet: "CAS3FL6TLZKDGGSISDBWGGPXT3NRR4DYTZD7YOD3HMYO6LTJUVGRVEAM",
      Fixed: "CDVQVKOY2YSXS2IC7KN6MNASSHPAO7UN2UR2ON4OI2SKMFJNVAMDX6DP",
      YieldBlox: "CBP7NO6F7FRDHSOFQBT2L2UWYIZ2PU76JKVRYAQTG3KZSQLYAOKIF2WB",
      backstopV2: "CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7",
      poolFactoryV2: "CDSYOAVXFY7SM5S64IZPPPYB4GVGGLMQVFREPSQQEZVIWXX5R23G4QSU",
      FixedV2: "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD",
      YieldBloxV2: "CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS"
    },
    hashes: {
      bootstrapper: "8d954489999199e21e677281cc03bc7882764d6c208fb60cdd552e823c224018",
      emitter: "438a5528cff17ede6fe515f095c43c5f15727af17d006971485e52462e7e7b89",
      poolFactory: "0287f4ad7350935b83d94e046c0bcabc960b233dbce1531008c021b71d406a1d",
      backstop: "62f61b32fff99f7eec052a8e573c367759f161c481a5caf0e76a10ae4617c3b4",
      lendingPool: "baf978f10efdbcd85747868bef8832845ea6809f7643b67a4ac0cd669327fc2c",
      comet: "8abc28913035c07411ed5d134e6bfeab4723d97ddd4d1a22a0605d35c94d1a36",
      cometFactory: "bf7adb09076853eb3aa569278754111d86e161e35e7dc6a984ecde2b9d6700ae"
    },
    assets: [
      { symbol: "XLM", contractId: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA" },
      {
        symbol: "USDC",
        contractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
        issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        classicAsset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      },
      {
        symbol: "BLND",
        contractId: "CD25MNVTZDL4Y3XBCPCJXGXATV5WUHHOWMYFF4YBEGU5FCPGMYTVG5JY",
        issuer: "GDJEHTBE6ZHUXSWFI642DCGLUOECLHPF3KSXHPXTSTJ7E3JF6MQ5EZYY",
        classicAsset: "BLND:GDJEHTBE6ZHUXSWFI642DCGLUOECLHPF3KSXHPXTSTJ7E3JF6MQ5EZYY"
      }
    ],
    pools: [
      {
        name: "FixedV2",
        contractId: "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD",
        version: "v2"
      },
      {
        name: "YieldBloxV2",
        contractId: "CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS",
        version: "v2"
      },
      {
        name: "Fixed",
        contractId: "CDVQVKOY2YSXS2IC7KN6MNASSHPAO7UN2UR2ON4OI2SKMFJNVAMDX6DP",
        version: "v1"
      },
      {
        name: "YieldBlox",
        contractId: "CBP7NO6F7FRDHSOFQBT2L2UWYIZ2PU76JKVRYAQTG3KZSQLYAOKIF2WB",
        version: "v1"
      }
    ],
    contracts: {
      backstop: "CAO3AGAMZVRMHITL36EJ2VZQWKYRPWMQAPDQD5YEOF3GIF7T44U4JAL3",
      backstopV2: "CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7",
      poolFactory: "CCZD6ESMOGMPWH2KRO4O7RGTAPGTUPFWFQBELQSS7ZUK63V3TZWETGAG",
      poolFactoryV2: "CDSYOAVXFY7SM5S64IZPPPYB4GVGGLMQVFREPSQQEZVIWXX5R23G4QSU",
      emitter: "CCOQM6S7ICIUWA225O5PSJWUBEMXGFSSW2PQFO6FP4DQEKMS5DASRGRR"
    },
    blockedPools: ["CBVOPI6QC6OWVCOEZDCFELAGQNAOHUS4CWOKAVADKQZXVSWR2R5IAKO7"]
  }
};

const REQUEST_TYPE_BY_ACTION: Record<BlendActionType, number> = {
  supply: 0,
  withdraw: 1,
  supply_collateral: 2,
  withdraw_collateral: 3,
  borrow: 4,
  repay: 5
};

export function blendDeployment(network: BlendNetworkName): BlendDeployment {
  return structuredClone(STATIC_DEPLOYMENTS[network]);
}

export function aquariusDeployment(network: AquariusNetworkName): AquariusDeployment {
  return structuredClone(AQUARIUS_DEPLOYMENTS[network]);
}

export async function fetchAquariusPools(args: {
  network: AquariusNetworkName;
  search?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ network: AquariusNetworkName; apiBaseUrl: string; count?: number; pools: AquariusPoolSummary[]; raw: unknown }> {
  const deployment = aquariusDeployment(args.network);
  const url = new URL(`${deployment.apiBaseUrl}/pools/`);
  if (args.search) url.searchParams.set("search", args.search);
  if (args.limit !== undefined) url.searchParams.set("limit", String(validatePositiveInteger(args.limit, "limit")));
  const response = await (args.fetchImpl ?? fetch)(url);
  if (!response.ok) {
    throw new StellarAgentError({
      code: "RPC_UNAVAILABLE",
      message: "Could not fetch Aquarius pool list.",
      details: { url: url.toString(), status: response.status },
      docs: "docs/defi-aquarius.md"
    });
  }
  const raw = await response.json();
  const records = Array.isArray((raw as any).results) ? (raw as any).results : Array.isArray(raw) ? raw : [];
  return {
    network: args.network,
    apiBaseUrl: deployment.apiBaseUrl,
    ...(typeof (raw as any).count === "number" ? { count: (raw as any).count } : {}),
    pools: records.map(aquariusPoolFromApi),
    raw
  };
}

export async function inspectAquariusPool(args: {
  network: AquariusNetworkName;
  pool: string;
  fetchImpl?: typeof fetch;
}): Promise<{ network: AquariusNetworkName; pool: AquariusPoolSummary; raw?: unknown }> {
  const listed = await fetchAquariusPools({
    network: args.network,
    search: args.pool,
    limit: 20,
    ...(args.fetchImpl === undefined ? {} : { fetchImpl: args.fetchImpl })
  });
  const needle = args.pool.toLowerCase();
  const pool = listed.pools.find((candidate) => {
    const tokens = [...candidate.tokens, ...candidate.tokenAddresses].map((token) => token.toLowerCase());
    return candidate.address.toLowerCase() === needle || candidate.index.toLowerCase() === needle || tokens.includes(needle);
  });
  const firstPool = listed.pools[0];
  if (!pool && firstPool !== undefined && !isContractId(args.pool)) {
    return { network: args.network, pool: firstPool, raw: listed.raw };
  }
  if (pool) return { network: args.network, pool, raw: listed.raw };
  if (isContractId(args.pool)) {
    return {
      network: args.network,
      pool: {
        index: "",
        address: args.pool,
        tokens: [],
        tokenAddresses: [],
        poolType: "unknown",
        fee: "unknown"
      }
    };
  }
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: `Aquarius pool '${args.pool}' was not found in the ${args.network} API results.`,
    hint: "Run stellar-agent defi aquarius deployments --network testnet --json to list known pools.",
    docs: "docs/defi-aquarius.md"
  });
}

export async function preflightAquariusLp(args: {
  network: AquariusNetworkName;
  pool: string;
  account: string;
  action: AquariusLpActionType;
  desiredAmounts?: string[];
  minShares?: string;
  shareAmount?: string;
  minAmounts?: string[];
  fetchImpl?: typeof fetch;
}): Promise<AquariusLpPreflight> {
  const { pool } = await inspectAquariusPool({
    network: args.network,
    pool: args.pool,
    ...(args.fetchImpl === undefined ? {} : { fetchImpl: args.fetchImpl })
  });
  const assets = pool.tokenAddresses.length > 0 ? pool.tokenAddresses : pool.tokens;
  if (args.action === "deposit") {
    if (!args.desiredAmounts || args.desiredAmounts.length < 2) {
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: "Aquarius deposit preflight requires at least two --amount values.",
        docs: "docs/defi-aquarius.md#lp-preflight"
      });
    }
    for (const amount of args.desiredAmounts) validatePositiveDecimal(amount, "amount");
    if (args.minShares !== undefined) validateNonnegativeDecimal(args.minShares, "min-shares");
  } else {
    if (!args.shareAmount) {
      throw new StellarAgentError({
        code: "INVALID_INPUT",
        message: "Aquarius withdraw preflight requires --shares.",
        docs: "docs/defi-aquarius.md#lp-preflight"
      });
    }
    validatePositiveDecimal(args.shareAmount, "shares");
    for (const amount of args.minAmounts ?? []) validateNonnegativeDecimal(amount, "min-amount");
  }
  return {
    network: args.network,
    action: args.action,
    pool,
    account: args.account,
    ...(args.desiredAmounts === undefined ? {} : { desiredAmounts: args.desiredAmounts }),
    ...(args.minShares === undefined ? {} : { minShares: args.minShares }),
    ...(args.shareAmount === undefined ? {} : { shareAmount: args.shareAmount }),
    ...(args.minAmounts === undefined ? {} : { minAmounts: args.minAmounts }),
    assets,
    nominalExposure:
      args.action === "deposit" ? String(args.desiredAmounts!.reduce((total, amount) => total + Number(amount), 0)) : args.shareAmount!,
    slippageBoundsProvided:
      args.action === "deposit" ? args.minShares !== undefined : Array.isArray(args.minAmounts) && args.minAmounts.length > 0,
    simulated: false,
    submitted: false,
    signing: false,
    riskNotes: [
      "Aquarius LP preflight is an API and input validation check, not a submitted transaction.",
      "Pool state and reward eligibility can change before execution.",
      "Mainnet Aquarius mutation requires an external signer flow and is not auto-signed locally."
    ]
  };
}

export async function quoteAquariusSwap(args: {
  network: AquariusNetworkName;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  mode: AquariusSwapMode;
  fetchImpl?: typeof fetch;
}): Promise<AquariusSwapQuote> {
  validatePositiveDecimal(args.amount, "amount");
  const deployment = aquariusDeployment(args.network);
  const endpoint = args.mode === "strict_receive" ? "find-path-strict-receive" : "find-path";
  const response = await (args.fetchImpl ?? fetch)(`${deployment.apiBaseUrl}/${endpoint}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token_in_address: resolveAquariusAsset(deployment, args.tokenIn).contractId,
      token_out_address: resolveAquariusAsset(deployment, args.tokenOut).contractId,
      amount: decimalToStroops(args.amount)
    })
  });
  if (!response.ok) {
    throw new StellarAgentError({
      code: "RPC_UNAVAILABLE",
      message: "Could not fetch Aquarius swap quote.",
      details: { status: response.status },
      docs: "docs/defi-aquarius.md#swap-quoting-and-preflight"
    });
  }
  const raw = await response.json();
  return aquariusQuoteFromApi(raw);
}

export async function preflightAquariusSwap(args: {
  network: AquariusNetworkName;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  mode: AquariusSwapMode;
  slippageBps?: number;
  fetchImpl?: typeof fetch;
}): Promise<AquariusSwapPreflight> {
  const quote = await quoteAquariusSwap(args);
  if (!quote.success) {
    throw new StellarAgentError({
      code: "TRANSACTION_BUILD_FAILED",
      message: "Aquarius swap quote failed.",
      details: quote.raw,
      docs: "docs/defi-aquarius.md#swap-quoting-and-preflight"
    });
  }
  if (args.slippageBps !== undefined && (!Number.isInteger(args.slippageBps) || args.slippageBps < 0 || args.slippageBps > 10_000)) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Aquarius --slippage-bps must be an integer from 0 to 10000.",
      docs: "docs/defi-aquarius.md#swap-quoting-and-preflight"
    });
  }
  return {
    network: args.network,
    mode: args.mode,
    tokenIn: resolveAquariusAsset(aquariusDeployment(args.network), args.tokenIn).contractId,
    tokenOut: resolveAquariusAsset(aquariusDeployment(args.network), args.tokenOut).contractId,
    amount: args.amount,
    ...(args.slippageBps === undefined ? {} : { slippageBps: args.slippageBps }),
    quote,
    policyAction: "swap",
    slippageBoundsProvided: args.slippageBps !== undefined,
    simulated: false,
    submitted: false,
    signing: false,
    riskNotes: [
      "Aquarius swap preflight quotes an API-generated route and XDR but does not sign or submit it.",
      "Set explicit slippage bounds before any future submitted swap.",
      "Routes can change between quote and execution."
    ]
  };
}

export async function inspectAquariusAccountPosition(args: {
  network: AquariusNetworkName;
  account: string;
  pool?: string;
  fetchImpl?: typeof fetch;
}): Promise<AquariusAccountPosition> {
  const deployment = aquariusDeployment(args.network);
  const response = await (args.fetchImpl ?? fetch)(`${deployment.horizonUrl}/accounts/${args.account}`);
  if (!response.ok) {
    throw new StellarAgentError({
      code: "LEDGER_LOOKUP_FAILED",
      message: "Could not load account balances for Aquarius position inspection.",
      details: { account: args.account, status: response.status },
      docs: "docs/defi-aquarius.md#account-position"
    });
  }
  const raw = await response.json();
  const balances = Array.isArray((raw as any).balances) ? (raw as any).balances : [];
  const pool = args.pool
    ? (
        await inspectAquariusPool({
          network: args.network,
          pool: args.pool,
          ...(args.fetchImpl === undefined ? {} : { fetchImpl: args.fetchImpl })
        })
      ).pool
    : undefined;
  const matchedBalances = pool
    ? balances.filter((balance: any) => JSON.stringify(balance).includes(pool.address) || pool.tokens.some((token) => JSON.stringify(balance).includes(token)))
    : balances;
  return {
    network: args.network,
    account: args.account,
    ...(pool === undefined ? {} : { pool }),
    balances,
    matchedBalances,
    submitted: false,
    signing: false,
    notes: [
      "Position inspection is read-only and does not prove future LP withdrawal eligibility.",
      "Soroban pool share and reward state can differ from classic Horizon balances."
    ]
  };
}

export async function inspectAquariusRewards(args: {
  network: AquariusNetworkName;
  account: string;
  pool: string;
  fetchImpl?: typeof fetch;
}): Promise<AquariusRewardsInspection> {
  const { pool } = await inspectAquariusPool({
    network: args.network,
    pool: args.pool,
    ...(args.fetchImpl === undefined ? {} : { fetchImpl: args.fetchImpl })
  });
  return {
    network: args.network,
    account: args.account,
    pool,
    claimSupported: true,
    claimSubmitted: false,
    signing: false,
    notes: [
      "Aquarius rewards are claimed through the pool claim(user) contract method.",
      "This command is read-only and does not sign or submit a claim transaction.",
      "Run LP preflight and use an external signer for any future Mainnet reward claim."
    ]
  };
}

export function resolveAquariusAsset(deployment: AquariusDeployment, asset: string): AquariusAssetDeployment {
  const found = deployment.assets.find(
    (candidate) => candidate.symbol.toLowerCase() === asset.toLowerCase() || candidate.contractId === asset
  );
  if (found) return found;
  if (isContractId(asset)) return { symbol: asset, contractId: asset };
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: `Aquarius asset '${asset}' was not found in the ${deployment.network} deployment map.`,
    hint: "Use XLM, AQUA, USDC, or a contract id.",
    docs: "docs/defi-aquarius.md"
  });
}

export async function fetchBlendDeployment(
  network: BlendNetworkName,
  fetchImpl: typeof fetch = fetch
): Promise<BlendDeployment> {
  const base = blendDeployment(network);
  const [contractsResponse, envResponse] = await Promise.all([
    fetchImpl(base.source.contractsUrl),
    fetchImpl(base.source.envUrl)
  ]);
  if (!contractsResponse.ok) {
    throw new StellarAgentError({
      code: "RPC_UNAVAILABLE",
      message: "Could not fetch Blend contract deployment map.",
      details: { url: base.source.contractsUrl, status: contractsResponse.status }
    });
  }
  if (!envResponse.ok) {
    throw new StellarAgentError({
      code: "RPC_UNAVAILABLE",
      message: "Could not fetch Blend UI environment map.",
      details: { url: base.source.envUrl, status: envResponse.status }
    });
  }
  const contracts = (await contractsResponse.json()) as { ids?: Record<string, string>; hashes?: Record<string, string> };
  const env = parseEnv(await envResponse.text());
  return buildDeployment(network, base.source, contracts.ids ?? {}, contracts.hashes ?? {}, env);
}

export function resolveBlendPool(deployment: BlendDeployment, pool: string): BlendPoolDeployment {
  const found = deployment.pools.find(
    (candidate) => candidate.name.toLowerCase() === pool.toLowerCase() || candidate.contractId === pool
  );
  if (found) return found;
  if (/^C[A-Z2-7]{55}$/.test(pool)) return { name: pool, contractId: pool, version: "v2" };
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: `Blend pool '${pool}' was not found in the ${deployment.network} deployment map.`,
    hint: "Run stellar-agent defi blend deployments --json to list known pools.",
    docs: "docs/defi-blend.md"
  });
}

export function resolveBlendAsset(deployment: BlendDeployment, asset: string): BlendAssetDeployment {
  const found = deployment.assets.find(
    (candidate) => candidate.symbol.toLowerCase() === asset.toLowerCase() || candidate.contractId === asset
  );
  if (found) return found;
  if (/^C[A-Z2-7]{55}$/.test(asset)) return { symbol: asset, contractId: asset };
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: `Blend asset '${asset}' was not found in the ${deployment.network} deployment map.`,
    hint: "Use a contract id or one of the assets listed by stellar-agent defi blend deployments --json.",
    docs: "docs/defi-blend.md"
  });
}

export async function inspectBlendPool(args: {
  profile: NetworkProfile;
  poolId: string;
  poolVersion?: BlendPoolVersion;
}): Promise<unknown> {
  const pool = await loadPool(args.profile, args.poolId, args.poolVersion);
  const oracle = await tryLoadOracle(pool);
  const estimate = oracle ? await tryBuildPoolEstimate(pool, oracle) : undefined;
  return toPlainJson({
    pool: {
      id: pool.id,
      version: normalizeLoadedPoolVersion(pool.version),
      metadata: pool.metadata,
      timestamp: pool.timestamp
    },
    reserves: Array.from(pool.reserves.values()).map((reserve: any) => reserveSummary(reserve, oracle)),
    ...(estimate === undefined ? {} : { estimate })
  });
}

export async function inspectBlendPosition(args: {
  profile: NetworkProfile;
  poolId: string;
  userId: string;
  poolVersion?: BlendPoolVersion;
}): Promise<unknown> {
  const pool = await loadPool(args.profile, args.poolId, args.poolVersion);
  const user = await pool.loadUser(args.userId);
  const oracle = await tryLoadOracle(pool);
  const estimate = oracle ? await tryBuildPositionEstimate(pool, oracle, user.positions) : undefined;
  return toPlainJson({
    pool: { id: pool.id, version: normalizeLoadedPoolVersion(pool.version) },
    user: args.userId,
    reserves: Array.from(pool.reserves.values()).map((reserve: any) => ({
      assetId: reserve.assetId,
      index: reserve.config?.index,
      supply: user.getSupplyFloat(reserve),
      collateral: user.getCollateralFloat(reserve),
      liabilities: user.getLiabilitiesFloat(reserve),
      supplyBTokens: user.getSupplyBTokens(reserve),
      collateralBTokens: user.getCollateralBTokens(reserve),
      liabilityDTokens: user.getLiabilityDTokens(reserve)
    })),
    ...(estimate === undefined ? {} : { estimate })
  });
}

export async function preflightBlendActions(args: BlendPreflightInput): Promise<BlendPreflight> {
  const pool = await loadPool(args.profile, args.poolId, args.poolVersion);
  const user = await pool.loadUser(args.userId);
  const oracle = await tryLoadOracle(pool);
  const before = oracle ? await tryBuildPositionEstimate(pool, oracle, user.positions) : undefined;
  const actions = args.actions.map((action) => preflightAction(pool, oracle, action));
  const after = before ? projectPositionEstimate(before, actions) : undefined;
  return {
    pool: {
      id: pool.id,
      version: normalizeLoadedPoolVersion(pool.version)
    },
    user: args.userId,
    actions,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    fees: {
      simulated: false,
      transactionFee: null,
      resourceFee: null
    },
    decodedEvents: []
  };
}

export async function submitBlendActions(args: BlendPreflightInput & { sourceSecretKey: string }): Promise<SubmittedBlendTransaction> {
  if (args.profile.realFunds) {
    throw new StellarAgentError({
      code: "MAINNET_NOT_ENABLED",
      message: "Mainnet Blend auto-signing is blocked.",
      hint: "Use an external signer or browser-wallet flow for Mainnet DeFi.",
      docs: "docs/mainnet-safety.md#mainnet-defi"
    });
  }
  if (!args.profile.rpcUrl) {
    throw new StellarAgentError({
      code: "RPC_UNAVAILABLE",
      message: "Soroban RPC is not configured for the selected profile.",
      docs: "docs/defi-blend.md"
    });
  }

  const stellar: any = await import("@stellar/stellar-sdk");
  const blend: any = await import("@blend-capital/blend-sdk");
  const preflight = await preflightBlendActions(args);
  const keypair = stellar.Keypair.fromSecret(args.sourceSecretKey);
  const sourcePublicKey = keypair.publicKey();
  if (sourcePublicKey !== args.userId) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Blend source secret key does not match the requested user account.",
      docs: "docs/defi-blend.md"
    });
  }

  const contract = preflight.pool.version === "v1" ? new blend.PoolContractV1(args.poolId) : new blend.PoolContractV2(args.poolId);
  const operationXdr = contract.submit({
    from: sourcePublicKey,
    spender: sourcePublicKey,
    to: sourcePublicKey,
    requests: preflight.actions.map((action) => ({
      request_type: action.requestType,
      address: action.assetId,
      amount: BigInt(action.amountRaw)
    }))
  });

  const server = new stellar.rpc.Server(args.profile.rpcUrl, { allowHttp: args.profile.name === "local" });
  const account = await server.getAccount(sourcePublicKey);
  const operation = stellar.xdr.Operation.fromXDR(operationXdr, "base64");
  const rawTransaction = new stellar.TransactionBuilder(account, {
    fee: stellar.BASE_FEE,
    networkPassphrase: args.profile.networkPassphrase
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();
  const simulation = await server.simulateTransaction(rawTransaction);
  if (!stellar.rpc.Api.isSimulationSuccess(simulation)) {
    throw new StellarAgentError({
      code: "TRANSACTION_BUILD_FAILED",
      message: "Blend transaction simulation failed.",
      hint: "Check balances, trustlines, Blend pool status, and policy preflight output.",
      docs: "docs/defi-blend.md",
      details: toPlainJson(simulation)
    });
  }

  const assembled = stellar.rpc.assembleTransaction(rawTransaction, simulation).build();
  assembled.sign(keypair);
  const sent = await server.sendTransaction(assembled);
  if (sent.status === "ERROR") {
    throw new StellarAgentError({
      code: "TRANSACTION_SUBMIT_FAILED",
      message: "Blend transaction submission failed.",
      docs: "docs/defi-blend.md",
      details: toPlainJson(sent)
    });
  }

  const result = await pollRpcTransaction(server, sent.hash);
  const successful = result.status === "SUCCESS";
  if (!successful) {
    throw new StellarAgentError({
      code: "TRANSACTION_SUBMIT_FAILED",
      message: "Blend transaction did not complete successfully.",
      docs: "docs/defi-blend.md",
      details: toPlainJson(result)
    });
  }

  const decodedEvents = decodeRpcEvents(result);
  const transactionData = xdrLikeToString(simulation.transactionData);
  return {
    hash: sent.hash,
    ...(result.ledger === undefined ? {} : { ledger: Number(result.ledger) }),
    successful: true,
    ...(result.resultMeta?.feeCharged === undefined ? {} : { feeCharged: String(result.resultMeta.feeCharged) }),
    status: result.status,
    preflight,
    simulation: {
      successful: true,
      ...(simulation.minResourceFee === undefined ? {} : { minResourceFee: String(simulation.minResourceFee) }),
      ...(transactionData === undefined ? {} : { transactionData }),
      events: summarizeEvents(simulation.events ?? [])
    },
    decodedEvents
  };
}

export function parseBlendRequest(input: string): BlendAction {
  const [rawType, asset, amount, extra] = input.split(":");
  if (!rawType || !asset || !amount || extra !== undefined) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Blend requests must use type:asset:amount format.",
      hint: "Example: --request supply_collateral:USDC:1",
      docs: "docs/defi-blend.md"
    });
  }
  const type = normalizeBlendActionType(rawType);
  return { type, asset, amount };
}

export function normalizeBlendActionType(input: string): BlendActionType {
  const normalized = input.trim().toLowerCase().replaceAll("-", "_");
  if (isBlendActionType(normalized)) return normalized;
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: `Unsupported Blend request type '${input}'.`,
    hint: "Use supply, withdraw, supply_collateral, withdraw_collateral, borrow, or repay.",
    docs: "docs/defi-blend.md"
  });
}

export function blendHealthFactor(estimate: Pick<BlendPositionEstimate, "totalEffectiveCollateral" | "totalEffectiveLiabilities">): number | null {
  if (estimate.totalEffectiveLiabilities <= 0) return null;
  return estimate.totalEffectiveCollateral / estimate.totalEffectiveLiabilities;
}

function isBlendActionType(input: string): input is BlendActionType {
  return Object.hasOwn(REQUEST_TYPE_BY_ACTION, input);
}

function networkForProfile(profile: NetworkProfile): BlendNetworkName {
  if (profile.realFunds || profile.name === "mainnet") return "mainnet";
  return "testnet";
}

function buildDeployment(
  network: BlendNetworkName,
  source: BlendDeployment["source"],
  ids: Record<string, string>,
  hashes: Record<string, string>,
  env: Record<string, string>
): BlendDeployment {
  const usdcIssuer = env.NEXT_PUBLIC_USDC_ISSUER;
  const blndIssuer = env.NEXT_PUBLIC_BLND_ISSUER;
  const blockedPools = parseBlockedPools(env.NEXT_PUBLIC_BLOCKED_POOLS);
  const assets = ["XLM", "USDC", "BLND"]
    .filter((symbol) => ids[symbol])
    .map((symbol) => {
      const issuer = symbol === "USDC" ? usdcIssuer : symbol === "BLND" ? blndIssuer : undefined;
      return {
        symbol,
        contractId: ids[symbol]!,
        ...(issuer === undefined ? {} : { issuer, classicAsset: `${symbol}:${issuer}` })
      };
    });
  const pools = Object.entries(ids)
    .filter(([name]) => isDeploymentPoolName(name))
    .map(([name, contractId]) => ({
      name,
      contractId,
      version: name.endsWith("V2") ? ("v2" as const) : ("v1" as const),
      ...(blockedPools.includes(contractId) ? { blocked: true } : {})
    }));
  return {
    network,
    source,
    ids,
    hashes,
    assets,
    pools,
    contracts: {
      ...(ids.backstop === undefined ? {} : { backstop: ids.backstop }),
      ...(ids.backstopV2 === undefined ? {} : { backstopV2: ids.backstopV2 }),
      ...(ids.poolFactory === undefined ? {} : { poolFactory: ids.poolFactory }),
      ...(ids.poolFactoryV2 === undefined ? {} : { poolFactoryV2: ids.poolFactoryV2 }),
      ...(ids.emitter === undefined ? {} : { emitter: ids.emitter })
    },
    blockedPools
  };
}

function isDeploymentPoolName(name: string): boolean {
  const reserved = new Set([
    "XLM",
    "BLND",
    "USDC",
    "wETH",
    "wBTC",
    "bootstrapper",
    "emitter",
    "poolFactory",
    "poolFactoryV2",
    "backstop",
    "backstopV2",
    "comet",
    "cometFactory",
    "oraclemock"
  ]);
  return !reserved.has(name) && /^[A-Z][A-Za-z0-9]+(V2)?$/.test(name);
}

function parseEnv(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
    if (!match) continue;
    values[match[1]!] = match[2]!.replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function aquariusPoolFromApi(raw: any): AquariusPoolSummary {
  return {
    index: String(raw.index ?? ""),
    address: String(raw.address ?? ""),
    tokens: Array.isArray(raw.tokens_str) ? raw.tokens_str.map(String) : [],
    tokenAddresses: Array.isArray(raw.tokens_addresses) ? raw.tokens_addresses.map(String) : [],
    poolType: String(raw.pool_type ?? "unknown"),
    fee: String(raw.fee ?? "unknown"),
    ...(raw.a === undefined ? {} : { amplification: raw.a }),
    ...(raw.tx_count === undefined ? {} : { txCount: raw.tx_count }),
    ...(raw.total_volume === undefined ? {} : { totalVolume: raw.total_volume })
  };
}

function aquariusQuoteFromApi(raw: any): AquariusSwapQuote {
  return {
    success: Boolean(raw.success),
    amount: String(raw.amount ?? "0"),
    ...(raw.amount_with_fee === undefined ? {} : { amountWithFee: String(raw.amount_with_fee) }),
    ...(raw.swap_chain_xdr === undefined ? {} : { swapChainXdr: String(raw.swap_chain_xdr) }),
    pools: Array.isArray(raw.pools) ? raw.pools.map(String) : [],
    tokens: Array.isArray(raw.tokens) ? raw.tokens.map(String) : [],
    tokenAddresses: Array.isArray(raw.tokens_addresses) ? raw.tokens_addresses.map(String) : [],
    raw
  };
}

function isContractId(input: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(input);
}

function validatePositiveInteger(input: number, label: string): number {
  if (!Number.isInteger(input) || input <= 0) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: `${label} must be a positive integer.`,
      docs: "docs/defi-aquarius.md"
    });
  }
  return input;
}

function validatePositiveDecimal(input: string, label: string): void {
  validateDecimal(input, label, false);
}

function validateNonnegativeDecimal(input: string, label: string): void {
  validateDecimal(input, label, true);
}

function validateDecimal(input: string, label: string, allowZero: boolean): void {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(input.trim())) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: `${label} must be a decimal number.`,
      docs: "docs/defi-aquarius.md"
    });
  }
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value <= 0)) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: `${label} must be ${allowZero ? "nonnegative" : "greater than zero"}.`,
      docs: "docs/defi-aquarius.md"
    });
  }
}

function decimalToStroops(input: string): string {
  validatePositiveDecimal(input, "amount");
  const [whole, fraction = ""] = input.split(".");
  const padded = `${fraction}0000000`.slice(0, 7);
  if (fraction.length > 7) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "Aquarius amounts support at most 7 decimal places.",
      docs: "docs/defi-aquarius.md"
    });
  }
  return String(BigInt(whole!) * 10_000_000n + BigInt(padded));
}

function parseBlockedPools(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^['"]|['"]$/g, "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function loadPool(profile: NetworkProfile, poolId: string, version?: BlendPoolVersion): Promise<any> {
  const blend: any = await import("@blend-capital/blend-sdk");
  const network = {
    rpc: profile.rpcUrl,
    passphrase: profile.networkPassphrase,
    opts: { allowHttp: profile.name === "local" }
  };
  if (!profile.rpcUrl) {
    throw new StellarAgentError({
      code: "RPC_UNAVAILABLE",
      message: "Soroban RPC is not configured for the selected profile.",
      docs: "docs/defi-blend.md"
    });
  }
  if (version === "v1") return blend.PoolV1.load(network, poolId);
  if (version === "v2") return blend.PoolV2.load(network, poolId);
  try {
    return await blend.PoolV2.load(network, poolId);
  } catch {
    return blend.PoolV1.load(network, poolId);
  }
}

async function tryLoadOracle(pool: any): Promise<any | undefined> {
  try {
    return await pool.loadOracle();
  } catch {
    return undefined;
  }
}

async function tryBuildPoolEstimate(pool: any, oracle: any): Promise<unknown | undefined> {
  try {
    const blend: any = await import("@blend-capital/blend-sdk");
    return toPlainJson(blend.PoolEstimate.build(pool.reserves, oracle));
  } catch {
    return undefined;
  }
}

async function tryBuildPositionEstimate(pool: any, oracle: any, positions: any): Promise<BlendPositionEstimate | undefined> {
  try {
    const blend: any = await import("@blend-capital/blend-sdk");
    const estimate = blend.PositionsEstimate.build(pool, oracle, positions);
    const result: BlendPositionEstimate = {
      totalBorrowed: estimate.totalBorrowed,
      totalSupplied: estimate.totalSupplied,
      totalEffectiveLiabilities: estimate.totalEffectiveLiabilities,
      totalEffectiveCollateral: estimate.totalEffectiveCollateral,
      borrowCap: estimate.borrowCap,
      borrowLimit: estimate.borrowLimit,
      healthFactor: blendHealthFactor(estimate),
      netApy: estimate.netApy,
      supplyApy: estimate.supplyApy,
      borrowApy: estimate.borrowApy
    };
    return result;
  } catch {
    return undefined;
  }
}

function reserveSummary(reserve: any, oracle: any | undefined): unknown {
  return toPlainJson({
    assetId: reserve.assetId,
    index: reserve.config?.index,
    decimals: reserve.config?.decimals,
    enabled: reserve.config?.enabled,
    supplyCap: reserve.config?.supply_cap,
    totalSupply: reserve.totalSupplyFloat(),
    totalLiabilities: reserve.totalLiabilitiesFloat(),
    utilization: reserve.getUtilizationFloat(),
    collateralFactor: reserve.getCollateralFactor(),
    liabilityFactor: reserve.getLiabilityFactor(),
    supplyApr: reserve.supplyApr,
    estSupplyApy: reserve.estSupplyApy,
    borrowApr: reserve.borrowApr,
    estBorrowApy: reserve.estBorrowApy,
    price: oracle?.getPriceFloat(reserve.assetId),
    latestLedger: reserve.latestLedger
  });
}

function normalizeLoadedPoolVersion(version: unknown): BlendPoolVersion {
  return String(version).toLowerCase() === "v1" ? "v1" : "v2";
}

function preflightAction(pool: any, oracle: any | undefined, action: BlendAction): BlendPreflight["actions"][number] {
  const reserve = reserveForAction(pool, action);
  const decimals = reserve.config?.decimals ?? 7;
  const amountRaw = decimalToFixed(action.amount, decimals);
  const value = Number(action.amount) * (oracle?.getPriceFloat(reserve.assetId) ?? 1);
  const expectedTokens = expectedTokensForAction(reserve, action.type, amountRaw);
  return {
    ...action,
    assetId: reserve.assetId,
    amountRaw: amountRaw.toString(),
    requestType: REQUEST_TYPE_BY_ACTION[action.type],
    ...(expectedTokens === undefined ? {} : { expectedTokens }),
    value
  };
}

function reserveForAction(pool: any, action: BlendAction): any {
  const reserve = Array.from(pool.reserves.values()).find((candidate: any) => {
    return candidate.assetId === action.asset || String(candidate.assetId).toLowerCase() === action.asset.toLowerCase();
  });
  if (!reserve) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: `Pool ${pool.id} does not include reserve ${action.asset}.`,
      docs: "docs/defi-blend.md"
    });
  }
  return reserve;
}

function expectedTokensForAction(reserve: any, type: BlendActionType, amountRaw: bigint): { bTokens?: string; dTokens?: string } | undefined {
  if (type === "supply" || type === "supply_collateral" || type === "withdraw" || type === "withdraw_collateral") {
    return { bTokens: reserve.toBTokensFromAssetCeil(amountRaw).toString() };
  }
  if (type === "borrow" || type === "repay") {
    return { dTokens: reserve.toDTokensFromAssetCeil(amountRaw).toString() };
  }
  return undefined;
}

function projectPositionEstimate(
  before: BlendPositionEstimate,
  actions: BlendPreflight["actions"]
): BlendPositionEstimate {
  let totalSupplied = before.totalSupplied;
  let totalBorrowed = before.totalBorrowed;
  let totalEffectiveCollateral = before.totalEffectiveCollateral;
  let totalEffectiveLiabilities = before.totalEffectiveLiabilities;
  for (const action of actions) {
    const value = action.value ?? 0;
    if (action.type === "supply") totalSupplied += value;
    if (action.type === "withdraw") totalSupplied = Math.max(0, totalSupplied - value);
    if (action.type === "supply_collateral") {
      totalSupplied += value;
      totalEffectiveCollateral += value;
    }
    if (action.type === "withdraw_collateral") {
      totalSupplied = Math.max(0, totalSupplied - value);
      totalEffectiveCollateral = Math.max(0, totalEffectiveCollateral - value);
    }
    if (action.type === "borrow") {
      totalBorrowed += value;
      totalEffectiveLiabilities += value;
    }
    if (action.type === "repay") {
      totalBorrowed = Math.max(0, totalBorrowed - value);
      totalEffectiveLiabilities = Math.max(0, totalEffectiveLiabilities - value);
    }
  }
  return {
    ...before,
    totalSupplied,
    totalBorrowed,
    totalEffectiveCollateral,
    totalEffectiveLiabilities,
    healthFactor: blendHealthFactor({ totalEffectiveCollateral, totalEffectiveLiabilities })
  };
}

function decimalToFixed(input: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(input)) {
    throw new StellarAgentError({
      code: "INVALID_AMOUNT",
      message: "Blend amount must be a positive decimal number.",
      docs: "docs/defi-blend.md"
    });
  }
  const [whole = "0", fraction = ""] = input.split(".");
  if (fraction.length > decimals) {
    throw new StellarAgentError({
      code: "INVALID_AMOUNT",
      message: `Blend amount exceeds reserve precision of ${decimals} decimals.`,
      docs: "docs/defi-blend.md"
    });
  }
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (raw <= 0n) {
    throw new StellarAgentError({
      code: "INVALID_AMOUNT",
      message: "Blend amount must be greater than zero.",
      docs: "docs/defi-blend.md"
    });
  }
  return raw;
}

function toPlainJson(value: unknown): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Map) {
    return Array.from(value.entries()).map(([key, entry]) => ({ key: toPlainJson(key), value: toPlainJson(entry) }));
  }
  if (Array.isArray(value)) return value.map((entry) => toPlainJson(entry));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "function" || entry === undefined) continue;
      output[key] = toPlainJson(entry);
    }
    return output;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

async function pollRpcTransaction(server: any, hash: string): Promise<any> {
  let last: any;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    last = await server.getTransaction(hash);
    if (last.status === "SUCCESS" || last.status === "FAILED") return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new StellarAgentError({
    code: "TRANSACTION_TIMEOUT",
    message: "Timed out waiting for Blend transaction confirmation.",
    docs: "docs/defi-blend.md",
    details: toPlainJson(last)
  });
}

function decodeRpcEvents(transaction: any): unknown[] {
  const events = transaction.events ?? transaction.resultMeta?.events ?? [];
  return summarizeEvents(events);
}

function xdrLikeToString(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (value && typeof value.toXDR === "function") return value.toXDR("base64");
  return undefined;
}

function summarizeEvents(events: unknown): unknown[] {
  if (!Array.isArray(events)) return [];
  return events.slice(0, 25).map((event) => summarizeEvent(event));
}

function summarizeEvent(input: any): Record<string, unknown> {
  const event = input?._attributes?.event ?? input?.event ?? input;
  const eventAttributes = event?._attributes ?? event;
  const body = eventAttributes?.body?._value?._attributes ?? eventAttributes?.body?.v0?._attributes;
  const topics = body?.topics ?? [];
  return {
    ...(input?._attributes?.inSuccessfulContractCall === undefined
      ? {}
      : { inSuccessfulContractCall: Boolean(input._attributes.inSuccessfulContractCall) }),
    ...(eventAttributes?.type === undefined ? {} : { type: eventAttributes.type.name ?? eventAttributes.type.value ?? eventAttributes.type }),
    topics: Array.isArray(topics) ? topics.map((topic) => summarizeScVal(topic)) : [],
    data: summarizeScVal(body?.data)
  };
}

function summarizeScVal(value: any): unknown {
  if (value === undefined || value === null) return undefined;
  const arm = value._arm ?? value.arm;
  const raw = value._value ?? value.value;
  if (arm === "sym" || arm === "str" || value._switch?.name === "scvSymbol" || value._switch?.name === "scvString") {
    return bytesToAscii(raw);
  }
  if (arm === "i128" || value._switch?.name === "scvI128") {
    return {
      i128: {
        hi: String(raw?._attributes?.hi?._value ?? raw?.hi ?? "0"),
        lo: String(raw?._attributes?.lo?._value ?? raw?.lo ?? "0")
      }
    };
  }
  if (arm === "u32" || value._switch?.name === "scvU32") return raw;
  if (arm === "vec" && Array.isArray(raw)) return raw.map((entry) => summarizeScVal(entry));
  if (arm === "map" && Array.isArray(raw)) {
    return raw.map((entry) => ({
      key: summarizeScVal(entry?._attributes?.key),
      value: summarizeScVal(entry?._attributes?.val)
    }));
  }
  if (arm === "address" || value._switch?.name === "scvAddress") return "address";
  if (arm === "bytes" || value._switch?.name === "scvBytes") return "bytes";
  if (value._switch?.name) return value._switch.name;
  return undefined;
}

function bytesToAscii(value: any): string | undefined {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value).toString("utf8");
  if (value && typeof value === "object") {
    const bytes = Object.keys(value)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => Number(value[key]));
    if (bytes.length > 0) return Buffer.from(bytes).toString("utf8");
  }
  return undefined;
}

export function blendNetworkForProfile(profile: NetworkProfile): BlendNetworkName {
  return networkForProfile(profile);
}

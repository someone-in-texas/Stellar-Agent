import { NetworkProfile, StellarAgentError } from "@stellar-agent/core";

export type BlendNetworkName = "testnet" | "mainnet";
export type BlendPoolVersion = "v1" | "v2";
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

const BLEND_UTILS_BASE = "https://raw.githubusercontent.com/blend-capital/blend-utils/main";
const BLEND_UI_BASE = "https://raw.githubusercontent.com/blend-capital/blend-ui/main";

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
      version: pool.version,
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
    pool: { id: pool.id, version: pool.version },
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
      version: pool.version
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

export function blendNetworkForProfile(profile: NetworkProfile): BlendNetworkName {
  return networkForProfile(profile);
}

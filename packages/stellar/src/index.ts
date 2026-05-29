import {
  NetworkProfile,
  StellarAgentError,
  TESTNET_PROFILE,
  TestnetWallet,
  parseAmount,
  redactWallet
} from "@stellar-agent/core";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder
} from "@stellar/stellar-sdk";

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
  const profile = args.profile ?? TESTNET_PROFILE;
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

  const amount = parseAmount(args.amount).value;
  const keypair = Keypair.fromSecret(args.source.secretKey);
  const server = new Horizon.Server(profile.horizonUrl);

  try {
    const sourceAccount = await server.loadAccount(args.source.publicKey);
    let builder = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: profile.networkPassphrase
    }).addOperation(
      Operation.payment({
        destination: args.destination,
        asset: Asset.native(),
        amount
      })
    );
    if (args.memo) builder = builder.addMemo(Memo.text(args.memo));
    const tx = builder.setTimeout(60).build();
    tx.sign(keypair);
    const result: any = await server.submitTransaction(tx);
    return {
      hash: result.hash,
      ledger: result.ledger,
      successful: result.successful ?? true,
      feeCharged: result.fee_charged?.toString()
    };
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

function safeJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

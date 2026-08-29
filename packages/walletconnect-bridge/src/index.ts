import { EXIT_CODES, NetworkName, SignerCapabilities, StellarAgentError, redactSensitive, resolvePath } from "@stellar-agent/core";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type WalletConnectStellarChain = "stellar:testnet" | "stellar:pubnet";
export type WalletConnectStellarMethod = "stellar_signXDR";
export type WalletConnectWalletName = "lobstr" | "walletconnect";

export interface WalletConnectMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

export interface WalletConnectAccount {
  namespace: "stellar";
  chain: "testnet" | "pubnet";
  address: string;
  raw: string;
}

export interface WalletConnectSessionNamespace {
  accounts?: string[];
  chains?: string[];
  methods?: string[];
  events?: string[];
}

export interface WalletConnectSession {
  topic: string;
  peer?: {
    metadata?: {
      name?: string;
      description?: string;
      url?: string;
    };
  };
  namespaces: Record<string, WalletConnectSessionNamespace>;
}

export interface WalletConnectSignClient {
  connect(args: { requiredNamespaces: Record<string, { chains: string[]; methods: string[]; events: string[] }> }): Promise<{ uri?: string; approval(): Promise<WalletConnectSession> }>;
  request(args: { topic: string; chainId: WalletConnectStellarChain; request: { method: WalletConnectStellarMethod; params: { xdr: string } } }): Promise<unknown>;
  session?: {
    getAll(): WalletConnectSession[];
  };
  core?: {
    heartbeat?: {
      stop?: () => void;
    };
    relayer?: {
      transportClose?: () => Promise<void> | void;
      subscriber?: {
        stop?: () => Promise<void> | void;
      };
      provider?: {
        disconnect?: () => Promise<void> | void;
        close?: () => Promise<void> | void;
      };
    };
  };
  disconnect?(args: { topic: string; reason: { code: number; message: string } }): Promise<void>;
}

export interface WalletConnectSignClientInitOptions {
  projectId: string;
  metadata: WalletConnectMetadata;
  storageOptions?: {
    database: string;
  };
}

interface WalletConnectSignClientClass {
  init(options: WalletConnectSignClientInitOptions): Promise<WalletConnectSignClient>;
}

export interface WalletConnectSignResult {
  signedTransactionXdr: string;
  signerPublicKey?: string | undefined;
  session: WalletConnectSession;
  chainId: WalletConnectStellarChain;
  method: WalletConnectStellarMethod;
}

export interface WalletConnectSessionView {
  topic: string;
  peerName?: string | undefined;
  peerUrl?: string | undefined;
  accounts: WalletConnectAccount[];
}

export const WALLETCONNECT_STELLAR_SIGN_METHOD: WalletConnectStellarMethod = "stellar_signXDR";

export function walletConnectSignerCapabilities(session: WalletConnectSession, network: NetworkName): SignerCapabilities {
  const accounts = parseWalletConnectSessionAccounts(session)
    .filter((account) => walletConnectNetworkForChain(`stellar:${account.chain}` as WalletConnectStellarChain) === network)
    .map((account) => account.address);
  return {
    provider: "walletconnect",
    accounts,
    networks: [network],
    signTransaction: true,
    signAuthEntry: false,
    submitTransaction: false
  };
}

export function walletConnectChainForNetwork(network: NetworkName): WalletConnectStellarChain {
  if (network === "testnet") return "stellar:testnet";
  if (network === "mainnet") return "stellar:pubnet";
  throw new StellarAgentError({
    code: "INVALID_INPUT",
    message: "WalletConnect signing supports only Testnet and Mainnet Stellar chains.",
    docs: "docs/mainnet-safety.md#walletconnect-signing",
    exitCode: EXIT_CODES.usage
  });
}

export function walletConnectNetworkForChain(chain: WalletConnectStellarChain): "testnet" | "mainnet" {
  return chain === "stellar:testnet" ? "testnet" : "mainnet";
}

export function walletConnectRequiredNamespaces(network: NetworkName) {
  return {
    stellar: {
      chains: [walletConnectChainForNetwork(network)],
      methods: [WALLETCONNECT_STELLAR_SIGN_METHOD],
      events: []
    }
  };
}

export function walletConnectMetadata(wallet: WalletConnectWalletName = "lobstr"): WalletConnectMetadata {
  return {
    name: "Stellar Agent",
    description: wallet === "lobstr" ? "External Stellar transaction signing for Stellar Agent approval requests through LOBSTR WalletConnect." : "External Stellar transaction signing for Stellar Agent approval requests through WalletConnect.",
    url: "https://github.com/someone-in-texas/Stellar-Agent",
    icons: []
  };
}

export function requireWalletConnectProjectId(projectId?: string): string {
  const resolved = projectId ?? process.env.WALLETCONNECT_PROJECT_ID;
  if (!resolved || resolved.trim().length === 0) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "WalletConnect project id is required.",
      hint: "Pass --project-id or set WALLETCONNECT_PROJECT_ID.",
      docs: "docs/mainnet-safety.md#walletconnect-signing"
    });
  }
  return resolved;
}

export async function createWalletConnectSignClient(args: { projectId?: string | undefined; metadata?: WalletConnectMetadata | undefined; storagePath?: string | undefined }): Promise<WalletConnectSignClient> {
  const module = await import("@walletconnect/sign-client");
  const SignClient = resolveWalletConnectSignClientExport(module);
  return (await SignClient.init(await walletConnectSignClientInitOptions(args))) as WalletConnectSignClient;
}

export async function walletConnectSignClientInitOptions(args: { projectId?: string | undefined; metadata?: WalletConnectMetadata | undefined; storagePath?: string | undefined }): Promise<WalletConnectSignClientInitOptions> {
  const projectId = requireWalletConnectProjectId(args.projectId);
  const metadata = args.metadata ?? walletConnectMetadata();
  if (!args.storagePath) return { projectId, metadata };

  const database = resolvePath(args.storagePath);
  await mkdir(dirname(database), { recursive: true });
  return {
    projectId,
    metadata,
    storageOptions: { database }
  };
}

export function resolveWalletConnectSignClientExport(module: unknown): WalletConnectSignClientClass {
  const moduleRecord = asRecord(module);
  const defaultRecord = asRecord(moduleRecord?.default);
  const candidates = [moduleRecord?.SignClient, moduleRecord?.default, defaultRecord?.SignClient];
  const SignClient = candidates.find(hasWalletConnectSignClientInit);
  if (!SignClient) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "WalletConnect SignClient SDK export could not be initialized.",
      hint: "Install a compatible @walletconnect/sign-client version.",
      docs: "docs/mainnet-safety.md#walletconnect-signing"
    });
  }
  return SignClient as WalletConnectSignClientClass;
}

function hasWalletConnectSignClientInit(candidate: unknown): candidate is WalletConnectSignClientClass {
  if (candidate === null || (typeof candidate !== "object" && typeof candidate !== "function")) return false;
  return typeof (candidate as { init?: unknown }).init === "function";
}

export async function pairWalletConnectSession(args: { client: WalletConnectSignClient; network: NetworkName; onPairingUri?: ((uri: string) => void) | undefined; timeoutMs?: number | undefined }): Promise<WalletConnectSession> {
  const { uri, approval } = await args.client.connect({
    requiredNamespaces: walletConnectRequiredNamespaces(args.network)
  });
  if (uri) args.onPairingUri?.(uri);
  const session = await withTimeout(approval(), args.timeoutMs ?? 120_000, "WalletConnect session approval timed out.");
  assertWalletConnectSessionSupportsNetwork(session, args.network);
  return session;
}

export async function signTransactionXdrWithWalletConnect(args: { client: WalletConnectSignClient; network: NetworkName; transactionXdr: string; expectedSignerPublicKey?: string | undefined; onPairingUri?: ((uri: string) => void) | undefined; timeoutMs?: number | undefined }): Promise<WalletConnectSignResult> {
  const chainId = walletConnectChainForNetwork(args.network);
  const session = await pairWalletConnectSession({
    client: args.client,
    network: args.network,
    ...(args.onPairingUri === undefined ? {} : { onPairingUri: args.onPairingUri }),
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
  });
  const accounts = assertWalletConnectSessionSupportsNetwork(session, args.network);
  const signer = selectWalletConnectSigner(accounts, args.expectedSignerPublicKey);
  const result = await withTimeout(
    args.client.request({
      topic: session.topic,
      chainId,
      request: {
        method: WALLETCONNECT_STELLAR_SIGN_METHOD,
        params: { xdr: args.transactionXdr }
      }
    }),
    args.timeoutMs ?? 120_000,
    "WalletConnect signing request timed out."
  );
  return {
    signedTransactionXdr: extractSignedTransactionXdr(result),
    session,
    chainId,
    method: WALLETCONNECT_STELLAR_SIGN_METHOD,
    ...(signer?.address === undefined ? {} : { signerPublicKey: signer.address })
  };
}

export function listWalletConnectSessions(client: WalletConnectSignClient): WalletConnectSessionView[] {
  return (client.session?.getAll() ?? []).map(walletConnectSessionView);
}

export async function disconnectWalletConnectSession(args: { client: WalletConnectSignClient; topic: string }): Promise<{ topic: string; disconnected: true }> {
  if (!args.client.disconnect) {
    throw new StellarAgentError({
      code: "INVALID_INPUT",
      message: "WalletConnect client does not support session disconnect.",
      docs: "docs/mainnet-safety.md#walletconnect-signing"
    });
  }
  await args.client.disconnect({
    topic: args.topic,
    reason: { code: 6000, message: "User disconnected." }
  });
  return { topic: args.topic, disconnected: true };
}

export async function closeWalletConnectSignClient(client: WalletConnectSignClient): Promise<void> {
  for (const [owner, close] of [
    [client.core?.relayer, client.core?.relayer?.transportClose],
    [client.core?.relayer?.provider, client.core?.relayer?.provider?.disconnect],
    [client.core?.relayer?.provider, client.core?.relayer?.provider?.close],
    [client.core?.relayer?.subscriber, client.core?.relayer?.subscriber?.stop],
    [client.core?.heartbeat, client.core?.heartbeat?.stop]
  ] as const) {
    if (typeof close !== "function") continue;
    try {
      await close.call(owner);
    } catch {
      // Best-effort cleanup should not turn a completed signing/status command into a failure.
    }
  }
}

export function walletConnectSessionView(session: WalletConnectSession): WalletConnectSessionView {
  return {
    topic: session.topic,
    accounts: parseWalletConnectSessionAccounts(session),
    ...(session.peer?.metadata?.name === undefined ? {} : { peerName: session.peer.metadata.name }),
    ...(session.peer?.metadata?.url === undefined ? {} : { peerUrl: session.peer.metadata.url })
  };
}

export function assertWalletConnectSessionSupportsNetwork(session: WalletConnectSession, network: NetworkName): WalletConnectAccount[] {
  const expectedChain = walletConnectChainForNetwork(network);
  const accounts = parseWalletConnectSessionAccounts(session).filter((account) => account.raw.startsWith(`${expectedChain}:`));
  if (accounts.length === 0) {
    throw new StellarAgentError({
      code: "APPROVAL_DENIED",
      message: "WalletConnect session does not include an account for the approval network.",
      hint: `Connect a Stellar wallet account on ${expectedChain}.`,
      docs: "docs/mainnet-safety.md#walletconnect-signing"
    });
  }
  const methods = session.namespaces.stellar?.methods ?? [];
  if (!methods.includes(WALLETCONNECT_STELLAR_SIGN_METHOD)) {
    throw new StellarAgentError({
      code: "APPROVAL_DENIED",
      message: "WalletConnect session does not allow stellar_signXDR.",
      docs: "docs/mainnet-safety.md#walletconnect-signing"
    });
  }
  return accounts;
}

export function parseWalletConnectSessionAccounts(session: WalletConnectSession): WalletConnectAccount[] {
  return Object.values(session.namespaces)
    .flatMap((namespace) => namespace.accounts ?? [])
    .map(parseWalletConnectAccount)
    .filter((account): account is WalletConnectAccount => account !== null);
}

export function extractSignedTransactionXdr(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") {
    throw invalidWalletConnectResult();
  }
  const value = result as Record<string, unknown>;
  const signed = value.signedXDR ?? value.signedXdr ?? value.signedTransactionXdr ?? value.xdr;
  if (typeof signed !== "string" || signed.trim().length === 0) {
    throw invalidWalletConnectResult();
  }
  return signed;
}

function selectWalletConnectSigner(accounts: WalletConnectAccount[], expectedSignerPublicKey?: string): WalletConnectAccount | undefined {
  if (!expectedSignerPublicKey) return accounts[0];
  const signer = accounts.find((account) => account.address === expectedSignerPublicKey);
  if (!signer) {
    throw new StellarAgentError({
      code: "APPROVAL_DENIED",
      message: "Connected WalletConnect account does not match the approval source account.",
      hint: "Connect the wallet that owns the approval source account, then retry.",
      docs: "docs/mainnet-safety.md#walletconnect-signing"
    });
  }
  return signer;
}

function parseWalletConnectAccount(raw: string): WalletConnectAccount | null {
  const match = /^stellar:(testnet|pubnet):(.+)$/.exec(raw);
  if (!match?.[1] || !match[2]) return null;
  return {
    namespace: "stellar",
    chain: match[1] as "testnet" | "pubnet",
    address: match[2],
    raw
  };
}

function invalidWalletConnectResult(): StellarAgentError {
  return new StellarAgentError({
    code: "APPROVAL_DENIED",
    message: "WalletConnect signing response did not include signed transaction XDR.",
    docs: "docs/mainnet-safety.md#walletconnect-signing"
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new StellarAgentError({
              code: "APPROVAL_REQUIRED",
              message,
              docs: "docs/mainnet-safety.md#walletconnect-signing"
            })
          );
        }, timeoutMs);
      })
    ]);
  } catch (error) {
    if (error instanceof StellarAgentError) throw error;
    throw new StellarAgentError({
      code: "APPROVAL_DENIED",
      message: "WalletConnect signing failed.",
      details: redactSensitive(error),
      docs: "docs/mainnet-safety.md#walletconnect-signing"
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

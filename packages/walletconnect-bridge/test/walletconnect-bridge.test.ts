import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertWalletConnectSessionSupportsNetwork,
  disconnectWalletConnectSession,
  extractSignedTransactionXdr,
  listWalletConnectSessions,
  pairWalletConnectSession,
  parseWalletConnectSessionAccounts,
  resolveWalletConnectSignClientExport,
  signTransactionXdrWithWalletConnect,
  walletConnectChainForNetwork,
  walletConnectMetadata,
  walletConnectRequiredNamespaces,
  walletConnectSignClientInitOptions,
  walletConnectSessionView,
  type WalletConnectSession,
  type WalletConnectSignClient
} from "../src/index.js";

const source = "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const otherSource = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("walletconnect bridge", () => {
  it("maps Stellar Agent networks to WalletConnect Stellar chains", () => {
    expect(walletConnectChainForNetwork("testnet")).toBe("stellar:testnet");
    expect(walletConnectChainForNetwork("mainnet")).toBe("stellar:pubnet");
    expect(() => walletConnectChainForNetwork("local")).toThrow("supports only Testnet and Mainnet");
  });

  it("builds WalletConnect namespaces for stellar_signXDR only", () => {
    expect(walletConnectRequiredNamespaces("testnet")).toEqual({
      stellar: {
        chains: ["stellar:testnet"],
        methods: ["stellar_signXDR"],
        events: []
      }
    });
  });

  it("describes LOBSTR metadata without secret handling", () => {
    expect(walletConnectMetadata("lobstr")).toMatchObject({
      name: "Stellar Agent",
      description: expect.stringContaining("LOBSTR")
    });
  });

  it("uses the named SignClient export when the default export is a namespace object", () => {
    const namedInit = vi.fn();
    const defaultInit = vi.fn();
    const resolved = resolveWalletConnectSignClientExport({
      SignClient: { init: namedInit },
      default: { SignClient: { init: defaultInit } }
    });

    expect(resolved.init).toBe(namedInit);
  });

  it("builds durable WalletConnect storage options", async () => {
    const root = await mkdtemp(join(tmpdir(), "stellar-agent-walletconnect-"));
    const storagePath = join(root, "walletconnect", "sessions.db");

    await expect(
      walletConnectSignClientInitOptions({
        projectId: "project-test",
        metadata: walletConnectMetadata("lobstr"),
        storagePath
      })
    ).resolves.toEqual({
      projectId: "project-test",
      metadata: walletConnectMetadata("lobstr"),
      storageOptions: { database: storagePath }
    });
    const storageDir = await stat(join(root, "walletconnect"));
    expect(storageDir.isDirectory()).toBe(true);
  });

  it("parses and views WalletConnect Stellar session accounts", () => {
    const session = sessionFixture({ chain: "testnet", address: source });
    expect(parseWalletConnectSessionAccounts(session)).toEqual([
      { namespace: "stellar", chain: "testnet", address: source, raw: `stellar:testnet:${source}` }
    ]);
    expect(walletConnectSessionView(session)).toMatchObject({
      topic: "topic-test",
      peerName: "LOBSTR",
      accounts: [{ address: source }]
    });
  });

  it("rejects sessions on the wrong network", () => {
    const session = sessionFixture({ chain: "pubnet", address: source });
    expect(() => assertWalletConnectSessionSupportsNetwork(session, "testnet")).toThrow(
      "does not include an account for the approval network"
    );
  });

  it("rejects sessions that do not allow stellar_signXDR", () => {
    const session = sessionFixture({ chain: "testnet", address: source, methods: ["stellar_signAndSubmitXDR"] });
    expect(() => assertWalletConnectSessionSupportsNetwork(session, "testnet")).toThrow("does not allow stellar_signXDR");
  });

  it("pairs a WalletConnect session and reports the pairing URI", async () => {
    const client = new FakeWalletConnectClient({ session: sessionFixture({ chain: "testnet", address: source }) });
    const uris: string[] = [];
    await expect(
      pairWalletConnectSession({
        client,
        network: "testnet",
        onPairingUri: (uri) => uris.push(uri)
      })
    ).resolves.toMatchObject({ topic: "topic-test" });
    expect(uris).toEqual(["wc:test"]);
    expect(client.connectedNamespaces).toEqual(walletConnectRequiredNamespaces("testnet"));
  });

  it("requests stellar_signXDR and returns signed transaction XDR", async () => {
    const client = new FakeWalletConnectClient({
      session: sessionFixture({ chain: "testnet", address: source }),
      signingResult: { signedXDR: "signed-xdr" }
    });
    await expect(
      signTransactionXdrWithWalletConnect({
        client,
        network: "testnet",
        transactionXdr: "unsigned-xdr",
        expectedSignerPublicKey: source
      })
    ).resolves.toMatchObject({
      signedTransactionXdr: "signed-xdr",
      signerPublicKey: source,
      chainId: "stellar:testnet",
      method: "stellar_signXDR"
    });
    expect(client.requested).toEqual({
      topic: "topic-test",
      chainId: "stellar:testnet",
      request: {
        method: "stellar_signXDR",
        params: { xdr: "unsigned-xdr" }
      }
    });
  });

  it("rejects signing when the connected account is not the expected signer", async () => {
    const client = new FakeWalletConnectClient({ session: sessionFixture({ chain: "testnet", address: otherSource }) });
    await expect(
      signTransactionXdrWithWalletConnect({
        client,
        network: "testnet",
        transactionXdr: "unsigned-xdr",
        expectedSignerPublicKey: source
      })
    ).rejects.toMatchObject({ code: "APPROVAL_DENIED" });
    expect(client.requested).toBeUndefined();
  });

  it("extracts common signed XDR response shapes", () => {
    expect(extractSignedTransactionXdr("xdr-string")).toBe("xdr-string");
    expect(extractSignedTransactionXdr({ signedXDR: "signed-upper" })).toBe("signed-upper");
    expect(extractSignedTransactionXdr({ signedXdr: "signed-lower" })).toBe("signed-lower");
    expect(extractSignedTransactionXdr({ signedTransactionXdr: "signed-long" })).toBe("signed-long");
    expect(() => extractSignedTransactionXdr({ status: "success" })).toThrow("did not include signed transaction XDR");
  });

  it("lists and disconnects sessions through the client", async () => {
    const session = sessionFixture({ chain: "testnet", address: source });
    const client = new FakeWalletConnectClient({ session });
    expect(listWalletConnectSessions(client)).toEqual([walletConnectSessionView(session)]);
    await expect(disconnectWalletConnectSession({ client, topic: session.topic })).resolves.toEqual({
      topic: session.topic,
      disconnected: true
    });
    expect(client.disconnectedTopic).toBe(session.topic);
  });
});

class FakeWalletConnectClient implements WalletConnectSignClient {
  connectedNamespaces: unknown;
  requested: unknown;
  disconnectedTopic: string | undefined;
  readonly session: { getAll: () => WalletConnectSession[] };
  private readonly approvalSession: WalletConnectSession;
  private readonly signingResult: unknown;

  constructor(args: { session: WalletConnectSession; signingResult?: unknown }) {
    this.approvalSession = args.session;
    this.signingResult = args.signingResult ?? { signedXDR: "signed-xdr" };
    this.session = { getAll: () => [args.session] };
  }

  async connect(args: { requiredNamespaces: Record<string, { chains: string[]; methods: string[]; events: string[] }> }) {
    this.connectedNamespaces = args.requiredNamespaces;
    return {
      uri: "wc:test",
      approval: async () => this.approvalSession
    };
  }

  async request(args: {
    topic: string;
    chainId: "stellar:testnet" | "stellar:pubnet";
    request: { method: "stellar_signXDR"; params: { xdr: string } };
  }) {
    this.requested = args;
    return this.signingResult;
  }

  async disconnect(args: { topic: string; reason: { code: number; message: string } }) {
    this.disconnectedTopic = args.topic;
  }
}

function sessionFixture(args: {
  chain: "testnet" | "pubnet";
  address: string;
  methods?: string[];
}): WalletConnectSession {
  return {
    topic: "topic-test",
    peer: { metadata: { name: "LOBSTR", url: "https://lobstr.co" } },
    namespaces: {
      stellar: {
        accounts: [`stellar:${args.chain}:${args.address}`],
        chains: [`stellar:${args.chain}`],
        methods: args.methods ?? ["stellar_signXDR"],
        events: []
      }
    }
  };
}

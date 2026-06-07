import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Account, Asset, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  accountPayments,
  buildClaimableBalancePredicate,
  buildPaymentTransactionXdr,
  checkStellarCli,
  changeLiquidityPoolTrustline,
  changeTrustline,
  clearStellarSessionCache,
  assetContractIdWithStellarCli,
  contractInfoWithStellarCli,
  deployAssetContractWithStellarCli,
  estimateTransactionFee,
  deployContractWithStellarCli,
  extendContractWithStellarCli,
  fetchContractWasmWithStellarCli,
  invokeContractWithStellarCli,
  inspectLiquidityPool,
  listClaimableBalances,
  preflightLiquidityPoolDeposit,
  parseStellarCliTransactionHash,
  readContractWithStellarCli,
  resolveClaimableBalanceClaimants,
  restoreContractWithStellarCli,
  sendPaymentBatch,
  stellarSessionCacheSnapshot,
  submitTransactionXdr,
  uploadContractWasmWithStellarCli
} from "../src/index.js";

const wallet = {
  schemaVersion: "stellar-agent.wallet.v1" as const,
  name: "agent",
  network: "testnet" as const,
  publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  secretKey: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  createdAt: "2026-05-29T00:00:00.000Z",
  source: "generated-testnet" as const
};

describe("stellar operations", () => {
  it("builds unsigned payment transaction XDR", async () => {
    await expect(
      buildPaymentTransactionXdr({
        sourcePublicKey: wallet.publicKey,
        destination: wallet.publicKey,
        amount: "1",
        memo: "sign-me",
        sourceSequence: "1",
        profile: testnetProfile()
      })
    ).resolves.toMatchObject({
      source: wallet.publicKey,
      destination: wallet.publicKey,
      amount: "1.0000000",
      asset: "XLM",
      networkPassphrase: "Test SDF Network ; September 2015",
      xdr: expect.any(String)
    });
  });

  it("uses Horizon fee stats for unsigned payment XDR and caches fee lookups", async () => {
    const fetchImpl = globalThis.fetch;
    let feeStatsCalls = 0;
    globalThis.fetch = async () => {
      feeStatsCalls += 1;
      return new Response(
        JSON.stringify({
          last_ledger_base_fee: "100",
          ledger_capacity_usage: "0.25",
          fee_charged: { p50: "100", p80: "200", p90: "300", p95: "400" }
        })
      );
    };
    clearStellarSessionCache();
    try {
      await expect(
        buildPaymentTransactionXdr({
          sourcePublicKey: wallet.publicKey,
          destination: wallet.publicKey,
          amount: "1",
          sourceSequence: "1",
          profile: testnetProfile(),
          feeStrategy: "high"
        })
      ).resolves.toMatchObject({
        fee: {
          source: "horizon",
          strategy: "high",
          perOperationFee: "300",
          transactionFee: "300",
          cached: false
        }
      });
      await expect(estimateTransactionFee({ profile: testnetProfile(), strategy: "high" })).resolves.toMatchObject({
        perOperationFee: "300",
        cached: true
      });
      expect(feeStatsCalls).toBe(1);
      expect(stellarSessionCacheSnapshot()).toEqual([
        expect.objectContaining({ key: "feeStats:https://horizon-testnet.stellar.org" })
      ]);
    } finally {
      clearStellarSessionCache();
      globalThis.fetch = fetchImpl;
    }
  });

  it("falls back to base fee when Horizon fee stats are unavailable", async () => {
    await expect(
      estimateTransactionFee({
        profile: { ...testnetProfile(), horizonUrl: null },
        operationCount: 3,
        strategy: "p95"
      })
    ).resolves.toMatchObject({
      source: "base_fee_fallback",
      perOperationFee: BASE_FEE,
      transactionFee: String(BigInt(BASE_FEE) * 3n)
    });
  });

  it("rejects oversized payment batches before network access", async () => {
    await expect(
      sendPaymentBatch({
        source: wallet,
        payments: Array.from({ length: 101 }, () => ({
          destination: wallet.publicKey,
          amount: "0.0000001",
          asset: "XLM"
        }))
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("requires explicit approval before building unsigned payment XDR on real-funds profiles", async () => {
    await expect(
      buildPaymentTransactionXdr({
        sourcePublicKey: wallet.publicKey,
        destination: wallet.publicKey,
        amount: "1",
        sourceSequence: "1",
        profile: { ...testnetProfile(), name: "mainnet", network: "mainnet", realFunds: true }
      })
    ).rejects.toMatchObject({ code: "MAINNET_NOT_ENABLED" });
  });

  it("builds unsigned payment transaction XDR on real-funds profiles when explicitly allowed", async () => {
    await expect(
      buildPaymentTransactionXdr({
        sourcePublicKey: wallet.publicKey,
        destination: wallet.publicKey,
        amount: "1",
        sourceSequence: "1",
        profile: { ...testnetProfile(), name: "mainnet", network: "public", networkPassphrase: Networks.PUBLIC, realFunds: true },
        allowRealFunds: true
      })
    ).resolves.toMatchObject({
      source: wallet.publicKey,
      destination: wallet.publicKey,
      amount: "1.0000000",
      networkPassphrase: Networks.PUBLIC,
      xdr: expect.any(String)
    });
  });

  it("rejects native XLM trustlines before network access", async () => {
    await expect(changeTrustline({ source: wallet, asset: "XLM" })).rejects.toMatchObject({
      code: "INVALID_ASSET"
    });
  });

  it("validates liquidity pool ids and price bounds before network access", async () => {
    await expect(inspectLiquidityPool({ poolId: "not-a-pool", profile: testnetProfile() })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "Liquidity pool id must be a 64-character hexadecimal string."
    });

    await expect(
      preflightLiquidityPoolDeposit({
        poolId: poolIdFixture(),
        maxAmountA: "1",
        maxAmountB: "2",
        minPrice: "3",
        maxPrice: "2",
        profile: testnetProfile()
      })
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "Liquidity deposit minPrice must be less than or equal to maxPrice."
    });

    await expect(
      changeLiquidityPoolTrustline({
        source: wallet,
        poolId: "bad",
        profile: testnetProfile()
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("reports nominal liquidity exposure semantics in package preflight", async () => {
    const fetchImpl = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/accounts/")) return new Response(JSON.stringify(accountFixture()));
      return new Response(JSON.stringify(poolFixture()));
    };
    try {
      await expect(
        preflightLiquidityPoolDeposit({
          poolId: poolIdFixture(),
          maxAmountA: "1",
          maxAmountB: "2",
          minPrice: "1.5",
          maxPrice: "2.5",
          account: wallet.publicKey,
          profile: testnetProfile()
        })
      ).resolves.toMatchObject({
        nominalExposure: {
          value: "3.0000000",
          semantics: "sum_of_max_reserve_amounts_not_mark_to_market"
        },
        deposit: {
          maxAmountA: "1.0000000",
          maxAmountB: "2.0000000"
        }
      });
    } finally {
      globalThis.fetch = fetchImpl;
    }
  });

  it("builds unconditional and time-bound claimable balance predicates", () => {
    expect(buildClaimableBalancePredicate().summary).toEqual({ type: "unconditional" });

    const notBefore = buildClaimableBalancePredicate({ claimableAfter: "2030-01-01T00:00:00Z" });
    expect(notBefore.summary).toEqual({
      type: "not_before_absolute_time",
      claimableAfter: {
        epochSeconds: "1893456000",
        iso: "2030-01-01T00:00:00.000Z"
      }
    });
    expect((notBefore.predicate as any).switch().name).toBe("claimPredicateNot");
    expect((notBefore.predicate as any).value().switch().name).toBe("claimPredicateBeforeAbsoluteTime");

    const window = buildClaimableBalancePredicate({
      claimableAfter: "1893456000",
      claimableBefore: "2030-01-02T00:00:00Z"
    });
    expect(window.summary).toEqual({
      type: "time_window",
      claimableAfter: {
        epochSeconds: "1893456000",
        iso: "2030-01-01T00:00:00.000Z"
      },
      claimableBefore: {
        epochSeconds: "1893542400",
        iso: "2030-01-02T00:00:00.000Z"
      }
    });
    expect((window.predicate as any).switch().name).toBe("claimPredicateAnd");
  });

  it("rejects invalid claimable balance predicate windows", () => {
    expect(() => buildClaimableBalancePredicate({ claimableAfter: "bad-date" })).toThrow("claimableAfter must be");
    expect(() =>
      buildClaimableBalancePredicate({
        claimableAfter: "2030-01-02T00:00:00Z",
        claimableBefore: "2030-01-01T00:00:00Z"
      })
    ).toThrow("claimableAfter must be earlier than claimableBefore");
  });

  it("deduplicates primary and additional claimable balance claimants", () => {
    expect(resolveClaimableBalanceClaimants(wallet.publicKey, [wallet.publicKey, "GCLAIMANT"])).toEqual([
      wallet.publicKey,
      "GCLAIMANT"
    ]);
  });

  it("reports missing Stellar CLI for contract invocations", async () => {
    await expect(
      invokeContractWithStellarCli({
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        source: "agent",
        functionName: "hello",
        stellarBinary: "/definitely/missing/stellar"
      })
    ).rejects.toMatchObject({ code: "STELLAR_CLI_UNAVAILABLE" });
  });

  it("reports missing Stellar CLI in readiness checks", async () => {
    await expect(checkStellarCli("/definitely/missing/stellar")).resolves.toEqual({
      available: false,
      binary: "/definitely/missing/stellar",
      error: "not_found"
    });
  });

  it("extracts transaction hashes from Stellar CLI output", () => {
    expect(parseStellarCliTransactionHash(`Signing transaction: ${"a".repeat(64)}\n`)).toBe("a".repeat(64));
    expect(parseStellarCliTransactionHash(`transaction hash: ${"b".repeat(64)}\n`)).toBe("b".repeat(64));
    expect(parseStellarCliTransactionHash("no transaction submitted")).toBeUndefined();
  });

  it("constructs Stellar CLI contract lifecycle commands", async () => {
    const binary = await fakeStellarBinary();
    await expect(
      invokeContractWithStellarCli({
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        source: "agent",
        functionName: "hello",
        contractArgs: { to: "world" },
        network: "testnet",
        stellarConfigDir: "/tmp/stellar-config",
        noCache: true,
        stellarBinary: binary
      })
    ).resolves.toMatchObject({
      command: [
        binary,
        "contract",
        "invoke",
        "--id",
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        "--source-account",
        "agent",
        "--network",
        "testnet",
        "--config-dir",
        "/tmp/stellar-config",
        "--no-cache",
        "--",
        "hello",
        "--to",
        "world"
      ]
    });

    await expect(
      deployContractWithStellarCli({
        source: "agent",
        wasm: "contract.wasm",
        alias: "hello",
        constructorArgs: { admin: wallet.publicKey },
        network: "testnet",
        rpcUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        stellarBinary: binary
      })
    ).resolves.toMatchObject({
      command: [
        binary,
        "contract",
        "deploy",
        "--source-account",
        "agent",
        "--network",
        "testnet",
        "--wasm",
        "contract.wasm",
        "--alias",
        "hello",
        "--rpc-url",
        "https://soroban-testnet.stellar.org",
        "--network-passphrase",
        "Test SDF Network ; September 2015",
        "--",
        "--admin",
        wallet.publicKey
      ]
    });

    await expect(
      uploadContractWasmWithStellarCli({
        source: "agent",
        wasm: "contract.wasm",
        network: "testnet",
        rpcUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        stellarBinary: binary
      })
    ).resolves.toMatchObject({
      command: [
        binary,
        "contract",
        "upload",
        "--source-account",
        "agent",
        "--network",
        "testnet",
        "--wasm",
        "contract.wasm",
        "--rpc-url",
        "https://soroban-testnet.stellar.org",
        "--network-passphrase",
        "Test SDF Network ; September 2015"
      ]
    });

    await expect(
      deployAssetContractWithStellarCli({
        source: "agent",
        asset: "native",
        network: "testnet",
        stellarConfigDir: "/tmp/stellar-config",
        noCache: true,
        stellarBinary: binary
      })
    ).resolves.toMatchObject({
      command: [
        binary,
        "contract",
        "asset",
        "deploy",
        "--source-account",
        "agent",
        "--network",
        "testnet",
        "--asset",
        "native",
        "--config-dir",
        "/tmp/stellar-config",
        "--no-cache"
      ]
    });

    await expect(
      contractInfoWithStellarCli({
        kind: "interface",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        network: "testnet",
        stellarBinary: binary
      })
    ).resolves.toMatchObject({
      command: [
        binary,
        "contract",
        "info",
        "interface",
        "--contract-id",
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        "--network",
        "testnet"
      ]
    });

    await expect(
      assetContractIdWithStellarCli({
        asset: "native",
        network: "testnet",
        stellarBinary: binary
      })
    ).resolves.toMatchObject({
      command: [binary, "contract", "id", "asset", "--asset", "native", "--network", "testnet"]
    });

    await expect(
      readContractWithStellarCli({
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        output: "json",
        network: "testnet",
        stellarBinary: binary
      })
    ).resolves.toMatchObject({
      command: [
        binary,
        "contract",
        "read",
        "--network",
        "testnet",
        "--id",
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        "--output",
        "json"
      ]
    });

    await expect(
      fetchContractWasmWithStellarCli({
        wasmHash: "0123456789abcdef",
        outFile: "/tmp/contract.wasm",
        network: "testnet",
        stellarBinary: binary
      })
    ).resolves.toMatchObject({
      command: [
        binary,
        "contract",
        "fetch",
        "--network",
        "testnet",
        "--wasm-hash",
        "0123456789abcdef",
        "--out-file",
        "/tmp/contract.wasm"
      ]
    });

    await expect(
      extendContractWithStellarCli({
        source: "agent",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        key: "counter",
        ledgersToExtend: 535679,
        durability: "persistent",
        ttlLedgerOnly: true,
        network: "testnet",
        stellarBinary: binary
      })
    ).resolves.toMatchObject({
      command: [
        binary,
        "contract",
        "extend",
        "--source-account",
        "agent",
        "--network",
        "testnet",
        "--ledgers-to-extend",
        "535679",
        "--id",
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        "--key",
        "counter",
        "--durability",
        "persistent",
        "--ttl-ledger-only"
      ]
    });

    await expect(
      restoreContractWithStellarCli({
        source: "agent",
        wasmHash: "0123456789abcdef",
        network: "testnet",
        stellarBinary: binary
      })
    ).resolves.toMatchObject({
      command: [
        binary,
        "contract",
        "restore",
        "--source-account",
        "agent",
        "--network",
        "testnet",
        "--wasm-hash",
        "0123456789abcdef"
      ]
    });
  });

  it("validates contract footprint arguments before invoking Stellar CLI", async () => {
    const binary = await fakeStellarBinary();
    await expect(
      extendContractWithStellarCli({
        source: "agent",
        ledgersToExtend: 0,
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        stellarBinary: binary
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(
      extendContractWithStellarCli({
        source: "agent",
        ledgersToExtend: 1000,
        key: "counter",
        stellarBinary: binary
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(
      restoreContractWithStellarCli({
        source: "agent",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        wasmHash: "0123456789abcdef",
        stellarBinary: binary
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(fetchContractWasmWithStellarCli({ stellarBinary: binary })).rejects.toMatchObject({
      code: "INVALID_INPUT"
    });

    await expect(
      fetchContractWasmWithStellarCli({
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        wasmHash: "0123456789abcdef",
        stellarBinary: binary
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("normalizes Horizon claimable balance records", async () => {
    const fetchImpl = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          _embedded: {
            records: [
              {
                id: "abc",
                asset: "native",
                amount: "1.0000000",
                last_modified_ledger: 123,
                claimants: [{ destination: wallet.publicKey, predicate: { unconditional: true } }]
              }
            ]
          }
        })
      );
    try {
      await expect(
        listClaimableBalances(wallet.publicKey, {
          name: "testnet",
          network: "testnet",
          networkPassphrase: "Test SDF Network ; September 2015",
          horizonUrl: "https://horizon-testnet.stellar.org",
          rpcUrl: "https://soroban-testnet.stellar.org",
          friendbotUrl: "https://friendbot.stellar.org",
          defaultAsset: "XLM",
          realFunds: false
        })
      ).resolves.toEqual([
        {
          id: "abc",
          asset: "native",
          amount: "1.0000000",
          lastModifiedLedger: 123,
          claimants: [{ destination: wallet.publicKey, predicate: { unconditional: true } }]
        }
      ]);
    } finally {
      globalThis.fetch = fetchImpl;
    }
  });

  it("submits signed transaction XDR to Horizon", async () => {
    let requestedUrl = "";
    let requestedBody = "";
    const result = await submitTransactionXdr({
      xdr: "AAAAAgSIGNED",
      profile: testnetProfile(),
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        requestedBody = String(init?.body);
        return new Response(
          JSON.stringify({
            hash: "abc123",
            ledger: 456,
            successful: true,
            fee_charged: "100"
          })
        );
      }
    });

    expect(requestedUrl).toBe("https://horizon-testnet.stellar.org/transactions");
    expect(requestedBody).toBe("tx=AAAAAgSIGNED");
    expect(result).toEqual({
      hash: "abc123",
      ledger: 456,
      successful: true,
      feeCharged: "100"
    });
  });

  it("polls Horizon when signed transaction submission returns an unconfirmed hash", async () => {
    const requests: string[] = [];
    const result = await submitTransactionXdr({
      xdr: "AAAAAgSIGNED",
      profile: testnetProfile(),
      fetchImpl: async (input) => {
        requests.push(String(input));
        if (requests.length === 1) return new Response(JSON.stringify({ hash: "abc123" }));
        return new Response(
          JSON.stringify({
            hash: "abc123",
            ledger: 456,
            successful: true,
            fee_charged: "200"
          })
        );
      }
    });

    expect(requests).toEqual([
      "https://horizon-testnet.stellar.org/transactions",
      "https://horizon-testnet.stellar.org/transactions/abc123"
    ]);
    expect(result).toEqual({
      hash: "abc123",
      ledger: 456,
      successful: true,
      feeCharged: "200"
    });
  });

  it("requires explicit approval before signed transaction XDR submission on real-funds profiles", async () => {
    await expect(
      submitTransactionXdr({
        xdr: "AAAAAgSIGNED",
        profile: { ...testnetProfile(), name: "mainnet", network: "public", networkPassphrase: Networks.PUBLIC, realFunds: true }
      })
    ).rejects.toMatchObject({ code: "MAINNET_NOT_ENABLED" });
  });

  it("submits signed transaction XDR on real-funds profiles when explicitly allowed", async () => {
    let requestedUrl = "";
    const signedXdr = signedPaymentXdrFixture();
    const result = await submitTransactionXdr({
      xdr: signedXdr,
      profile: { ...testnetProfile(), name: "mainnet", network: "public", networkPassphrase: Networks.PUBLIC, realFunds: true, horizonUrl: "https://horizon.stellar.org" },
      allowRealFunds: true,
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({
            hash: "mainnet123",
            ledger: 789,
            successful: true,
            fee_charged: "100"
          })
        );
      }
    });

    expect(requestedUrl).toBe("https://horizon.stellar.org/transactions");
    expect(result).toMatchObject({ hash: "mainnet123", ledger: 789, successful: true });
  });

  it("rejects unsigned transaction XDR on real-funds profiles", async () => {
    const unsignedXdr = unsignedPaymentXdrFixture();
    await expect(
      submitTransactionXdr({
        xdr: unsignedXdr,
        profile: { ...testnetProfile(), name: "mainnet", network: "public", networkPassphrase: Networks.PUBLIC, realFunds: true },
        allowRealFunds: true
      })
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "Mainnet signed-XDR submission requires at least one transaction signature."
    });
  });

  it("fetches Horizon payment collections", async () => {
    const fetchImpl = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          _links: {
            next: { href: "https://example.com/next" },
            prev: { href: "https://example.com/prev" }
          },
          _embedded: {
            records: [{ id: "op1", type: "payment" }]
          }
        })
      );
    };
    try {
      await expect(
        accountPayments({
          address: wallet.publicKey,
          profile: {
            name: "testnet",
            network: "testnet",
            networkPassphrase: "Test SDF Network ; September 2015",
            horizonUrl: "https://horizon-testnet.stellar.org",
            rpcUrl: "https://soroban-testnet.stellar.org",
            friendbotUrl: "https://friendbot.stellar.org",
            defaultAsset: "XLM",
            realFunds: false
          },
          limit: 3
        })
      ).resolves.toEqual({
        records: [{ id: "op1", type: "payment" }],
        next: "https://example.com/next",
        previous: "https://example.com/prev"
      });
      expect(requestedUrl).toContain(`/accounts/${wallet.publicKey}/payments`);
      expect(requestedUrl).toContain("limit=3");
    } finally {
      globalThis.fetch = fetchImpl;
    }
  });
});

function testnetProfile() {
  return {
    name: "testnet" as const,
    network: "testnet" as const,
    networkPassphrase: "Test SDF Network ; September 2015",
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
    friendbotUrl: "https://friendbot.stellar.org",
    defaultAsset: "XLM",
    realFunds: false
  };
}

function unsignedPaymentXdrFixture(): string {
  const signer = Keypair.random();
  const destination = Keypair.random().publicKey();
  const account = new Account(signer.publicKey(), "1");
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.PUBLIC
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount: "1"
      })
    )
    .setTimeout(60)
    .build()
    .toXDR();
}

function signedPaymentXdrFixture(): string {
  const signer = Keypair.random();
  const destination = Keypair.random().publicKey();
  const account = new Account(signer.publicKey(), "1");
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.PUBLIC
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount: "1"
      })
    )
    .setTimeout(60)
    .build();
  transaction.sign(signer);
  return transaction.toXDR();
}

function poolIdFixture(): string {
  return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
}

function poolFixture() {
  return {
    id: poolIdFixture(),
    paging_token: poolIdFixture(),
    fee_bp: 30,
    type: "constant_product",
    total_trustlines: "3",
    total_shares: "50.0000000",
    reserves: [
      { asset: "native", amount: "100.0000000" },
      { asset: `USD:${wallet.publicKey}`, amount: "200.0000000" }
    ]
  };
}

function accountFixture() {
  return {
    id: wallet.publicKey,
    account_id: wallet.publicKey,
    sequence: "1",
    balances: [
      { asset_type: "native", balance: "100.0000000" },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USD",
        asset_issuer: wallet.publicKey,
        balance: "100.0000000",
        limit: "1000.0000000"
      },
      {
        asset_type: "liquidity_pool_shares",
        liquidity_pool_id: poolIdFixture(),
        balance: "5.0000000",
        limit: "1000.0000000"
      }
    ]
  };
}

async function fakeStellarBinary(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "stellar-agent-fake-cli-"));
  const binary = join(dir, "stellar");
  await writeFile(binary, "#!/bin/sh\necho fake-stellar \"$@\"\n", { mode: 0o755 });
  return binary;
}

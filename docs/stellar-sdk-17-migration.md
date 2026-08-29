# Stellar SDK 17 migration notice

Stellar Agent 0.5.4 targets `@stellar/stellar-sdk` 16.3.0, the current `lts-16` release. SDK 17 is not yet the supported runtime dependency because it intentionally changes XDR values and byte-returning APIs, but the transaction-envelope and liquidity-pool paths in this repository have been made compatible with both shapes and are exercised against SDK 17.0.1 during migration testing.

The CLI JSON envelopes and command names do not change as part of this preparation. This notice is primarily for direct package consumers and contributors who work with Stellar SDK values.

## What changes in SDK 17

- Node.js 22.12.0 or newer is required for the CommonJS build. Stellar Agent 0.5.4 continues to support Node.js 22 generally through SDK 16.3.0.
- XDR unions use a string `type` discriminator and property-style arms. SDK 16 uses `.switch().name` and method-style arms.
- Many byte-returning APIs now return plain `Uint8Array` values instead of Node.js `Buffer` values.
- The XDR runtime moves to `@stellar/js-xdr` 5 and changes enum, integer, optional-field, named-byte, and union behavior.
- SDK 17.0.1 restores deprecated aliases such as `toXDR()` and `fromXDR()`, but new code should prefer the `Xdr` spelling and must not assume the returned bytes are a `Buffer`.

See the upstream [SDK 17.0.0 release notes](https://github.com/stellar/js-stellar-sdk/releases/tag/v17.0.0) and [SDK 17.0.1 compatibility aliases](https://github.com/stellar/js-stellar-sdk/releases/tag/v17.0.1) for the complete migration surface.

## Dual-version patterns

When code must temporarily accept both SDK generations, read a union discriminator and arm without assuming either representation:

```ts
function xdrMember(value: Record<string, unknown>, key: string): unknown {
  const member = value[key];
  return typeof member === "function" ? member.call(value) : member;
}

function xdrType(value: Record<string, unknown>): string | undefined {
  if (typeof value.type === "string") return value.type;
  const legacySwitch = xdrMember(value, "switch") as { name?: string } | undefined;
  return legacySwitch?.name;
}
```

Treat SDK byte results as `Uint8Array`. In Node.js, wrap them explicitly when a Buffer-only encoding helper is needed:

```ts
const poolIdBytes = getLiquidityPoolId("constant_product", parameters);
const poolIdHex = Buffer.from(poolIdBytes).toString("hex");
```

Portable code should prefer `Uint8Array` operations and an environment-neutral hex/base64 encoder instead of relying on `Buffer` methods.

## Stellar Agent migration boundary

The supported 0.5.4 dependency remains SDK 16.3.0. Before Stellar Agent changes its supported dependency to SDK 17, the release must:

1. Raise the package engine floor to Node.js 22.12.0.
2. Run the complete TypeScript, unit, package, and live Testnet verification suites against SDK 17.
3. Review public types that expose SDK XDR or byte values.
4. Call out any direct-consumer source changes in the changelog and package READMEs.

The Blend adapter remains a separate dependency boundary. Blend SDK 3.3.0 currently pins Stellar SDK 16.0.0, so applications that enable that adapter should review and, where appropriate, apply their root package-manager override until Blend publishes an updated dependency.

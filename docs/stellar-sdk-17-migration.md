# Stellar SDK 17 migration guide

Stellar Agent 0.6.0 targets `@stellar/stellar-sdk` 17.0.1 and requires Node.js 22.12.0 or newer. The CLI JSON envelopes and command names remain stable, but direct package consumers that manipulate SDK XDR or byte values may need source changes.

The CLI JSON envelopes and command names do not change as part of this preparation. This notice is primarily for direct package consumers and contributors who work with Stellar SDK values.

## What changes in SDK 17

- Node.js 22.12.0 or newer is required.
- XDR unions use a string `type` discriminator and property-style arms. SDK 16 uses `.switch().name` and method-style arms.
- Many byte-returning APIs now return plain `Uint8Array` values instead of Node.js `Buffer` values.
- The XDR runtime moves to `@stellar/js-xdr` 5 and changes enum, integer, optional-field, named-byte, and union behavior.
- SDK 17.0.1 restores deprecated aliases such as `toXDR()` and `fromXDR()`, but new code should prefer the `Xdr` spelling and must not assume the returned bytes are a `Buffer`.

See the upstream [SDK 17.0.0 release notes](https://github.com/stellar/js-stellar-sdk/releases/tag/v17.0.0) and [SDK 17.0.1 compatibility aliases](https://github.com/stellar/js-stellar-sdk/releases/tag/v17.0.1) for the complete migration surface.

## Migration patterns

SDK 17 code should read property-style union discriminators and arms:

```ts
if (envelope.type === "envelopeTypeTx") {
  const signatures = envelope.v1.signatures;
}
```

Treat SDK byte results as `Uint8Array`. In Node.js, wrap them explicitly when a Buffer-only encoding helper is needed:

```ts
const poolIdBytes = getLiquidityPoolId("constant_product", parameters);
const poolIdHex = Buffer.from(poolIdBytes).toString("hex");
```

Portable code should prefer `Uint8Array` operations and an environment-neutral hex/base64 encoder instead of relying on `Buffer` methods.

## Stellar Agent boundary

The 0.6.0 release has raised the engine floor, updated direct SDK dependencies, and migrated transaction envelopes, XDR parsing, liquidity-pool identifiers, and signing helpers. Deprecated `toXDR`/`fromXDR` aliases may still exist upstream, but new Stellar Agent code uses `toXdr`/`fromXdr`.

The Blend adapter remains a deliberately separate dependency boundary. Its SDK may retain a nested SDK 16 dependency; that does not block the direct Stellar Agent SDK 17 migration, and applications using Blend should review that adapter's dependency tree independently.

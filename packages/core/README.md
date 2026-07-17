# @stellar-agent/core

Shared core types and helpers for Stellar Agent packages.

This package contains the configuration model, network profiles, amount and asset parsing, structured command envelopes, error serialization, path helpers, atomic file replacement, IDs, wallet public views, and conservative redaction utilities used by the CLI and supporting packages.

## Install

```bash
npm install @stellar-agent/core
```

## Example

```js
import { createDefaultConfig, parseAmount, redactSensitive } from "@stellar-agent/core";

const config = createDefaultConfig();
const amount = parseAmount("1.25", "XLM");
const publicOutput = redactSensitive({ config, amount });
```

## Safety

- Mainnet is disabled in default configuration.
- Secret-like strings and sensitive object fields are redacted before output.
- Serialized error messages and hints use the same secret and URL-query redaction as structured details.
- `writeFileAtomic` replaces persisted state from a private same-directory temporary file.
- Testnet wallet secret keys are omitted from public wallet views.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Threat model: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/threat-model.md
- npm CLI package: https://www.npmjs.com/package/@stellar-agent/cli

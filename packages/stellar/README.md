# @stellar-agent/stellar

Stellar SDK and Stellar CLI adapters for Testnet-first agent payment workflows.

This package contains wallet creation, Friendbot funding, Horizon account reads, fee-aware payment submission, bundled Testnet payments, trustlines, claimable balances, core liquidity-pool helpers, signed-XDR submission, and Stellar CLI-backed Soroban contract operations.

## Install

```bash
npm install @stellar-agent/stellar
```

## Example

```js
import { createTestnetWallet, fundWithFriendbot, resolveNetworkProfile } from "@stellar-agent/stellar";
import { createDefaultConfig } from "@stellar-agent/core";

const config = createDefaultConfig();
const profile = resolveNetworkProfile("testnet", config.profiles);
const wallet = createTestnetWallet("agent");
await fundWithFriendbot(wallet.publicKey, profile);
```

## Safety

- Local generated wallet secrets are for Testnet use.
- Mainnet local auto-signing is blocked by higher-level CLI guards.
- Submitted operations should be paired with policy checks and receipt logging.
- Stellar CLI-backed Mainnet contract operations require external custody and explicit real-funds acknowledgement.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Testnet quickstart: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/quickstart-testnet.md
- Mainnet safety: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/mainnet-safety.md

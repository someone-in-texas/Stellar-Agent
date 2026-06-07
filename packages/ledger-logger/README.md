# @stellar-agent/ledger-logger

Receipt and JSONL event logging for Stellar Agent operations.

This package writes structured receipts for submitted payments and operations, reads the latest receipt, derives spend history for policy evaluation, and verifies that receipt payloads do not contain secret keys.

## Install

```bash
npm install @stellar-agent/ledger-logger
```

## Example

```js
import { latestReceipt, spendHistoryFromReceipts } from "@stellar-agent/ledger-logger";

const latest = await latestReceipt("~/.stellar-agent/receipts");
const spend = await spendHistoryFromReceipts("~/.stellar-agent/receipts");
```

## Safety

- Receipts are designed for public transaction metadata, not secret custody.
- Secret-like values are rejected by receipt verification.
- Payment commands use receipt history when evaluating daily and monthly policy limits.

## Links

- GitHub: https://github.com/someone-in-texas/Stellar-Agent
- Ledger logging docs: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/ledger-logging.md
- Threat model: https://github.com/someone-in-texas/Stellar-Agent/blob/main/docs/threat-model.md

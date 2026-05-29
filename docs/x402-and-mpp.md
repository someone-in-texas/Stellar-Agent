# x402 and MPP

x402 and MPP describe HTTP-native payment workflows where an API can request payment before serving content.

## Current Support

In this build, `stellar-agent pay x402`, `stellar-agent pay mpp`, and `stellar-agent testnet scenario x402-payment` are placeholders. They exit with code `8`, return the standard error envelope in JSON mode, and do not read secrets, sign, submit, or write successful payment receipts.

## Planned x402 Flow

1. Request URL.
2. Receive HTTP 402 payment requirements.
3. Parse and bind payment to URL/domain.
4. Evaluate policy.
5. Request approval if needed.
6. Pay on Testnet.
7. Retry request.
8. Write receipt.

## Planned MPP Flow

1. Parse one-time charge.
2. Evaluate policy.
3. Pay on Testnet.
4. Retry request.
5. Write receipt.

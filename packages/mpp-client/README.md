# @stellar-agent/mpp-client

Local MPP one-time charge and session-budget client support for the Testnet demo.

This package implements concrete local flows:

- one-time `402 -> policy -> Testnet payment -> retry with proof`
- session-budget `402 -> policy -> Testnet budget payment -> repeated proof requests`

Production facilitator flows are not implemented yet.

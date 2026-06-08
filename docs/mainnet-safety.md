# Mainnet Safety

Mainnet uses real funds.

Defaults:

- Mainnet is disabled.
- Mainnet auto-approval is disabled.
- Mainnet local auto-signing is blocked except for explicitly enabled, armed agent-wallet payments.
- Mainnet policies require explicit approval.
- JSON output includes `realFunds: true` for Mainnet status.

Enablement requires:

```bash
stellar-agent mainnet enable --i-understand-real-funds
```

## Risk-Budgeted Mainnet Agent Wallet

Risk-budgeted Mainnet agent-wallet mode is for a deliberately small, dedicated Mainnet wallet that the user is willing to expose to agent-driven workflows. It limits loss; it does not make autonomous Mainnet spending safe.

The wallet is stored as a Mainnet public key plus risk-budget metadata. `stellar-agent` does not store a Mainnet secret key. By default, the agent-wallet guard runs before Mainnet payment-signature workflows hand unsigned XDR to a browser wallet or other external signer. Users can additionally enable autosigning for this agent wallet only; that path reads the secret key from a named environment variable at runtime and never writes it to config, logs, or receipts.

Provision and fund the wallet outside `stellar-agent`:

1. Create or choose a dedicated Mainnet wallet in Freighter, a hardware wallet, Stellar CLI, an exchange account withdrawal flow, or another custody tool.
2. Keep the secret key out of chats, config files, logs, receipts, and docs. Give `stellar-agent` only the public `G...` address.
3. Fund the wallet from a human-controlled Mainnet source. `stellar-agent` cannot Friendbot-fund Mainnet and should not be used as a Mainnet faucet or custody tool.
4. Fund only enough for the intended risk budget, fees, and account minimums, and keep the balance below the configured `--max-balance`.
5. Confirm the destination allowlist and caps before arming. If the use case changes, update limits deliberately and re-arm.

Create and arm the dedicated watch-only wallet:

```bash
stellar-agent mainnet enable --i-understand-real-funds --json
stellar-agent mainnet agent-wallet create \
  --address G... \
  --max-balance 25 \
  --daily-limit 5 \
  --per-tx-limit 1 \
  --asset XLM \
  --allow-destination G... \
  --json
stellar-agent mainnet agent-wallet arm --i-understand-real-funds --json
stellar-agent mainnet agent-wallet status --json
```

Optional shortcut:

```bash
stellar-agent mainnet agent-wallet enable \
  --address G... \
  --max-balance 25 \
  --daily-limit 5 \
  --per-tx-limit 1 \
  --asset XLM \
  --allow-destination G... \
  --arm \
  --i-understand-real-funds \
  --json
```

Request an externally signed payment only after the wallet is armed:

```bash
stellar-agent --profile mainnet tx request-payment-signature \
  --from mainnet-agent \
  --to G... \
  --amount 0.1 \
  --allow-real-funds \
  --i-understand-real-funds \
  --json
stellar-agent approval serve
stellar-agent --profile mainnet tx submit-approval appr_... \
  --allow-real-funds \
  --i-understand-real-funds \
  --json
```

Controls:

- The wallet must be a dedicated Mainnet watch-only wallet, not an arbitrary active Testnet wallet.
- Mainnet funding happens outside `stellar-agent`; only the public key and risk-budget metadata are stored.
- Mainnet must already be enabled.
- Arming requires `--i-understand-real-funds`.
- Destination allowlists are deny-by-default; at least one allowed destination is required before arming.
- Allowed assets and payment operation type are enforced before payment-signature XDR is created.
- Per-transaction, daily, optional monthly, and max-wallet-balance caps are enforced.
- Spend history is read from durable receipts and fails closed if receipt parsing fails.
- A derived spend-counter snapshot is written to config for status and auditing, but receipt history remains the enforcement source of truth.
- Arming records config path, config fingerprint, policy path, and policy fingerprint. Config path changes, config edits, or policy edits require re-arming.
- Balance checks fail closed if Horizon cannot read the dedicated wallet balance or if the balance exceeds the risk budget.
- `--allow-real-funds` acknowledges real-funds intent; it does not bypass policy, receipts, fingerprints, balance checks, or the agent-wallet risk budget.

Operational commands:

```bash
stellar-agent mainnet agent-wallet limits --daily-limit 2 --per-tx-limit 0.5 --allow-destination G... --json
stellar-agent mainnet agent-wallet disarm --json
stellar-agent mainnet agent-wallet rotate --address G... --json
stellar-agent receipts latest --json
stellar-agent receipts summary --profile mainnet --json
```

Changing limits or rotating the public key disarms the wallet. Disarm before handing control back to a general-purpose agent, after demos, or whenever the policy/config state is unclear.

Failure modes:

- `Mainnet agent-wallet payment workflows require the wallet to be armed.` Arm explicitly after reviewing limits.
- `Mainnet agent-wallet arming is stale and must be refreshed.` Review config/policy changes, then disarm and arm again.
- `Mainnet agent-wallet spend history could not be read.` Repair or inspect receipts before spending.
- `Mainnet agent-wallet balance exceeds the configured risk budget.` Move funds out or raise the cap deliberately.
- `Mainnet agent-wallet destination is not allowlisted.` Add only the exact destination intended for the workflow.

Recommended signing model:

- Use Freighter or another human approval flow.
- Show transaction explanation before signing.
- Keep Mainnet secret keys out of local plaintext files.
- Use a Stellar CLI identity or signed XDR for guarded Mainnet operations; do not pass raw Mainnet secret keys to `stellar-agent`.

## Agent-Wallet Autosigning

Agent-wallet autosigning is the only local Mainnet autosign exception. It is intended for a deliberately small, dedicated wallet with strict caps and a short operational window.

Enable autosigning only after creating the wallet and reviewing the risk budget:

```bash
stellar-agent mainnet agent-wallet autosign enable \
  --secret-key-env STELLAR_AGENT_MAINNET_AGENT_SECRET_KEY \
  --i-understand-agent-wallet-autosign \
  --json
stellar-agent mainnet agent-wallet arm --i-understand-real-funds --json
```

Policy must also explicitly allow this exception. The default Mainnet policy still returns `requires_approval` and blocks autosign submission. A deliberately small agent-wallet policy can opt in with:

```yaml
approval:
  requireForAllPayments: false
  requireForNewRecipient: false
  requireForNewDomain: false
  requireAbove: "1 XLM"
  allowMainnetAgentWalletAutosign: true
```

Then run a bounded direct payment:

Set `STELLAR_AGENT_MAINNET_AGENT_SECRET_KEY` in the shell environment for the signing process, then run:

```bash
stellar-agent --profile mainnet pay send \
  --from mainnet-agent \
  --to G... \
  --amount 0.01 \
  --allow-real-funds \
  --i-understand-real-funds \
  --i-understand-agent-wallet-autosign \
  --json
```

Autosign controls:

- The secret key is read only from the configured environment variable.
- The secret key must match the configured agent-wallet public key.
- The command requires `--allow-real-funds`, `--i-understand-real-funds`, and `--i-understand-agent-wallet-autosign`.
- The evaluated payment policy must return `allowed`; `requires_approval` blocks autosign submission.
- Non-agent-wallet Mainnet `pay send`, batch payments, contracts, DeFi, and liquidity mutation remain blocked from local autosigning.
- Receipts include the autosign warning and risk-budget before/after state, but not the secret key.
- `agent-wallet autosign enable` and `agent-wallet autosign disable` disarm the wallet, so review and re-arm after changing autosign state.

Disable autosigning and disarm when the task is done:

```bash
stellar-agent mainnet agent-wallet autosign disable --json
stellar-agent mainnet agent-wallet disarm --json
```

## Local Approval Bridge

The local approval bridge stores auditable request files under the configured `approvalsDir` and can serve a localhost approval UI:

```bash
stellar-agent approval create-payment --to G... --amount 6 --json
stellar-agent approval create-transaction --xdr AAAA... --summary "Sign contract transaction" --network testnet --json
stellar-agent approval list --json
stellar-agent approval decide appr_... --approve --json
stellar-agent approval serve
```

The server prints a per-session API token and an approval UI URL with the token in the URL fragment. The unauthenticated HTML served at `/` does not embed the token. Browser requests from the printed UI URL include this token automatically. Non-browser API clients must send it as `Authorization: Bearer <token>`. The bridge also rejects cross-origin API writes and oversized request bodies.

By default, `approval serve` binds to `127.0.0.1`. Binding to a non-loopback host such as `0.0.0.0` requires the explicit `--allow-remote-access` acknowledgement and should be used only on trusted networks.

For Testnet payments that policy marks `requires_approval`, rerun the payment with a matching approved request:

```bash
stellar-agent pay send --to G... --amount 6 --approval-id appr_... --json
```

The bridge does not handle raw secret keys. Browser-extension signing through Freighter can post signed transaction XDR back to the bridge. WalletConnect signing through LOBSTR or another compatible Stellar wallet can also attach signed XDR to an approval request. Testnet submission is available by default; Mainnet submission is available only through the guarded signed-XDR rules below.

When `stellar-agent approval serve` is opened in a browser with Freighter installed, transaction-XDR approval requests include a `Sign With Freighter` action. The UI calls Freighter's `signTransaction` API and records the returned signed XDR plus signer address in the approval request. The bridge verifies that the signed envelope has at least one signature and that its transaction body exactly matches the original approval XDR before storing it.

## WalletConnect Signing

WalletConnect support is an external signing flow for wallets such as LOBSTR. It does not use local custody and it does not submit transactions through WalletConnect.

Commands:

```bash
stellar-agent wallet walletconnect pair --wallet lobstr --project-id "$WALLETCONNECT_PROJECT_ID" --json
stellar-agent wallet walletconnect status --project-id "$WALLETCONNECT_PROJECT_ID" --json
stellar-agent wallet walletconnect disconnect --topic <topic> --project-id "$WALLETCONNECT_PROJECT_ID" --json
stellar-agent approval sign-walletconnect appr_... --wallet lobstr --project-id "$WALLETCONNECT_PROJECT_ID" --json
stellar-agent tx submit-approval appr_... --json
```

Controls:

- WalletConnect requires a project id from `--project-id` or `WALLETCONNECT_PROJECT_ID`.
- `approval sign-walletconnect` uses `stellar_signXDR` only. It does not call `stellar_signAndSubmitXDR`.
- The active profile must match the approval request network.
- WalletConnect accounts must be on `stellar:testnet` for Testnet approvals or `stellar:pubnet` for Mainnet approvals.
- If the approval request includes payment metadata, the connected WalletConnect account must match the payment source account.
- Mainnet WalletConnect signing requires Mainnet enablement plus `--allow-real-funds --i-understand-real-funds`.
- The signed XDR is recorded on the approval request only after the signed envelope matches the original approval XDR body.
- Submission remains a separate `tx submit-approval` step so policy re-checks, Mainnet acknowledgements, Horizon submission, and receipt logging still run through `stellar-agent`.
- Pairing URIs are printed for the active command but are not written to receipts or event logs.

## Signed XDR Submission

Signed transaction XDR can be submitted on Testnet after a browser wallet or other signer has already signed it:

```bash
stellar-agent tx build-payment --from treasury --to G... --amount 1 --json
stellar-agent tx request-payment-signature --from treasury --to G... --amount 1 --json
stellar-agent tx submit-xdr --xdr AAAA... --json
stellar-agent tx submit-approval appr_... --json
```

`tx build-payment` creates unsigned payment XDR for a local, watch-only, or raw public-key source account. `tx request-payment-signature` builds that XDR and creates a local transaction approval request for Freighter signing. `tx submit-approval` loads the signed XDR recorded by the local approval bridge and submits it to Horizon. It requires a `transaction_xdr` approval with status `signed` whose signed envelope matches the requested transaction.

For WalletConnect wallets such as LOBSTR, use `approval sign-walletconnect appr_... --wallet lobstr` after creating the transaction approval request. This records signed XDR but does not submit it.

Mainnet signed-XDR workflows are allowed only when all of these are true:

- Mainnet is enabled with `stellar-agent mainnet enable --i-understand-real-funds`.
- The active profile is Mainnet.
- The command includes `--allow-real-funds --i-understand-real-funds`.
- The XDR is already signed by a human-controlled Mainnet wallet or external signer.
- Local policy evaluation did not deny the payment request when the XDR was built by `stellar-agent`.

Example guarded Mainnet payment-signature request:

```bash
stellar-agent wallet import-public --name treasury --network mainnet --address G...
stellar-agent --profile mainnet tx request-payment-signature \
  --from treasury \
  --to G... \
  --amount 1 \
  --allow-real-funds \
  --i-understand-real-funds \
  --json
stellar-agent approval serve
stellar-agent --profile mainnet tx submit-approval appr_... \
  --allow-real-funds \
  --i-understand-real-funds \
  --json
```

Example guarded Mainnet signed-XDR submission when another wallet has already signed:

```bash
stellar-agent --profile mainnet tx submit-xdr \
  --xdr AAAA... \
  --allow-real-funds \
  --i-understand-real-funds \
  --json
```

These signed-XDR commands do not import or store Mainnet secret keys and do not auto-sign.

## Mainnet Contracts

Contract commands that can submit transactions, such as `contract invoke`, `contract deploy`, `contract upload`, `contract asset-deploy`, `contract extend`, and `contract restore`, are guarded when `--network mainnet`, `--network public`, or `--network pubnet` is selected.

Guarded Mainnet contract operations require all of:

- `stellar-agent mainnet enable --i-understand-real-funds`.
- `--allow-real-funds`.
- `--i-understand-real-funds`.
- A Stellar CLI identity, browser-wallet flow, raw public key, or watch-only Mainnet wallet reference.

`stellar-agent` refuses raw secret keys and local generated Testnet wallet secrets for Mainnet contract operations. It can pass a Stellar CLI identity name through to the installed `stellar` CLI, leaving Mainnet key custody outside this project.

Watch-only Mainnet public wallets can be imported for read-only balance and ledger inspection:

```bash
stellar-agent wallet import-public --name treasury --network mainnet --address G...
stellar-agent wallet balance --account treasury --json
```

This stores only the public key and cannot sign transactions.

## Mainnet DeFi

Blend DeFi mutation on Mainnet follows the guarded Mainnet contract model. Mainnet Blend commands must not use local generated wallet secrets or autonomous auto-signing. Any future submitted Mainnet Blend transaction requires Mainnet enablement, explicit real-funds flags, an external signer or browser-wallet flow, DeFi policy approval, preflight simulation, and a receipt.

Aquarius AMM commands may inspect Mainnet deployments and API metadata, but this release does not submit Aquarius transactions on any network. Mainnet Aquarius mutation must not use local generated wallet secrets or autonomous auto-signing. Any future submitted Mainnet Aquarius deposit, withdrawal, swap, or reward-claim transaction requires Mainnet enablement, explicit real-funds flags, an external signer or browser-wallet flow, `defi.aquarius` policy approval, simulation or equivalent preflight, slippage bounds for swaps/LP actions, and a receipt.

Readiness checklist:

- Policy requires approval for all Mainnet payments.
- Receipts are enabled.
- Logs are redacted.
- The user understands real funds are involved.

## Mainnet Liquidity

Core Stellar liquidity-pool inspection, trade reads, position inspection, listeners, and strategy investigation may read Mainnet data. Mutating liquidity actions on Mainnet are blocked from local auto-signing.

Mainnet liquidity-pool deposit, withdrawal, and pool-share trustline creation require a future external-signer flow with all of:

- Mainnet enablement with `stellar-agent mainnet enable --i-understand-real-funds`.
- Explicit real-funds flags for the submitting command.
- A human-controlled external signer or browser-wallet flow.
- `market.liquidity` policy approval.
- Preflight output that shows pool id, reserve assets, price bounds, exposure, trustline requirements, and risk notes.
- A receipt for any submitted transaction.

Soroban AMM contracts are not treated as generic safe liquidity pools. `stellar-agent market soroban pool preflight` reports `adapter_required` until a protocol-specific adapter documents the contract interface, policy controls, simulation behavior, Mainnet signing model, and receipt metadata.

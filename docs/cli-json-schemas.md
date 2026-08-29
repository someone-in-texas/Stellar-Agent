# CLI JSON Schemas

`stellar-agent --json` returns a common envelope:

```json
{ "ok": true, "data": {} }
```

or:

```json
{ "ok": false, "error": { "code": "POLICY_DENIED", "message": "..." } }
```

The schema for that wrapper is:

```text
@stellar-agent/cli/schemas/cli/envelope.schema.json
```

Command-specific schemas describe the `data` payload inside the envelope.

| Command output                                                                                               | Schema                                                                    |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `stellar-agent pay quote --json`                                                                             | `@stellar-agent/cli/schemas/cli/pay-quote.schema.json`                    |
| `stellar-agent policy explain --json`                                                                        | `@stellar-agent/cli/schemas/cli/policy-explain.schema.json`               |
| `stellar-agent market lp preflight --json`                                                                   | `@stellar-agent/cli/schemas/cli/market-lp-preflight.schema.json`          |
| `stellar-agent defi aquarius swap preflight --json`                                                          | `@stellar-agent/cli/schemas/cli/defi-aquarius-swap-preflight.schema.json` |
| `stellar-agent approval create-payment --json`, `approval create-transaction --json`, `approval show --json` | `@stellar-agent/cli/schemas/cli/approval-request.schema.json`             |
| `stellar-agent approval list --json`                                                                         | `@stellar-agent/cli/schemas/cli/approval-list.schema.json`                |
| Receipt objects                                                                                              | `@stellar-agent/cli/schemas/cli/receipt.schema.json`                      |
| Durable execution intents                                                                                    | `@stellar-agent/cli/schemas/cli/intent.schema.json`                       |
| `stellar-agent receipts latest --json`                                                                       | `@stellar-agent/cli/schemas/cli/receipts-latest.schema.json`              |
| `stellar-agent receipts summary --json`                                                                      | `@stellar-agent/cli/schemas/cli/receipts-summary.schema.json`             |

The package also includes an index:

```text
@stellar-agent/cli/schemas/cli/index.json
```

Schemas intentionally allow additional properties. Treat required fields and enums as the stable agent/tool contract, and ignore unknown fields unless your integration explicitly opts into them.

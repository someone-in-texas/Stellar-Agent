# Contributing

Thanks for improving `stellar-agent-bridge`.

## Local setup

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Payment logic changes

Read `docs/threat-model.md` and `docs/mainnet-safety.md` first. Any change that can affect signing, policy evaluation, receipt logging, Mainnet enablement, or secret handling must include focused tests.

## Pull requests

- Keep changes scoped.
- Update docs when commands or JSON output change.
- Prefer Testnet examples.
- Do not weaken default policies.

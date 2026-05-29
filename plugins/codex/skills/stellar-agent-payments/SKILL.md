# Stellar Agent Payments

Use this skill when asked to quote, explain, or send payments with `stellar-agent`.

Rules:

1. Use `--json`.
2. Run `stellar-agent policy explain` or `stellar-agent pay quote` before payment commands.
3. Treat `requires_approval` as a stop unless the user explicitly approves.
4. Never weaken policy files.
5. Never bypass the CLI.
6. Prefer `pay quote` before `pay send`.
7. Never print or log secrets.

# Claimable Balances

Claimable balances let one account create a balance that another account can claim later.

## Create

```bash
stellar-agent claimable create --from agent --to G... --amount 1 --asset XLM --json
stellar-agent claimable create --from issuer --to G... --amount 1 --asset USD:G...ISSUER --json
stellar-agent claimable create --from agent --to G... --amount 1 --claimable-after 2030-01-01T00:00:00Z --json
stellar-agent claimable create --from agent --to G... --amount 1 --claimable-before 2030-01-02T00:00:00Z --json
stellar-agent claimable create --from agent --to G...PRIMARY --claimant G...BACKUP --amount 1 --json
```

The command submits a Testnet `createClaimableBalance` operation, records an event log entry, writes a local operation receipt, and returns the transaction hash plus recent claimable balances for the claimant.
Use repeatable `--claimant` options to add backup or alternate claimants; `--to` remains the primary claimant shown in the compatibility `claimant` and `claimableBalances` response fields.

## Time-Bound Claiming

`claimable create` supports absolute time predicates:

- `--claimable-after <time>` makes the balance claimable at or after the provided time.
- `--claimable-before <time>` makes the balance claimable before the provided time.
- Passing both creates a claim window.

Times can be Unix timestamps in seconds or ISO-8601 date/time strings. The claiming account must wait until the predicate is satisfied before `claimable claim` will succeed.

## List

```bash
stellar-agent claimable list --account merchant --json
stellar-agent claimable list --address G... --json
```

## Claim

```bash
stellar-agent claimable claim --account merchant --balance-id 000000... --json
```

The claiming account must be an eligible claimant and the balance predicate must be satisfied.

## Notes

- XLM is the default asset.
- Issued assets use `CODE:G...ISSUER` format.
- Claimants need the issued-asset trustline before claiming a non-XLM claimable balance.
- Mainnet claiming is not enabled in v0.

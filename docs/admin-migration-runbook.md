# Admin Migration Runbook

This is a preparation runbook only. Do not execute against live contracts until the Safe, rehearsals, reviewers, and release approvals are ready.

## Target Posture

- Minimum Safe: 2-of-3 owners.
- Preferred upgrade path: Safe plus timelock.
- Release notes must state timelock status explicitly: live, absent/deferred, or not applicable.
- If timelock cannot be introduced immediately:
  - Phase 1: transfer EOA-held roles to Safe.
  - Phase 2: move Safe-controlled upgrade/config authority behind a timelock or equivalent governance delay.

## Batch Review Control

Every live admin-role migration batch requires at least two named reviewers before Safe submission. The preparer does not count as both reviewers.

Reviewers must check:

- target contract addresses and chain ID;
- role IDs and current holders;
- grant transactions precede revocations;
- Safe nonce, threshold, and owner set;
- calldata for each grant, revoke, upgrade, and timelock action;
- release-note evidence fields, including timelock status.

Archive reviewer names, timestamps, batch hash or Safe transaction URL, and final onchain transaction hashes with the release. A Safe threshold is not a substitute for this batch review record.

## Roles To Review

- All contracts: `DEFAULT_ADMIN_ROLE`.
- Identity Registry: `REGISTRAR_ROLE`.
- Reputation Registry: `FEEDBACK_ROUTER_ROLE`, `SETTLEMENT_SOURCE_ROLE`.
- Fee Module: `FEE_MANAGER_ROLE`, `PAUSER_ROLE`, `ROUTER_ROLE`.
- Verification Registry: `VERIFIER_ROLE`.

## Fork Rehearsal

1. Fork Base mainnet at a fixed block.
2. Run `contracts/script/AdminRoleReadiness.s.sol` with:

```bash
cd contracts
CURRENT_ADMIN=<candidate-eoa> TARGET_SAFE=<safe-address> forge script script/AdminRoleReadiness.s.sol:AdminRoleReadiness --rpc-url <fork-or-base-rpc>
```

For exhaustive live holder evidence, complete `docs/live-admin-verification-checklist.md`. `AdminRoleReadiness` confirms known candidates only; it does not enumerate all AccessControl holders.

3. Prepare grant transactions for every role that must move to the Safe.
4. Simulate grant transactions.
5. Verify the Safe has each expected role.
6. Prepare revocation transactions for the EOA only after Safe receipt is verified.
7. Simulate revocations.
8. Re-run the readiness script and archive the report.

## Live Sequence

1. Freeze unrelated admin actions.
2. Verify Safe owners and threshold.
3. Verify the current role holder set using `docs/live-admin-verification-checklist.md`.
4. Obtain the two-person batch review record.
5. Submit Safe transactions to grant required roles to the Safe.
6. Confirm each grant onchain.
7. Re-run verification and confirm Safe role receipt.
8. Submit Safe transactions to revoke the EOA roles.
9. Confirm each revocation onchain.
10. Re-run verification and confirm the EOA no longer holds the migrated roles.
11. Publish a release note that records addresses, transaction hashes, block numbers, reviewer signoff, and explicit timelock status.

## Failure Handling

- If any grant fails, do not revoke the EOA.
- If Safe receipt cannot be verified, stop and investigate before revocation.
- If a revocation transaction fails after successful grants, keep the Safe role and retry only after reviewing exact failure reason.
- If an unexpected role holder is discovered, pause migration and produce a new action list.

## Timelock Phase

If timelock is feasible, rehearse and execute Safe-to-timelock authority movement after EOA-to-Safe migration. The timelock must be configured so privileged actions cannot bypass the intended delay.

## Manual Action List

- Create or identify the target Safe.
- Verify owner identities and threshold.
- Decide whether timelock is included in Phase 1 or Phase 2.
- Select fork block and archive rehearsal output.
- Prepare transaction batch.
- Obtain two-person reviewer signoff.
- Execute through Safe only.
- Archive final verification report.

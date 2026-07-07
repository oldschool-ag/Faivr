# Protocol Admin Risk

FAIVR's live upgradeable contracts appear to use UUPS upgrade authorization gated by `DEFAULT_ADMIN_ROLE`.

Repo evidence and prior live-read notes indicate that this role was controlled by a single externally owned account rather than a multisig or timelock-controlled path. No current repo evidence proves that a timelock protects the live upgrade path.

This is a critical production/governance risk for fund-touching contracts:

- a single compromised admin key could authorize malicious upgrades;
- a single operator mistake could affect upgrade authority or privileged configuration;
- users cannot rely on public repo hardening alone to mitigate live protocol-admin risk;
- CI, docs, linting, and web hardening do not change onchain authority.

Production readiness must not be claimed until this is independently remediated or disproven with current onchain verification. The expected target posture is a Safe-controlled admin path, preferably with timelock protection for upgrades and privileged configuration.

See `docs/admin-migration-runbook.md` for the prepared remediation plan. No live admin-role change is performed by this repository hardening work.

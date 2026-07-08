# Admin Monitoring Runbook

This is the smallest repo-level monitoring package. It does not prove monitoring is live until an operator configures alerts and archives test evidence.

## Scope

Monitor Base mainnet logs for:

- UUPS upgrade events on FAIVR proxy contracts: `Upgraded(address)`.
- OpenZeppelin AccessControl changes on FAIVR contracts: `RoleGranted(bytes32,address,address)`, `RoleRevoked(bytes32,address,address)`, `RoleAdminChanged(bytes32,bytes32,bytes32)`.
- Safe ownership and threshold changes on the admin Safe: `AddedOwner(address)`, `RemovedOwner(address)`, `ChangedThreshold(uint256)`.

Use `docs/admin-monitoring-config.json` as the alert source of truth.

## Setup

1. Replace `REPLACE_WITH_TARGET_SAFE` in `docs/admin-monitoring-config.json` with the verified admin Safe address.
2. Replace reviewer and alert-channel placeholders with real private ops contacts.
3. Import the contract addresses and event topics into the chosen alerting tool.
4. Send alerts to a private channel watched by at least two reviewers.
5. Trigger or simulate one test alert per event family before treating monitoring as live.
6. Archive tool name, alert IDs, test alert timestamps, reviewer names, and screenshots or exported alert payloads with release notes.

## Review Rules

Treat every alert as security-sensitive until reviewed.

- Upgrade alert: verify the implementation address, caller, Safe transaction, release note, and storage-compatibility evidence.
- Role alert: verify role ID, account, sender, expected migration batch, and whether grants precede revocations.
- Safe alert: verify owner or threshold change against the approved governance record.

Any unexpected alert requires a private incident review before public disclosure.

## Release Gate

For contract or governance releases, release notes must state:

- whether upgrade alerts are live;
- whether AccessControl role alerts are live;
- whether Safe owner/threshold alerts are live;
- if any alert family is deferred, the owner and target date.

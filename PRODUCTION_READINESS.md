# Production Readiness

## Current Status

Repo and app hardening has been prepared in this branch. FAIVR must not be described as production-ready while live upgrade authority, Safe status, and timelock status remain unverified or unresolved.

Docs, scripts, and CI changes are preparation work. They do not change live onchain admin authority.

## Completed In This Pass

- `.github/` is no longer ignored.
- Repo-tracked CI workflows exist for contracts and web.
- Public-repo policy and cleanup rules are documented.
- Generated/root spillover artifacts were removed from the current tree.
- Canonical runtime contract addresses live in `web/lib/contracts.ts`.
- Base Sepolia references are quarantined in `web/lib/contracts.base-sepolia.testnet.ts`.
- Operator quote-request APIs now use schema validation, timing-safe auth comparison, rate limiting, no-store responses, and structured audit logs.
- Operator/browser flow no longer asks the operator to paste the shared server secret into the UI.
- Vercel config is standardized on `web/vercel.json`.
- Deployment, GitHub settings, release, security, and admin-migration docs are present.
- Read-only admin role readiness tooling is present at `contracts/script/AdminRoleReadiness.s.sol`.
- Admin-event monitoring runbook and machine-readable alert template are present at `docs/admin-monitoring-runbook.md` and `docs/admin-monitoring-config.json`.
- Read-only live admin verification checklist is present at `docs/live-admin-verification-checklist.md`.

## Historical Public Exposure

The following categories were removed from the current public tree but must be treated as historically public because they were committed previously:

- dated audit/status/comms/investor packets;
- generated audit PDF and mdpdf log;
- Foundry broadcast JSON;
- obsolete live-upgrade parity script with admin context;
- tracked `.vercel/project.json`;
- deployment/admin notes that included signer/admin context;
- stale root Base Sepolia TypeScript config.

History rewrite, cache invalidation, and secret/identifier risk review are separate manual owner actions.

## Required Manual Follow-Ups

- Enable GitHub branch protection and required checks described in `docs/github-required-settings.md`.
- Verify CODEOWNERS entries use real GitHub teams/users before enforcing CODEOWNERS review.
- Configure Vercel project root as `web/`.
- Configure Vercel env vars from `docs/deployment-runbook.md`.
- Review `npm audit` output and schedule dependency remediation.
- Rehearse admin migration on a fork.
- Migrate live admin authority to Safe and, preferably, timelock.
- Configure live monitoring for upgrades, role changes, and Safe owner/threshold changes.
- Archive Safe, timelock, admin-role, and monitoring evidence with the relevant release.

## Blocking Risks Still Open

- Live upgrade/admin authority: unresolved until current onchain verification proves Safe-controlled authority or migration is completed.
- Timelock status: unresolved until current onchain verification proves a live timelock or release notes explicitly disclose that it is absent/deferred.
- Admin monitoring: unresolved until live alerts are configured and tested.
- Branch protection not yet enforced in GitHub settings: unresolved until manually enabled.
- Commit provenance/signing not yet enforced: unresolved until manually enabled or formally deferred.
- Remaining public-history exposure: unresolved unless repository history and external caches are separately remediated.
- Remaining weak operator-auth concerns: partially improved, but still not full managed operator identity/session auth.
